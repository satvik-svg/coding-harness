import { Request, Response, NextFunction } from 'express';
import { ApiResponse, GitHubConnectionInfo, GitHubRepoSummary } from '@coding-harness/shared';
import { config } from '../config';
import { prisma } from '../db/client';
import { AppError } from '../middlewares/errorHandler';
import { AuthenticatedRequest } from '../middlewares/auth';
import {
  exchangeCodeForGitHubToken,
  fetchGitHubProfile,
  fetchGitHubRepos,
  isGitHubOAuthConfigured,
  sealGitHubSession,
  signOAuthState,
  unsealGitHubSession,
  verifyOAuthState,
} from '../services/githubOAuthService';
import { logger } from '../logger';

function resolveCallbackUrl(req: Request): string {
  if (config.githubCallbackUrl) {
    return config.githubCallbackUrl;
  }
  const forwardedProto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim();
  const proto = forwardedProto || req.protocol || 'http';
  const host =
    (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() ||
    req.get('host') ||
    `localhost:${config.port}`;
  return `${proto}://${host}/api/auth/github/callback`;
}

function resolveFrontendOrigin(req: Request, requestedOrigin?: string): string {
  if (requestedOrigin) {
    try {
      const parsed = new URL(requestedOrigin);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        const reqHost =
          (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() ||
          req.get('host') ||
          '';
        const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
        if (isLocal || parsed.host === reqHost) {
          return parsed.origin;
        }
      }
    } catch {
      // Fall through to defaults
    }
  }
  if (config.frontendUrl) {
    return config.frontendUrl.replace(/\/+$/, '');
  }
  const forwardedProto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim();
  const proto = forwardedProto || req.protocol || 'http';
  const host =
    (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() || req.get('host');
  if (host && !host.includes(':4000')) {
    return `${proto}://${host}`;
  }
  return 'http://localhost:3000';
}

function extractGitHubSessionHeader(req: Request): string {
  const header = req.headers['x-github-session'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  return '';
}

/**
 * Resolves the active sealed GitHub session token for a request:
 * prefers the authenticated user's DB-persisted session (cross-device),
 * falling back to the X-GitHub-Session header.
 */
async function resolveSealedGitHubSession(req: AuthenticatedRequest): Promise<string> {
  const headerToken = extractGitHubSessionHeader(req);
  if (req.user?.id) {
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { githubSessionEncrypted: true },
      });
      if (dbUser?.githubSessionEncrypted) {
        return dbUser.githubSessionEncrypted;
      }
    } catch {
      // Fall back to header if DB is temporarily unreachable
    }
  }
  return headerToken;
}

/**
 * Reports whether GitHub OAuth is configured on the server and, if connected
 * (either persisted on the signed-in user's account or via header), returns profile metadata.
 */
