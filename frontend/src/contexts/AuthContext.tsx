import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { GitHubConnectionInfo, GitHubRepoSummary, User } from '@coding-harness/shared';
import {
  ApiService,
  getAuthToken,
  getGitHubSession,
  setAuthToken,
  setGitHubSession,
} from '../services/api';
import { useToast } from './ToastContext';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  authModalOpen: boolean;
  openAuthModal: (defaultTab?: 'login' | 'register') => void;
  closeAuthModal: () => void;
  authModalTab: 'login' | 'register';
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  github: GitHubConnectionInfo;
  githubRepos: GitHubRepoSummary[];
  connectGitHub: (returnTo?: string) => void;
  disconnectGitHub: () => Promise<void>;
  refreshGitHub: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  isAuthenticated: false,
  authModalOpen: false,
  openAuthModal: () => {},
  closeAuthModal: () => {},
  authModalTab: 'login',
  login: async () => {},
  register: async () => {},
  logout: () => {},
  github: { connected: false, configured: false },
  githubRepos: [],
  connectGitHub: () => {},
  disconnectGitHub: async () => {},
  refreshGitHub: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<'login' | 'register'>('login');
  const [github, setGithub] = useState<GitHubConnectionInfo>({
    connected: false,
    configured: false,
  });
  const [githubRepos, setGithubRepos] = useState<GitHubRepoSummary[]>([]);

  const refreshGitHub = useCallback(async () => {
    try {
      const status = await ApiService.getGitHubStatus();
      setGithub(status);
      if (status.connected) {
        try {
          const repos = await ApiService.listGitHubRepos();
          setGithubRepos(repos);
        } catch {
          setGithubRepos([]);
        }
      } else {
        setGithubRepos([]);
      }
    } catch {
      // Backend offline — keep default state
    }
  }, []);

  // Hydrate app auth + capture GitHub OAuth hash callback + persist link to user account
  useEffect(() => {
    let active = true;

    const hydrate = async () => {
      let incomingGhSession: string | null = null;

      // 1. Check URL hash for #gh_session=... or #gh_error=...
      if (typeof window !== 'undefined' && window.location.hash) {
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const ghSession = hashParams.get('gh_session');
        const ghError = hashParams.get('gh_error');

        if (ghSession || ghError) {
          window.history.replaceState(
            null,
            '',
            window.location.pathname + window.location.search,
          );

          if (ghSession) {
            incomingGhSession = ghSession;
            setGitHubSession(ghSession);
            toast('GitHub connected', {
              description: 'Private & public repos and 1-click Pull Requests are ready.',
              variant: 'success',
            });
          } else if (ghError) {
            toast('GitHub connection failed', {
              description: ghError,
              variant: 'error',
            });
          }
        }
      }

      // 2. Hydrate JWT user session if present
      let authenticatedUser: User | null = null;
      const token = getAuthToken();
      if (token) {
        try {
          authenticatedUser = await ApiService.getMe();
          if (active) setUser(authenticatedUser);
        } catch {
          setAuthToken(null);
          if (active) setUser(null);
        }
      }

      // 3. If user is signed in and we just received a new GitHub OAuth session (or have a local one), persist it to Postgres
      if (authenticatedUser) {
        const toPersist = incomingGhSession || getGitHubSession();
        if (toPersist) {
          try {
            await ApiService.linkGitHubSession(toPersist);
          } catch {
            // Non-fatal: header still works for this browser session
          }
        }
      }

      // 4. Hydrate GitHub OAuth status & repos (pulls from DB automatically across devices!)
      if (active) {
        await refreshGitHub();
        setLoading(false);
      }
    };

    hydrate();
    return () => {
      active = false;
    };
  }, [refreshGitHub, toast]);

  const openAuthModal = useCallback((defaultTab: 'login' | 'register' = 'login') => {
    setAuthModalTab(defaultTab);
    setAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setAuthModalOpen(false);
  }, []);

  const postAuthSync = useCallback(async () => {
    const localGh = getGitHubSession();
    if (localGh) {
      try {
        await ApiService.linkGitHubSession(localGh);
      } catch {
        // Ignore if local token is stale; DB token (if any) will load next
      }
    }
    await refreshGitHub();
  }, [refreshGitHub]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await ApiService.login(email, password);
      setAuthToken(res.token);
      setUser(res.user);
      setAuthModalOpen(false);
      await postAuthSync();
    },
    [postAuthSync],
  );

  const register = useCallback(
    async (email: string, password: string) => {
      const res = await ApiService.register(email, password);
      setAuthToken(res.token);
      setUser(res.user);
      setAuthModalOpen(false);
      await postAuthSync();
    },
    [postAuthSync],
  );

  const logout = useCallback(() => {
    setAuthToken(null);
    setGitHubSession(null);
    setUser(null);
    setGithub((prev) => ({ connected: false, configured: prev.configured }));
    setGithubRepos([]);
  }, []);

  const connectGitHub = useCallback((returnTo?: string) => {
    if (typeof window === 'undefined') return;
    const targetPath = returnTo || window.location.pathname || '/';
    window.location.href = ApiService.getGitHubOAuthStartUrl(targetPath);
  }, []);

  const disconnectGitHub = useCallback(async () => {
    try {
      if (getAuthToken()) {
        await ApiService.disconnectGitHub();
      }
    } catch {
      // Clear local state regardless
    }
    setGitHubSession(null);
    setGithub((prev) => ({ connected: false, configured: prev.configured }));
    setGithubRepos([]);
    toast('GitHub disconnected', { variant: 'info' });
  }, [toast]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: Boolean(user),
        authModalOpen,
        openAuthModal,
        closeAuthModal,
        authModalTab,
        login,
        register,
        logout,
        github,
        githubRepos,
        connectGitHub,
        disconnectGitHub,
        refreshGitHub,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
