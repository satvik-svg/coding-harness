import React, { useEffect, useState } from 'react';
import { X, Loader2, AlertCircle, Lock, Mail } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { LogoMark } from './LogoMark';

export function AuthModal() {
  const { authModalOpen, closeAuthModal, authModalTab, login, register } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<'login' | 'register'>(authModalTab);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTab(authModalTab);
    setError(null);
  }, [authModalTab, authModalOpen]);

  useEffect(() => {
    if (!authModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAuthModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authModalOpen, closeAuthModal]);

  if (!authModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (tab === 'login') {
        await login(email.trim(), password);
        toast('Signed in', { description: `Welcome back, ${email.trim()}`, variant: 'success' });
      } else {
        await register(email.trim(), password);
        toast('Account created', {
          description: 'Your private workspace is ready.',
          variant: 'success',
        });
      }
      setEmail('');
      setPassword('');
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-enter"
      onClick={closeAuthModal}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div
        className="w-full max-w-sm rounded-xl border border-white/[0.1] bg-[#0f1014] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <LogoMark className="w-6 h-6" />
            <h2 id="auth-modal-title" className="text-sm font-semibold text-zinc-100">
              {tab === 'login' ? 'Sign in to workspace' : 'Create account'}
            </h2>
          </div>
          <button
            type="button"
            onClick={closeAuthModal}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05] transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Tab Switcher */}
          <div className="grid grid-cols-2 p-0.5 rounded-lg bg-[#09090b] border border-white/[0.07]">
            <button
              type="button"
              onClick={() => {
                setTab('login');
                setError(null);
              }}
              className={`py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === 'login' ? 'bg-[#1c1f29] text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('register');
                setError(null);
              }}
              className={`py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === 'register'
                  ? 'bg-[#1c1f29] text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Register
            </button>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">Email</label>
              <div className="relative">
                <Mail className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  required
                  autoFocus
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-[#09090b] border border-white/[0.08] focus:border-brand-500 rounded-lg text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">Password</label>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder={tab === 'register' ? 'Minimum 6 characters' : '••••••••'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-[#09090b] border border-white/[0.08] focus:border-brand-500 rounded-lg text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium transition-colors disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{tab === 'login' ? 'Signing in…' : 'Creating account…'}</span>
                </>
              ) : (
                <span>{tab === 'login' ? 'Sign in' : 'Create account'}</span>
              )}
            </button>
          </form>

          <p className="text-[11px] text-zinc-500 text-center">
            Sign in to isolate your private task history and workspace analytics.
          </p>
        </div>
      </div>
    </div>
  );
}
