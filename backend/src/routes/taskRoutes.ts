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
import { optionalAuthenticate } from '../middlewares/auth';
import { uploadZipMiddleware } from '../services/storageService';
import { taskSubmissionLimiter } from '../middlewares/rateLimiter';

export const taskRoutes = Router();

// Create new coding task (supports multipart zip upload or json with repoUrl)
taskRoutes.post(
  '/',
  taskSubmissionLimiter,
  optionalAuthenticate,
  uploadZipMiddleware.single('file'),
  createTask,
);

// List tasks
taskRoutes.get('/', optionalAuthenticate, listTasks);

// Aggregated workspace & session analytics
taskRoutes.get('/analytics', optionalAuthenticate, getTaskAnalytics);

// Get task details and execution history
taskRoutes.get('/:id', optionalAuthenticate, getTaskById);

// Get latest generated Git diff
taskRoutes.get('/:id/diff', optionalAuthenticate, getTaskDiff);

// Stop / cancel an active task
taskRoutes.post('/:id/cancel', optionalAuthenticate, cancelTask);

// Retry or edit & re-run a task
taskRoutes.post('/:id/retry', taskSubmissionLimiter, optionalAuthenticate, retryTask);

// Push generated diff to a new branch and open a GitHub Pull Request
taskRoutes.post('/:id/pr', optionalAuthenticate, createPullRequest);
