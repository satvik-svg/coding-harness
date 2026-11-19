import { Router } from 'express';
import { register, login, getMe } from '../controllers/authController';
import {
  getGitHubStatus,
  startGitHubOAuth,
  handleGitHubOAuthCallback,
  listGitHubRepos,
} from '../controllers/githubAuthController';
import { authenticate } from '../middlewares/auth';
import { authRateLimiter } from '../middlewares/rateLimiter';

export const authRoutes = Router();

authRoutes.post('/register', authRateLimiter, register);
authRoutes.post('/login', authRateLimiter, login);
authRoutes.get('/me', authenticate, getMe);

// GitHub OAuth 2.0 integration
authRoutes.get('/github/status', getGitHubStatus);
authRoutes.get('/github/start', startGitHubOAuth);
authRoutes.get('/github/callback', handleGitHubOAuthCallback);
authRoutes.get('/github/repos', listGitHubRepos);
