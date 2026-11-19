import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { GitHubRepoSummary } from '@coding-harness/shared';
import { config } from '../config';

export interface SealedGitHubPayload {
  accessToken: string;
  login: string;
  name: string | null;
  avatarUrl: string;
  iat: number;
}

interface OAuthStatePayload {
  nonce: string;
  returnTo: string;
  origin: string;
}

function getEncryptionKey(): Buffer {
  return crypto.createHash('sha256').update(`github-oauth:${config.jwtSecret}`).digest();
}

export function isGitHubOAuthConfigured(): boolean {
  return Boolean(config.githubClientId.trim() && config.githubClientSecret.trim());
}

/**
 * Encrypts the GitHub access token + user metadata into an authenticated AES-256-GCM token
 * so the raw GitHub token is never exposed in plaintext to browser JavaScript or storage.
 */
export function sealGitHubSession(payload: Omit<SealedGitHubPayload, 'iat'>): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify({ ...payload, iat: Date.now() });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64url');
}

/**
 * Decrypts and authenticates a previously sealed GitHub session token.
 */
export function unsealGitHubSession(token: string): SealedGitHubPayload {
  const raw = Buffer.from(token.trim(), 'base64url');
  if (raw.length < 29) {
    throw new Error('Invalid GitHub session token');
  }
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  const parsed = JSON.parse(decrypted) as SealedGitHubPayload;
  if (!parsed.accessToken || !parsed.login) {
    throw new Error('Malformed GitHub session payload');
  }
  return parsed;
}

/**
 * Signs a short-lived anti-CSRF OAuth state token.
 */
export function signOAuthState(origin: string, returnTo: string): string {
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
  const payload: OAuthStatePayload = {
    nonce: crypto.randomBytes(16).toString('hex'),
    returnTo: safeReturn,
    origin,
  };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '10m' });
}

export function verifyOAuthState(stateToken: string): OAuthStatePayload {
  const decoded = jwt.verify(stateToken, config.jwtSecret) as OAuthStatePayload;
  if (!decoded?.nonce || !decoded?.origin) {
    throw new Error('Invalid OAuth state');
  }
  return decoded;
}

/**
 * Exchanges an OAuth authorization code for a GitHub access token.
 */
export async function exchangeCodeForGitHubToken(
  code: string,
  redirectUri: string,
): Promise<string> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'coding-harness',
    },
    body: JSON.stringify({
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || 'Failed to exchange GitHub OAuth code');
  }

  return json.access_token;
}

/**
 * Fetches authenticated GitHub user profile details.
 */
export async function fetchGitHubProfile(accessToken: string): Promise<{
  login: string;
  name: string | null;
  avatarUrl: string;
}> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'coding-harness',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch GitHub user profile (${res.status})`);
  }

  const data = (await res.json()) as {
    login?: string;
    name?: string | null;
    avatar_url?: string;
  };

  if (!data.login) {
    throw new Error('GitHub user response missing login');
  }

  return {
    login: data.login,
    name: data.name ?? null,
    avatarUrl: data.avatar_url || '',
  };
}

/**
 * Lists the user's recently updated GitHub repositories for 1-click selection.
 */
export async function fetchGitHubRepos(accessToken: string): Promise<GitHubRepoSummary[]> {
  const res = await fetch(
    'https://api.github.com/user/repos?sort=updated&per_page=30&affiliation=owner,collaborator',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'coding-harness',
      },
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to load GitHub repositories (${res.status})`);
  }

  const repos = (await res.json()) as Array<{
    id: number;
    full_name: string;
    html_url: string;
    default_branch: string;
    private: boolean;
    updated_at: string;
  }>;

  return repos.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    htmlUrl: r.html_url,
    defaultBranch: r.default_branch,
    private: r.private,
    updatedAt: r.updated_at,
  }));
}
