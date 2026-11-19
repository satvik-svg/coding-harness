import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import {
  ArrowLeft,
  GitBranch,
  RefreshCw,
  AlertCircle,
  Share2,
  Check,
  Square,
  RotateCcw,
  Pencil,
  Loader2,
  X,
} from 'lucide-react';
import { ApiService } from '../../services/api';
import { subscribeToTask } from '../../services/socket';
import { ExecutionInspector } from '../../components/ExecutionInspector';
import { AgentStateCard } from '../../components/AgentStateCard';
import { DiffViewer } from '../../components/DiffViewer';
import { TaskResult } from '../../components/TaskResult';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { TaskWithSessions, TaskStatus, AgentStepLog } from '@coding-harness/shared';

export default function TaskExecutionView() {
  const router = useRouter();
  const { id } = router.query;
  const taskId = typeof id === 'string' ? id : '';
  const { isAuthenticated, loading: authLoading, openAuthModal } = useAuth();
  const { toast, notifyBrowser } = useToast();

  const [task, setTask] = useState<TaskWithSessions | null>(null);
  const [selectedSessionIndex, setSelectedSessionIndex] = useState<number>(0);
  const [logs, setLogs] = useState<string>('');
  const [status, setStatus] = useState<TaskStatus>(TaskStatus.PENDING);
  const [diff, setDiff] = useState<string>('');
  const [summary, setSummary] = useState<string>('');
  const [startedAt, setStartedAt] = useState<Date | string | null>(null);
  const [finishedAt, setFinishedAt] = useState<Date | string | null>(null);
  const [steps, setSteps] = useState<AgentStepLog[]>([]);
  const [latestStep, setLatestStep] = useState<AgentStepLog | undefined>(undefined);
  const [iterations, setIterations] = useState<number>(0);
  const [toolCallsCount, setToolCallsCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // Live execution control states
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState('');
  const [editedBranch, setEditedBranch] = useState('');

  const prevStatusRef = useRef<TaskStatus | null>(null);
  const selectedSessionIndexRef = useRef<number>(0);

  useEffect(() => {
    selectedSessionIndexRef.current = selectedSessionIndex;
  }, [selectedSessionIndex]);

  const applySessionToView = useCallback(
    (data: TaskWithSessions, sessionIdx: number) => {
      const target = data.sessions?.[sessionIdx] || data.sessions?.[0];
      setSummary(target?.resultSummary || '');
      setStartedAt(target?.startedAt || data.createdAt);
      setFinishedAt(target?.finishedAt || null);
      setLogs(target?.logs || '');
      setDiff(target?.resultDiff || '');
    },
    [],
  );

  const fetchTaskDetails = useCallback(async () => {
    if (!taskId) return;
    try {
      const data = await ApiService.getTask(taskId);
      setTask(data);
      setStatus(data.status);
      setEditedPrompt(data.prompt);

      const safeIdx =
        selectedSessionIndexRef.current < (data.sessions?.length || 0)
          ? selectedSessionIndexRef.current
          : 0;
      applySessionToView(data, safeIdx);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load task details');
    } finally {
      setIsLoading(false);
    }
  }, [taskId, applySessionToView]);

  const handleSelectSession = (index: number) => {
    setSelectedSessionIndex(index);
    if (task) {
      applySessionToView(task, index);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setIsLoading(false);
      setTask(null);
      return;
    }
    if (taskId) {
      setIsLoading(true);
      setSelectedSessionIndex(0);
      setErrorMessage(null);
      setLogs('');
      setDiff('');
      setSummary('');
      setSteps([]);
      setLatestStep(undefined);
      prevStatusRef.current = null;
      fetchTaskDetails();
    }
  }, [taskId, authLoading, isAuthenticated, fetchTaskDetails]);

  // Real-time WebSocket subscription
  useEffect(() => {
    if (!taskId || !isAuthenticated) return;

    const unsubscribe = subscribeToTask(taskId, {
      onLog: (newLog) => {
        if (selectedSessionIndexRef.current === 0) {
          setLogs((prev) => (prev ? `${prev}${newLog}\n` : `${newLog}\n`));
        }
      },
      onStatus: (newStatus) => {
        const previous = prevStatusRef.current;
        setStatus(newStatus);

        const isTerminal =
          newStatus === TaskStatus.COMPLETED ||
          newStatus === TaskStatus.FAILED ||
          newStatus === TaskStatus.CANCELLED;

        if (isTerminal) {
          fetchTaskDetails();

          if (previous === TaskStatus.RUNNING || previous === TaskStatus.PENDING) {
            const label =
              newStatus === TaskStatus.COMPLETED
                ? 'Task completed'
                : newStatus === TaskStatus.CANCELLED
                  ? 'Task stopped'
                  : 'Task failed';
            toast(label, {
              description: task?.repoUrl.replace('https://github.com/', '') || taskId.slice(0, 8),
              variant:
                newStatus === TaskStatus.COMPLETED
                  ? 'success'
                  : newStatus === TaskStatus.FAILED
                    ? 'error'
                    : 'info',
            });
            notifyBrowser(
              `Coding Harness · ${label}`,
              task?.prompt?.slice(0, 90) || `Session ${taskId.slice(0, 8)} finished.`,
            );
          }
        }
      },
      onStep: (stepLog) => {
        setLatestStep(stepLog);
        setSteps((prev) => [...prev, stepLog]);
        if (stepLog.step) setIterations(stepLog.step);
        if (stepLog.action === 'TOOL_CALL') {
          setToolCallsCount((prev) => prev + 1);
        }
      },
      onDiff: (newDiff) => {
        setDiff(newDiff);
      },
    });

    return () => {
      unsubscribe();
    };
  }, [taskId, fetchTaskDetails, toast, notifyBrowser, task?.repoUrl, task?.prompt]);

  useEffect(() => {
    prevStatusRef.current = status;
  }, [status]);

  const handleCopyLink = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
      toast('Session link copied', { variant: 'info' });
      setTimeout(() => setLinkCopied(false), 2000);
    }
  };

  const handleCancel = async () => {
    if (!taskId || isCancelling) return;
    setIsCancelling(true);
    try {
      await ApiService.cancelTask(taskId);
      setStatus(TaskStatus.CANCELLED);
      toast('Stop signal sent', { description: 'Active task cancelled.', variant: 'info' });
      fetchTaskDetails();
    } catch (err: any) {
      toast('Could not stop task', { description: err.message, variant: 'error' });
    } finally {
      setIsCancelling(false);
    }
  };

  const handleQuickRetry = async () => {
    if (!taskId || isRetrying) return;
    setIsRetrying(true);
    try {
      const nextTask = await ApiService.retryTask(taskId);
      toast('Re-run queued', { description: 'Redirecting to new session…', variant: 'success' });
      router.push(`/tasks/${nextTask.id}`);
    } catch (err: any) {
      toast('Retry failed', { description: err.message, variant: 'error' });
      setIsRetrying(false);
    }
  };

  const handleEditRerunSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskId || !editedPrompt.trim()) return;
    setIsRetrying(true);
    try {
      const nextTask = await ApiService.retryTask(taskId, {
        prompt: editedPrompt.trim(),
        branch: editedBranch.trim() || undefined,
      });
      setEditModalOpen(false);
      toast('Edited task queued', {
        description: 'Launching new agent session…',
        variant: 'success',
      });
      router.push(`/tasks/${nextTask.id}`);
    } catch (err: any) {
      toast('Re-run failed', { description: err.message, variant: 'error' });
      setIsRetrying(false);
    }
  };

  const isActive = status === TaskStatus.RUNNING || status === TaskStatus.PENDING;
  const canRetry = Boolean(
    task?.repoUrl && (task.repoUrl.startsWith('http://') || task.repoUrl.startsWith('https://')),
  );

  if (authLoading || isLoading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="flex items-center gap-2.5 text-sm text-zinc-400">
          <RefreshCw className="w-4 h-4 text-brand-400 animate-spin" />
          <span>Loading session…</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center space-y-3 animate-enter">
        <AlertCircle className="w-8 h-8 text-brand-400 mx-auto" />
        <h2 className="text-base font-semibold text-zinc-100">Sign in required</h2>
        <p className="text-xs text-zinc-500">
          Sessions are private to the account that created them. Sign in to view this task.
        </p>
        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => openAuthModal('login')}
            className="px-3.5 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-xs font-medium text-white transition-colors"
          >
            Sign in
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#111216] hover:bg-[#191b22] border border-white/[0.08] text-xs text-zinc-200 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Dashboard</span>
          </Link>
        </div>
      </div>
    );
  }

  if (errorMessage && !task) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center space-y-3 animate-enter">
        <AlertCircle className="w-8 h-8 text-rose-400 mx-auto" />
        <h2 className="text-base font-semibold text-zinc-100">Task not found</h2>
        <p className="text-xs text-zinc-500">{errorMessage}</p>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#111216] hover:bg-[#191b22] border border-white/[0.08] text-xs text-zinc-200 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to tasks</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5 animate-enter">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/[0.07]">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            className="p-2 rounded-lg bg-[#0f1014] hover:bg-[#181a22] border border-white/[0.08] text-zinc-400 hover:text-zinc-100 transition-colors"
            title="Back to tasks"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold font-mono text-zinc-100 truncate">
                {taskId.substring(0, 12)}
              </h1>
              <span className="text-xs text-zinc-600">
                {task?.createdAt ? new Date(task.createdAt).toLocaleTimeString() : ''}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-zinc-500 mt-0.5">
              <GitBranch className="w-3 h-3 text-brand-400 flex-shrink-0" />
              <span className="font-mono truncate">{task?.repoUrl}</span>
            </div>
          </div>
        </div>

        {/* Execution & Session Actions */}
        <div className="flex flex-wrap items-center gap-1.5">
          {isActive && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={isCancelling}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/35 text-xs font-medium text-rose-300 transition-colors disabled:opacity-50"
            >
              {isCancelling ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Square className="w-3 h-3 fill-current" />
              )}
              <span>{isCancelling ? 'Stopping…' : 'Stop agent'}</span>
            </button>
          )}

          {canRetry && (
            <>
              <button
                type="button"
                onClick={handleQuickRetry}
                disabled={isRetrying}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0f1014] hover:bg-[#181a22] border border-white/[0.08] hover:border-brand-500/40 text-xs font-medium text-zinc-200 transition-colors disabled:opacity-50"
                title="Re-run with the same repository and prompt"
              >
                {isRetrying ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5 text-brand-400" />
                )}
                <span>Retry</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setEditedPrompt(task?.prompt || '');
                  setEditModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0f1014] hover:bg-[#181a22] border border-white/[0.08] hover:border-white/[0.18] text-xs text-zinc-300 hover:text-white transition-colors"
                title="Edit prompt or branch and launch a new run"
              >
                <Pencil className="w-3 h-3" />
                <span>Edit &amp; re-run</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={fetchTaskDetails}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0f1014] hover:bg-[#181a22] border border-white/[0.08] text-xs text-zinc-400 hover:text-white transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleCopyLink}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0f1014] hover:bg-[#181a22] border border-white/[0.08] text-xs text-zinc-300 hover:text-white transition-colors"
          >
            {linkCopied ? (
              <Check className="w-3.5 h-3.5 text-brand-400" />
            ) : (
              <Share2 className="w-3.5 h-3.5" />
            )}
            <span>{linkCopied ? 'Copied' : 'Share'}</span>
          </button>
        </div>
      </div>

      {/* Attempt / Session History Switcher (shown when a task had retries/multiple sessions) */}
      {task?.sessions && task.sessions.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 rounded-xl bg-[#0f1014] border border-white/[0.07]">
          <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mr-1">
            Run attempts ({task.sessions.length})
          </span>
          {task.sessions.map((s, idx) => {
            const attemptNum = task.sessions.length - idx;
            const lineCount = s.logs
              ? s.logs.split('\n').filter((l) => l.trim().length > 0).length
              : 0;
            const active = selectedSessionIndex === idx;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSelectSession(idx)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  active
                    ? 'bg-brand-600/20 text-brand-300 border border-brand-500/35'
                    : 'bg-[#09090b] text-zinc-400 hover:text-zinc-200 border border-white/[0.07]'
                }`}
              >
                <span>Attempt {attemptNum}</span>
                {idx === 0 && <span className="text-[10px] text-zinc-500">latest</span>}
                <span className="font-mono text-[10px] text-zinc-500">· {lineCount} lines</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Primary Split Workspace: Inspector (Timeline/Console) + State & Thread */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-7 h-[640px]">
          <ExecutionInspector
            logs={logs}
            steps={selectedSessionIndex === 0 ? steps : []}
            isRunning={selectedSessionIndex === 0 && status === TaskStatus.RUNNING}
          />
        </div>

        <div className="lg:col-span-5 space-y-5">
          <AgentStateCard
            status={status}
            latestStep={latestStep}
            iterations={iterations}
            toolCallsCount={toolCallsCount}
            repoUrl={task?.repoUrl}
            startedAt={startedAt}
            finishedAt={finishedAt}
          />

          <TaskResult summary={summary} prompt={task?.prompt} status={status} />
        </div>
      </div>

      {/* Full-Width Code Diff & Changed Files Explorer */}
      <DiffViewer
        diff={diff}
        taskId={taskId}
        status={status}
        repoUrl={task?.repoUrl}
        prompt={task?.prompt}
      />

      {/* Edit & Re-Run Modal */}
      {editModalOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-enter"
          onClick={() => setEditModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-rerun-title"
        >
          <div
            className="w-full max-w-lg rounded-xl border border-white/[0.1] bg-[#0f1014] shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
              <h3 id="edit-rerun-title" className="text-sm font-semibold text-zinc-100">
                Edit &amp; re-run task
              </h3>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditRerunSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-[11px] font-medium text-zinc-500 mb-1">
                  Repository
                </label>
                <div className="px-3 py-2 rounded-lg bg-[#09090b] border border-white/[0.06] text-xs font-mono text-zinc-400 truncate">
                  {task?.repoUrl}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  Branch (optional)
                </label>
                <input
                  type="text"
                  placeholder="Default branch"
                  value={editedBranch}
                  onChange={(e) => setEditedBranch(e.target.value)}
                  className="w-full px-3 py-2 bg-[#09090b] border border-white/[0.08] focus:border-brand-500 rounded-lg text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  Prompt instructions
                </label>
                <textarea
                  required
                  rows={5}
                  value={editedPrompt}
                  onChange={(e) => setEditedPrompt(e.target.value)}
                  className="w-full px-3 py-2.5 bg-[#09090b] border border-white/[0.08] focus:border-brand-500 rounded-lg text-xs text-zinc-100 focus:outline-none resize-y leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-white/[0.08] text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRetrying}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium transition-colors disabled:opacity-50"
                >
                  {isRetrying ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Launching…</span>
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Launch re-run</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
