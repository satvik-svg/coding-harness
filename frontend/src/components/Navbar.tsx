import React, { useState } from 'react';
import Link from 'next/link';
import { Search, Bell, BellOff, LogOut, User as UserIcon, Unlink } from 'lucide-react';
import { LogoMark } from './LogoMark';
import { ProjectCostCard } from './ProjectCostCard';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

function GitHubIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

export function Navbar() {
  const { user, openAuthModal, logout, github, connectGitHub, disconnectGitHub } = useAuth();
  const { browserAlertsEnabled, toggleBrowserAlerts, toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [ghMenuOpen, setGhMenuOpen] = useState(false);

  const openCommandPalette = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ch:open-command-palette'));
    }
  };

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.07] bg-[#09090b]/85 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2.5 group flex-shrink-0">
          <LogoMark className="w-8 h-8 transition-transform duration-200 group-hover:scale-[1.04]" />
          <div className="flex items-baseline gap-1 tracking-tight">
            <span className="font-semibold text-[15px] text-zinc-100">Coding</span>
            <span className="font-normal text-[15px] text-zinc-400 group-hover:text-zinc-300 transition-colors">
              Harness
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          {/* Command Palette Trigger */}
          <button
            type="button"
            onClick={openCommandPalette}
            className="hidden sm:flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#111216] hover:border-white/[0.16] px-2.5 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Open command palette (⌘K)"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Search</span>
            <kbd className="ml-1 px-1 py-0.5 rounded bg-white/[0.05] border border-white/[0.07] font-mono text-[10px] text-zinc-400">
              ⌘K
            </kbd>
          </button>

          {/* Desktop Notification Toggle */}
          <button
            type="button"
            onClick={() => void toggleBrowserAlerts()}
            className={`p-1.5 rounded-lg border transition-colors ${
              browserAlertsEnabled
                ? 'border-brand-500/35 bg-brand-500/10 text-brand-400 hover:bg-brand-500/15'
                : 'border-white/[0.08] bg-[#111216] text-zinc-500 hover:text-zinc-200 hover:border-white/[0.16]'
            }`}
            title={
              browserAlertsEnabled
                ? 'Desktop completion alerts enabled'
                : 'Enable desktop alerts when tasks finish'
            }
            aria-label="Toggle desktop notifications"
          >
            {browserAlertsEnabled ? (
              <Bell className="w-3.5 h-3.5" />
            ) : (
              <BellOff className="w-3.5 h-3.5" />
            )}
          </button>

          <ProjectCostCard />

          {/* GitHub OAuth Connect / Connected Pill */}
          {github.connected ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setGhMenuOpen((prev) => !prev);
                  setMenuOpen(false);
                }}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.08] hover:border-emerald-500/40 px-2.5 py-1.5 text-xs text-emerald-300 transition-colors"
                title={`GitHub connected as @${github.login}`}
              >
                {github.avatarUrl ? (
                  <img
                    src={github.avatarUrl}
                    alt={github.login || 'GitHub'}
                    className="w-4 h-4 rounded-full"
                  />
                ) : (
                  <GitHubIcon className="w-3.5 h-3.5" />
                )}
                <span className="hidden md:inline font-mono text-[11px] max-w-[100px] truncate">
                  @{github.login}
                </span>
              </button>

              {ghMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-white/[0.1] bg-[#111216] p-1.5 shadow-xl animate-enter">
                  <div className="px-2.5 py-2 border-b border-white/[0.06] mb-1">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                      GitHub connected
                    </p>
                    <p className="text-xs font-mono text-zinc-200 truncate mt-0.5">
                      @{github.login}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setGhMenuOpen(false);
                      disconnectGitHub();
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors"
                  >
                    <Unlink className="w-3.5 h-3.5" />
                    <span>Disconnect GitHub</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => connectGitHub()}
              className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#111216] hover:border-brand-500/40 hover:text-white px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors"
              title="Connect GitHub for 1-click repo selection and Pull Requests"
            >
              <GitHubIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Connect GitHub</span>
            </button>
          )}

          {/* User Auth Controls */}
          {user ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen((prev) => !prev);
                  setGhMenuOpen(false);
                }}
                className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#111216] hover:border-white/[0.16] px-2.5 py-1.5 text-xs text-zinc-200 transition-colors"
              >
                <span className="w-4 h-4 rounded bg-brand-600/25 text-brand-300 flex items-center justify-center font-semibold text-[10px] uppercase">
                  {user.email.charAt(0)}
                </span>
                <span className="hidden md:inline max-w-[120px] truncate text-zinc-300">
                  {user.email}
                </span>
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-white/[0.1] bg-[#111216] p-1.5 shadow-xl animate-enter">
                  <div className="px-2.5 py-2 border-b border-white/[0.06] mb-1">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500">Signed in</p>
                    <p className="text-xs text-zinc-200 truncate mt-0.5">{user.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      logout();
                      toast('Signed out', { variant: 'info' });
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign out</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => openAuthModal('login')}
              className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#111216] hover:border-brand-500/40 hover:text-white px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors"
            >
              <UserIcon className="w-3.5 h-3.5 text-brand-400" />
              <span>Sign in</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
