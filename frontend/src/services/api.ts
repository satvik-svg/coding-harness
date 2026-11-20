import {
  ApiResponse,
  AuthResponse,
  CreatePullRequestInput,
  CreatePullRequestResult,
  GitHubConnectionInfo,
  GitHubRepoSummary,
  HealthCheckResponse,
  Task,
  TaskAnalytics,
  TaskMode,
  TaskStatus,
  TaskWithSessions,
  User,
} from '@coding-harness/shared';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const AUTH_TOKEN_KEY = 'ch_auth_token';
const GITHUB_SESSION_KEY = 'ch_github_session';

let inMemoryToken: string | null = null;
let inMemoryGitHubSession: string | null = null;

export function getAuthToken(): string | null {
  if (inMemoryToken) return inMemoryToken;
  if (typeof window !== 'undefined') {
    try {
      inMemoryToken = window.localStorage.getItem(AUTH_TOKEN_KEY);
    } catch {
      return null;
    }
  }
  return inMemoryToken;
}

export function setAuthToken(token: string | null): void {
  inMemoryToken = token;
  if (typeof window !== 'undefined') {
    try {
      if (token) window.localStorage.setItem(AUTH_TOKEN_KEY, token);
      else window.localStorage.removeItem(AUTH_TOKEN_KEY);
    } catch {
      // Ignore storage errors
    }
  }
}

export function getGitHubSession(): string | null {
  if (inMemoryGitHubSession) return inMemoryGitHubSession;
  if (typeof window !== 'undefined') {
    try {
      inMemoryGitHubSession = window.localStorage.getItem(GITHUB_SESSION_KEY);
    } catch {
      return null;
    }
  }
  return inMemoryGitHubSession;
}

export function setGitHubSession(session: string | null): void {
  inMemoryGitHubSession = session;
  if (typeof window !== 'undefined') {
    try {
      if (session) window.localStorage.setItem(GITHUB_SESSION_KEY, session);
      else window.localStorage.removeItem(GITHUB_SESSION_KEY);
    } catch {
      // Ignore storage errors
    }
  }
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const ghSession = getGitHubSession();
  if (ghSession) headers['X-GitHub-Session'] = ghSession;
  return headers;
}

export interface SubmitTaskPayload {
  repoUrl?: string;
  branch?: string;
  prompt: string;
  file?: File;
  mode?: TaskMode;
}

export interface ProjectCost {
  status: 'available' | 'pending' | 'unavailable';
  currency?: string;
  grossCost?: number;
  netCost?: number;
  exportedAt?: string;
  latestUsage?: string;
  checkedAt: string;
  stale?: boolean;
}

