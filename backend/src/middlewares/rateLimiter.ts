import rateLimit from 'express-rate-limit';
import { ApiErrorResponse } from '@coding-harness/shared';
import { Request, Response } from 'express';

const createRateLimitHandler = (message: string, code: string) => {
  return (_req: Request, res: Response) => {
    const errorResponse: ApiErrorResponse = {
      success: false,
      error: {
        code,
        message,
      },
      timestamp: new Date().toISOString(),
    };
    res.status(429).json(errorResponse);
  };
};

/**
 * General API rate limiter preventing volumetric abuse.
 * 1000 requests per 15-minute window per client IP.
 * Skips lightweight read-only status checks and auth endpoints (which have their own limiter).
 */
export const globalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    req.path === '/health' ||
    req.path === '/project-cost' ||
    req.path.startsWith('/auth/'),
  handler: createRateLimitHandler(
    'Too many API requests. Please slow down and try again later.',
    'RATE_LIMIT_EXCEEDED',
  ),
});

/**
 * Strict authentication limiter preventing credential stuffing and brute-force attacks.
 * 30 attempts per 15-minute window per client IP.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createRateLimitHandler(
    'Too many authentication attempts. Please try again after 15 minutes.',
    'AUTH_RATE_LIMIT_EXCEEDED',
  ),
});

/**
 * Task submission limiter preventing resource exhaustion on background job queues and Docker sandboxes.
 * 20 task submissions per 15-minute window per IP.
 */
export const taskSubmissionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createRateLimitHandler(
    'Task submission rate limit exceeded. Please wait before scheduling more coding tasks.',
    'TASK_RATE_LIMIT_EXCEEDED',
  ),
});
