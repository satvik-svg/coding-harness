import { Router } from 'express';
import { register, login, getMe } from '../controllers/authController';
import {
  getGitHubStatus,
  linkGitHubSession,
  disconnectGitHubSession,
  startGitHubOAuth,
  handleGitHubOAuthCallback,
  listGitHubRepos,
} from '../controllers/githubAuthController';
import { authenticate, optionalAuthenticate } from '../middlewares/auth';
import { authRateLimiter } from '../middlewares/rateLimiter';

export const authRoutes = Router();

authRoutes.post('/register', authRateLimiter, register);
authRoutes.post('/login', authRateLimiter, login);
authRoutes.get('/me', authenticate, getMe);

// GitHub OAuth 2.0 integration (persisted per user across devices when signed in)
authRoutes.get('/github/status', optionalAuthenticate, getGitHubStatus);
authRoutes.get('/github/start', startGitHubOAuth);
authRoutes.get('/github/callback', handleGitHubOAuthCallback);
authRoutes.get('/github/repos', optionalAuthenticate, listGitHubRepos);
authRoutes.post('/github/link', authenticate, linkGitHubSession);
authRoutes.delete('/github/disconnect', authenticate, disconnectGitHubSession);
