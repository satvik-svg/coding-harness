import { Router } from 'express';
import {
  createTask,
  getTaskAnalytics,
  getTaskById,
  listTasks,
  getTaskDiff,
  cancelTask,
  retryTask,
  createPullRequest,
} from '../controllers/taskController';
import { authenticate } from '../middlewares/auth';
import { uploadZipMiddleware } from '../services/storageService';
import { taskSubmissionLimiter } from '../middlewares/rateLimiter';

export const taskRoutes = Router();

// All task endpoints require an authenticated user and are strictly scoped to their private workspace
taskRoutes.use(authenticate);

// Create new coding task (supports multipart zip upload or json with repoUrl)
taskRoutes.post('/', taskSubmissionLimiter, uploadZipMiddleware.single('file'), createTask);

// List authenticated user's tasks
taskRoutes.get('/', listTasks);

// Aggregated private workspace & session analytics
taskRoutes.get('/analytics', getTaskAnalytics);

// Get task details and execution history (owner only)
taskRoutes.get('/:id', getTaskById);

// Get latest generated Git diff (owner only)
taskRoutes.get('/:id/diff', getTaskDiff);

// Stop / cancel an active task (owner only)
taskRoutes.post('/:id/cancel', cancelTask);

// Retry or edit & re-run a task (owner only)
taskRoutes.post('/:id/retry', taskSubmissionLimiter, retryTask);

// Push generated diff to a new branch and open a GitHub Pull Request (owner only)
taskRoutes.post('/:id/pr', createPullRequest);
