import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { GitHubConnectionInfo, GitHubRepoSummary, User } from '@coding-harness/shared';
import {
  ApiService,
  getAuthToken,
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
  disconnectGitHub: () => void;
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
  disconnectGitHub: () => {},
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
      // Backend offline — keep default disconnected state
    }
  }, []);

  // Hydrate app auth + capture GitHub OAuth hash callback
  useEffect(() => {
    let active = true;

    const hydrate = async () => {
      // 1. Check URL hash for #gh_session=... or #gh_error=...
      if (typeof window !== 'undefined' && window.location.hash) {
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const ghSession = hashParams.get('gh_session');
        const ghError = hashParams.get('gh_error');

        if (ghSession || ghError) {
          // Immediately remove hash from URL so it isn't kept in browser history
          window.history.replaceState(
            null,
            '',
            window.location.pathname + window.location.search,
          );

          if (ghSession) {
            setGitHubSession(ghSession);
            toast('GitHub connected', {
              description: 'You can now pick repos and open Pull Requests in 1 click.',
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
      const token = getAuthToken();
      if (token) {
        try {
          const profile = await ApiService.getMe();
          if (active) setUser(profile);
        } catch {
          setAuthToken(null);
          if (active) setUser(null);
        }
      }

      // 3. Hydrate GitHub OAuth status & repos
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

  const login = useCallback(async (email: string, password: string) => {
    const res = await ApiService.login(email, password);
    setAuthToken(res.token);
    setUser(res.user);
    setAuthModalOpen(false);
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const res = await ApiService.register(email, password);
    setAuthToken(res.token);
    setUser(res.user);
    setAuthModalOpen(false);
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
  }, []);

  const connectGitHub = useCallback((returnTo?: string) => {
    if (typeof window === 'undefined') return;
    const targetPath = returnTo || window.location.pathname || '/';
    window.location.href = ApiService.getGitHubOAuthStartUrl(targetPath);
  }, []);

  const disconnectGitHub = useCallback(() => {
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
