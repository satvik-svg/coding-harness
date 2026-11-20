import { Response, NextFunction } from 'express';
import {
  ApiResponse,
  CreatePullRequestResult,
  Task,
  TaskAnalytics,
  TaskStatus,
  TaskWithSessions,
} from '@coding-harness/shared';
import { prisma } from '../db/client';
import { enqueueTask, removeQueuedJob } from '../jobs/queue';
import { cancelActiveTask } from '../jobs/taskRegistry';
import { AppError } from '../middlewares/errorHandler';
import { AuthenticatedRequest } from '../middlewares/auth';
import { GitService } from '../services/gitService';
import { GitHubPrService } from '../services/githubPrService';
import { unsealGitHubSession } from '../services/githubOAuthService';
import { SocketServer } from '../websocket/socketServer';
import { logger } from '../logger';
import { config } from '../config';
import { extractLegacySummary } from '../agent/legacySummary';

function validateDemoGitHubUrl(repoUrl: unknown): void {
  if (typeof repoUrl !== 'string') {
    throw new AppError('This demo accepts HTTPS GitHub repository URLs only', 400, 'INVALID_INPUT');
  }
  let url: URL;
  try {
    url = new URL(repoUrl);
  } catch {
    throw new AppError('Invalid GitHub URL', 400, 'INVALID_INPUT');
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname)
  ) {
    throw new AppError('Use a valid HTTPS GitHub repository URL', 400, 'INVALID_INPUT');
  }
}

async function syncHeaderGitHubSessionToUser(
  req: AuthenticatedRequest,
  userId: string,
): Promise<void> {
  const headerToken =
    typeof req.headers['x-github-session'] === 'string'
      ? req.headers['x-github-session'].trim()
      : '';
  if (!headerToken) return;
  try {
    unsealGitHubSession(headerToken);
    await prisma.user.updateMany({
      where: { id: userId, githubSessionEncrypted: null },
      data: { githubSessionEncrypted: headerToken },
    });
  } catch {
    // Ignore invalid header tokens
  }
}

function requireUserId(req: AuthenticatedRequest): string {
  if (!req.user?.id) {
    throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
  }
  return req.user.id;
}

/**
 * Submit a new automated coding task.
 * Supports Git repository URLs or uploaded .zip repository archives.
 */
export async function createTask(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { repoUrl, prompt, branch, mode } = req.body;
    const taskMode = mode === 'read' ? 'read' : 'edit';
    const uploadedFile = req.file;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new AppError('A natural language task prompt is required', 400, 'INVALID_INPUT');
    }

    if (!repoUrl && !uploadedFile) {
      throw new AppError(
        'Either a repoUrl or a .zip repository archive must be provided',
        400,
        'INVALID_INPUT',
      );
    }

    if (config.aiProvider === 'claude-code') {
      if (uploadedFile) {
        throw new AppError('This demo accepts public GitHub URLs only', 400, 'INVALID_INPUT');
      }
      validateDemoGitHubUrl(repoUrl);
    }

    const taskRepoIdentifier = repoUrl
      ? repoUrl.trim()
      : uploadedFile?.originalname || 'archive.zip';

    // Ensure connected GitHub session is persisted so the worker can clone private repos
    await syncHeaderGitHubSessionToUser(req, userId);

    // 1. Create Task record in database scoped strictly to the signed-in user
    const task = await prisma.task.create({
      data: {
        userId,
        repoUrl: taskRepoIdentifier,
        prompt: prompt.trim(),
        status: TaskStatus.PENDING,
      },
    });

    // 2. Add job to background BullMQ queue
    try {
      await enqueueTask({
        taskId: task.id,
        repoUrl: repoUrl ? repoUrl.trim() : '',
        prompt: prompt.trim(),
        branch: branch ? branch.trim() : undefined,
        userId: task.userId,
        zipFilePath: uploadedFile?.path,
        mode: taskMode,
      });
    } catch (queueError) {
      logger.warn(`Queue dispatch warning for task ${task.id}:`, queueError);
      await prisma.task.update({ where: { id: task.id }, data: { status: TaskStatus.FAILED } });
      throw new AppError('Could not enqueue task', 503, 'QUEUE_UNAVAILABLE');
    }

    const response: ApiResponse<Task> = {
      success: true,
      data: task as unknown as Task,
      message: 'Coding task submitted successfully and queued for execution',
      timestamp: new Date().toISOString(),
    };

    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * Fetch aggregated analytics metrics for the dashboard (duration, success rate, lines changed, cost estimate).
 */