export class ApiService {
  static getGitHubOAuthStartUrl(returnTo: string = '/'): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const params = new URLSearchParams({ returnTo });
    if (origin) params.set('origin', origin);
    return `${API_BASE_URL}/api/auth/github/start?${params.toString()}`;
  }

  static async getGitHubStatus(): Promise<GitHubConnectionInfo> {
    const res = await fetch(`${API_BASE_URL}/api/auth/github/status`, {
      cache: 'no-store',
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error('Could not check GitHub connection');
    const json: ApiResponse<GitHubConnectionInfo> = await res.json();
    return json.data;
  }

  static async listGitHubRepos(): Promise<GitHubRepoSummary[]> {
    const res = await fetch(`${API_BASE_URL}/api/auth/github/repos`, {
      cache: 'no-store',
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error('Could not load GitHub repositories');
    const json: ApiResponse<{ repos: GitHubRepoSummary[] }> = await res.json();
    return json.data.repos;
  }

  static async linkGitHubSession(githubSession: string): Promise<GitHubConnectionInfo> {
    const res = await fetch(`${API_BASE_URL}/api/auth/github/link`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ githubSession }),
    });
    if (!res.ok) throw new Error('Could not persist GitHub connection to account');
    const json: ApiResponse<GitHubConnectionInfo> = await res.json();
    return json.data;
  }

  static async disconnectGitHub(): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/api/auth/github/disconnect`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!res.ok && res.status !== 401) {
      throw new Error('Could not disconnect GitHub account');
    }
  }

  static async getProjectCost(): Promise<ProjectCost> {
    const res = await fetch(`${API_BASE_URL}/api/project-cost`, {
      cache: 'no-store',
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error('Could not load project cost');
    const json: ApiResponse<ProjectCost> = await res.json();
    return json.data;
  }

  static async getHealth(): Promise<HealthCheckResponse> {
    const res = await fetch(`${API_BASE_URL}/health`, { headers: authHeaders() });
    const json: ApiResponse<HealthCheckResponse> = await res.json();
    return json.data;
  }

  // --- Auth Endpoints ---

  static async register(email: string, password: string): Promise<AuthResponse> {
    const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error?.message || 'Registration failed');
    }
    return json.data as AuthResponse;
  }

  static async login(email: string, password: string): Promise<AuthResponse> {
    const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error?.message || 'Invalid credentials');
    }
    return json.data as AuthResponse;
  }

  static async getMe(): Promise<User> {
    const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      throw new Error('Not authenticated');
    }
    const json: ApiResponse<{ user: User }> = await res.json();
    return json.data.user;
  }

  // --- Task Endpoints ---

  static async submitTask(payload: SubmitTaskPayload): Promise<Task> {
    let res: Response;

    if (payload.file) {
      const formData = new FormData();
      formData.append('file', payload.file);
      formData.append('prompt', payload.prompt);
      if (payload.branch) formData.append('branch', payload.branch);
      if (payload.mode) formData.append('mode', payload.mode);

      res = await fetch(`${API_BASE_URL}/api/tasks`, {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });
    } else {
      res = await fetch(`${API_BASE_URL}/api/tasks`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          repoUrl: payload.repoUrl,
          branch: payload.branch,
          prompt: payload.prompt,
          mode: payload.mode,
        }),
      });
    }

    if (!res.ok) {
      const errorJson = await res.json().catch(() => ({}));
      throw new Error(errorJson.error?.message || `Failed to submit task (Status: ${res.status})`);
    }

    const json: ApiResponse<Task> = await res.json();
    return json.data;
  }

  static async getTask(taskId: string): Promise<TaskWithSessions> {
    const res = await fetch(`${API_BASE_URL}/api/tasks/${taskId}`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Task ${taskId} not found`);
    }
    const json: ApiResponse<TaskWithSessions> = await res.json();
    return json.data;
  }

  static async listTasks(
    limit: number = 20,
    offset: number = 0,
    options: { userOnly?: boolean; status?: TaskStatus } = {},
  ): Promise<{ tasks: Task[]; total: number }> {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (options.userOnly) params.set('userOnly', 'true');
    if (options.status) params.set('status', options.status);

    const res = await fetch(`${API_BASE_URL}/api/tasks?${params.toString()}`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      throw new Error('Failed to list tasks');
    }
    const json: ApiResponse<{ tasks: Task[]; total: number }> = await res.json();
    return json.data;
  }

  static async getTaskAnalytics(userOnly: boolean = false): Promise<TaskAnalytics> {
    const params = userOnly ? '?userOnly=true' : '';
    const res = await fetch(`${API_BASE_URL}/api/tasks/analytics${params}`, {
      cache: 'no-store',
      headers: authHeaders(),
    });
    if (!res.ok) {
      throw new Error('Failed to load analytics');
    }
    const json: ApiResponse<TaskAnalytics> = await res.json();
    return json.data;
  }

  static async getTaskDiff(taskId: string): Promise<string> {
    const res = await fetch(`${API_BASE_URL}/api/tasks/${taskId}/diff`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      return '';
    }
    const json: ApiResponse<{ diff: string }> = await res.json();
    return json.data.diff || '';
  }

  static async cancelTask(taskId: string): Promise<Task> {
    const res = await fetch(`${API_BASE_URL}/api/tasks/${taskId}/cancel`, {
      method: 'POST',
      headers: authHeaders(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error?.message || 'Failed to stop task');
    }
    return json.data as Task;
  }

  static async retryTask(
    taskId: string,
    overrides?: { prompt?: string; branch?: string },
  ): Promise<Task> {
    const res = await fetch(`${API_BASE_URL}/api/tasks/${taskId}/retry`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(overrides || {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error?.message || 'Failed to retry task');
    }
    return json.data as Task;
  }

  static async createPullRequest(
    taskId: string,
    input: CreatePullRequestInput,
  ): Promise<CreatePullRequestResult> {
    const res = await fetch(`${API_BASE_URL}/api/tasks/${taskId}/pr`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(input),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error?.message || 'Failed to open Pull Request');
    }
    return json.data as CreatePullRequestResult;
  }
}