export async function getGitHubStatus(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const configured = isGitHubOAuthConfigured();
    const sessionToken = await resolveSealedGitHubSession(req);

    let data: GitHubConnectionInfo = { connected: false, configured };

    if (sessionToken) {
      try {
        const session = unsealGitHubSession(sessionToken);
        data = {
          connected: true,
          configured,
          login: session.login,
          name: session.name,
          avatarUrl: session.avatarUrl,
        };
      } catch {
        data = { connected: false, configured };
      }
    }

    const response: ApiResponse<GitHubConnectionInfo> = {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * Persists an authenticated user's sealed GitHub OAuth session in PostgreSQL
 * so their GitHub connection carries over across all browsers and devices.
 */
export async function linkGitHubSession(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user?.id) {
      throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    }

    const sealed =
      (typeof req.body?.githubSession === 'string' && req.body.githubSession.trim()) ||
      extractGitHubSessionHeader(req);

    if (!sealed) {
      throw new AppError('A valid GitHub session token is required', 400, 'INVALID_INPUT');
    }

    let payload;
    try {
      payload = unsealGitHubSession(sealed);
    } catch {
      throw new AppError('Invalid or corrupted GitHub session token', 400, 'GITHUB_INVALID_SESSION');
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: { githubSessionEncrypted: sealed },
    });

    logger.info(`Persisted GitHub OAuth link (@${payload.login}) for user ${req.user.id}`);

    const response: ApiResponse<GitHubConnectionInfo> = {
      success: true,
      data: {
        connected: true,
        configured: isGitHubOAuthConfigured(),
        login: payload.login,
        name: payload.name,
        avatarUrl: payload.avatarUrl,
      },
      message: `Linked GitHub account @${payload.login}`,
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * Removes the persisted GitHub OAuth session from the signed-in user's account.
 */
export async function disconnectGitHubSession(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user?.id) {
      throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: { githubSessionEncrypted: null },
    });

    logger.info(`Disconnected GitHub OAuth for user ${req.user.id}`);

    const response: ApiResponse<GitHubConnectionInfo> = {
      success: true,
      data: {
        connected: false,
        configured: isGitHubOAuthConfigured(),
      },
      message: 'GitHub account disconnected',
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * Initiates the GitHub OAuth 2.0 redirect flow.
 */
export function startGitHubOAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    if (!isGitHubOAuthConfigured()) {
      throw new AppError(
        'GitHub OAuth is not configured on this server (missing GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET)',
        503,
        'GITHUB_OAUTH_UNCONFIGURED',
      );
    }

    const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '/';
    const requestedOrigin = typeof req.query.origin === 'string' ? req.query.origin : undefined;
    const frontendOrigin = resolveFrontendOrigin(req, requestedOrigin);
    const redirectUri = resolveCallbackUrl(req);
    const state = signOAuthState(frontendOrigin, returnTo);

    const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
    authorizeUrl.searchParams.set('client_id', config.githubClientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', 'repo');
    authorizeUrl.searchParams.set('state', state);

    res.redirect(302, authorizeUrl.toString());
  } catch (error) {
    next(error);
  }
}

/**
 * Handles the GitHub OAuth callback, seals the access token, and redirects back
 * to the frontend with the encrypted session token in the URL hash fragment.
 */
export async function handleGitHubOAuthCallback(
  req: Request,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
  const oauthError = typeof req.query.error === 'string' ? req.query.error : '';

  let targetOrigin = resolveFrontendOrigin(req);
  let returnTo = '/';

  try {
    if (stateParam) {
      const verified = verifyOAuthState(stateParam);
      targetOrigin = verified.origin;
      returnTo = verified.returnTo;
    }

    if (oauthError) {
      res.redirect(302, `${targetOrigin}${returnTo}#gh_error=${encodeURIComponent(oauthError)}`);
      return;
    }

    if (!code || !stateParam) {
      res.redirect(
        302,
        `${targetOrigin}${returnTo}#gh_error=${encodeURIComponent('Missing OAuth code or state')}`,
      );
      return;
    }

    const redirectUri = resolveCallbackUrl(req);
    const accessToken = await exchangeCodeForGitHubToken(code, redirectUri);
    const profile = await fetchGitHubProfile(accessToken);

    const sealedSession = sealGitHubSession({
      accessToken,
      login: profile.login,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
    });

    logger.info(`GitHub OAuth connected for @${profile.login}`);
    res.redirect(
      302,
      `${targetOrigin}${returnTo}#gh_session=${encodeURIComponent(sealedSession)}`,
    );
  } catch (err) {
    const error = err as Error;
    logger.error('GitHub OAuth callback error:', error);
    res.redirect(
      302,
      `${targetOrigin}${returnTo}#gh_error=${encodeURIComponent(error.message || 'GitHub authentication failed')}`,
    );
  }
}

/**
 * Lists the connected user's recently updated GitHub repositories (public & private).
 */
export async function listGitHubRepos(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const sessionToken = await resolveSealedGitHubSession(req);
    if (!sessionToken) {
      throw new AppError('GitHub account is not connected', 401, 'GITHUB_NOT_CONNECTED');
    }

    let session;
    try {
      session = unsealGitHubSession(sessionToken);
    } catch {
      throw new AppError(
        'Invalid or expired GitHub session. Please reconnect.',
        401,
        'GITHUB_INVALID_SESSION',
      );
    }

    const repos = await fetchGitHubRepos(session.accessToken);
    const response: ApiResponse<{ repos: GitHubRepoSummary[] }> = {
      success: true,
      data: { repos },
      timestamp: new Date().toISOString(),
    };
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}