export async function getTaskAnalytics(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);

    const tasks = await prisma.task.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        sessions: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: {
            startedAt: true,
            finishedAt: true,
            resultDiff: true,
            logs: true,
          },
        },
      },
    });

    let completedTasks = 0;
    let failedTasks = 0;
    let runningTasks = 0;
    let pendingTasks = 0;
    let cancelledTasks = 0;
    let totalDurationMs = 0;
    let durationSamples = 0;
    let totalLinesAdded = 0;
    let totalLinesRemoved = 0;
    let totalLogChars = 0;

    for (const task of tasks) {
      switch (task.status) {
        case TaskStatus.COMPLETED:
          completedTasks++;
          break;
        case TaskStatus.FAILED:
          failedTasks++;
          break;
        case TaskStatus.RUNNING:
          runningTasks++;
          break;
        case TaskStatus.CANCELLED:
          cancelledTasks++;
          break;
        case TaskStatus.PENDING:
        default:
          pendingTasks++;
          break;
      }

      const latest = task.sessions[0];
      if (latest) {
        if (latest.startedAt && latest.finishedAt) {
          const diffMs = latest.finishedAt.getTime() - latest.startedAt.getTime();
          if (diffMs >= 0) {
            totalDurationMs += diffMs;
            durationSamples++;
          }
        }
        if (latest.resultDiff) {
          for (const line of latest.resultDiff.split('\n')) {
            if (line.startsWith('+') && !line.startsWith('+++')) totalLinesAdded++;
            else if (line.startsWith('-') && !line.startsWith('---')) totalLinesRemoved++;
          }
        }
        if (latest.logs) {
          totalLogChars += latest.logs.length;
        }
      }
    }

    const terminalCount = completedTasks + failedTasks;
    const successRate =
      terminalCount > 0 ? Math.round((completedTasks / terminalCount) * 100) : 0;
    const avgDurationSeconds =
      durationSamples > 0 ? Math.round(totalDurationMs / durationSamples / 1000) : 0;
    // Rough lightweight estimate (~$0.004 per task + token proxy from session volume)
    const estimatedCostUsd = Number(
      ((tasks.length * 0.004 + (totalLogChars / 4000) * 0.0005)).toFixed(4),
    );

    const analytics: TaskAnalytics = {
      totalTasks: tasks.length,
      completedTasks,
      failedTasks,
      runningTasks,
      pendingTasks,
      cancelledTasks,
      successRate,
      avgDurationSeconds,
      totalLinesAdded,
      totalLinesRemoved,
      estimatedCostUsd,
    };

    const response: ApiResponse<TaskAnalytics> = {
      success: true,
      data: analytics,
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * Fetch status and session execution history for a specific task.
 */
export async function getTaskById(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params;

    const task = await prisma.task.findFirst({
      where: { id, userId },
      include: {
        sessions: {
          orderBy: { startedAt: 'desc' },
        },
      },
    });

    if (!task) {
      throw new AppError(`Task with ID ${id} was not found`, 404, 'NOT_FOUND');
    }

    const response: ApiResponse<TaskWithSessions> = {
      success: true,
      data: {
        ...task,
        sessions: task.sessions.map((session) => ({
          ...session,
          resultSummary:
            session.resultSummary ||
            (task.status === TaskStatus.COMPLETED ? extractLegacySummary(session.logs) : null),
        })),
      } as unknown as TaskWithSessions,
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * List tasks with pagination and optional user filtering.
 */
export async function listTasks(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) || '20', 10), 1), 100);
    const offset = Math.max(parseInt((req.query.offset as string) || '0', 10), 0);
    const status = req.query.status as TaskStatus | undefined;

    const whereClause: {
      userId: string;
      status?: TaskStatus;
    } = { userId };

    if (status && Object.values(TaskStatus).includes(status)) {
      whereClause.status = status;
    }

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.task.count({ where: whereClause }),
    ]);

    const response: ApiResponse<{ tasks: Task[]; total: number; limit: number; offset: number }> = {
      success: true,
      data: {
        tasks: tasks as unknown as Task[],
        total,
        limit,
        offset,
      },
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * Retrieve the latest generated Git diff for a completed or running task.
 */
export async function getTaskDiff(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params;

    const task = await prisma.task.findFirst({
      where: { id, userId },
      include: {
        sessions: {
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!task) {
      throw new AppError(`Task with ID ${id} was not found`, 404, 'NOT_FOUND');
    }

    let diff = task.sessions[0]?.resultDiff || '';

    if (!diff) {
      const workspacePath = GitService.getWorkspacePath(id);
      diff = await GitService.getGitDiff(workspacePath);
    }

    const response: ApiResponse<{ taskId: string; diff: string }> = {
      success: true,
      data: {
        taskId: id,
        diff,
      },
      message: diff ? 'Git diff retrieved' : 'No code changes recorded yet',
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * Cancels an active (PENDING or RUNNING) task, killing any child process / Docker container.
 */
export async function cancelTask(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params;

    const task = await prisma.task.findFirst({
      where: { id, userId },
      include: {
        sessions: {
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!task) {
      throw new AppError(`Task with ID ${id} was not found`, 404, 'NOT_FOUND');
    }

    if (
      task.status === TaskStatus.COMPLETED ||
      task.status === TaskStatus.FAILED ||
      task.status === TaskStatus.CANCELLED
    ) {
      throw new AppError(
        `Task is already in terminal state (${task.status})`,
        409,
        'TASK_ALREADY_FINISHED',
      );
    }

    // 1. Remove from queue if still waiting
    await removeQueuedJob(id);

    // 2. Abort active runner & stop sandbox container if running
    await cancelActiveTask(id);

    // 3. Persist CANCELLED status immediately and notify connected clients
    const updatedTask = await prisma.task.update({
      where: { id },
      data: { status: TaskStatus.CANCELLED },
    });

    const latestSession = task.sessions[0];
    if (latestSession && !latestSession.finishedAt) {
      const timestamp = new Date().toISOString();
      await prisma.session.update({
        where: { id: latestSession.id },
        data: {
          finishedAt: new Date(),
          logs: `${latestSession.logs || ''}[${timestamp}] Stop requested by user.\n`,
        },
      });
      SocketServer.emitTaskLog(id, 'Stop requested by user.');
    }

    SocketServer.emitTaskStatus(id, TaskStatus.CANCELLED);

    const response: ApiResponse<Task> = {
      success: true,
      data: updatedTask as unknown as Task,
      message: 'Task cancelled successfully',
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * Re-runs an existing task with the same repository URL and optional edited prompt/branch.
 */
export async function retryTask(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params;
    const { prompt: overridePrompt, branch: overrideBranch } = req.body || {};

    const original = await prisma.task.findFirst({ where: { id, userId } });
    if (!original) {
      throw new AppError(`Task with ID ${id} was not found`, 404, 'NOT_FOUND');
    }

    const nextPrompt =
      typeof overridePrompt === 'string' && overridePrompt.trim().length > 0
        ? overridePrompt.trim()
        : original.prompt;

    const repoUrl = original.repoUrl;
    if (!repoUrl.startsWith('http://') && !repoUrl.startsWith('https://')) {
      throw new AppError(
        'One-click retry is supported for Git repository URL tasks. Please re-upload ZIP archives.',
        400,
        'INVALID_INPUT',
      );
    }

    if (config.aiProvider === 'claude-code') {
      validateDemoGitHubUrl(repoUrl);
    }

    const newTask = await prisma.task.create({
      data: {
        userId,
        repoUrl,
        prompt: nextPrompt,
        status: TaskStatus.PENDING,
      },
    });

    try {
      await enqueueTask({
        taskId: newTask.id,
        repoUrl,
        prompt: nextPrompt,
        branch: typeof overrideBranch === 'string' && overrideBranch.trim() ? overrideBranch.trim() : undefined,
        userId: newTask.userId,
      });
    } catch (queueError) {
      logger.warn(`Queue dispatch warning for retried task ${newTask.id}:`, queueError);
      await prisma.task.update({ where: { id: newTask.id }, data: { status: TaskStatus.FAILED } });
      throw new AppError('Could not enqueue retried task', 503, 'QUEUE_UNAVAILABLE');
    }

    const response: ApiResponse<Task> = {
      success: true,
      data: newTask as unknown as Task,
      message: 'Task queued for re-run',
      timestamp: new Date().toISOString(),
    };

    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * Pushes a task's generated Git diff to a new branch and opens a GitHub Pull Request.
 */
export async function createPullRequest(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params;
    const { githubToken, githubSession, branchName, baseBranch, title, body } = req.body || {};

    let resolvedToken = typeof githubToken === 'string' ? githubToken.trim() : '';

    if (!resolvedToken) {
      let sealed =
        (typeof githubSession === 'string' && githubSession.trim()) ||
        (typeof req.headers['x-github-session'] === 'string'
          ? req.headers['x-github-session'].trim()
          : '');

      // Fall back to the user's persisted cross-device GitHub session in PostgreSQL
      if (!sealed) {
        const dbUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { githubSessionEncrypted: true },
        });
        sealed = dbUser?.githubSessionEncrypted || '';
      }

      if (sealed) {
        try {
          resolvedToken = unsealGitHubSession(sealed).accessToken;
        } catch {
          throw new AppError(
            'GitHub connection expired or invalid. Please reconnect GitHub.',
            401,
            'GITHUB_INVALID_SESSION',
          );
        }
      }
    }

    if (!resolvedToken) {
      throw new AppError(
        'Connect your GitHub account or provide a GitHub Personal Access Token',
        400,
        'INVALID_INPUT',
      );
    }

    const task = await prisma.task.findFirst({
      where: { id, userId },
      include: {
        sessions: {
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!task) {
      throw new AppError(`Task with ID ${id} was not found`, 404, 'NOT_FOUND');
    }

    let diff = task.sessions[0]?.resultDiff || '';
    if (!diff) {
      const workspacePath = GitService.getWorkspacePath(id);
      diff = await GitService.getGitDiff(workspacePath);
    }

    if (!diff || !diff.trim()) {
      throw new AppError('No Git diff is available for this task', 400, 'NO_DIFF');
    }

    let prResult: CreatePullRequestResult;
    try {
      prResult = await GitHubPrService.openPullRequestFromDiff({
        taskId: task.id,
        repoUrl: task.repoUrl,
        diff,
        prompt: task.prompt,
        githubToken: resolvedToken,
        branchName,
        baseBranch,
        title,
        body,
      });
    } catch (err) {
      const e = err as Error;
      throw new AppError(e.message || 'Failed to open Pull Request on GitHub', 400, 'PR_FAILED');
    }

    const response: ApiResponse<CreatePullRequestResult> = {
      success: true,
      data: prResult,
      message: `Pull Request #${prResult.prNumber} opened successfully`,
      timestamp: new Date().toISOString(),
    };

    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
}
