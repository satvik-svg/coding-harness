import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import {
  Search,
  GitBranch,
  Plus,
  Bell,
  BellOff,
  LogIn,
  LogOut,
  CornerDownLeft,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Ban,
} from 'lucide-react';
import { Task, TaskStatus } from '@coding-harness/shared';
import { ApiService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

interface PaletteItem {
  id: string;
  label: string;
  sublabel?: string;
  group: 'Actions' | 'Recent Tasks';
  icon: React.ReactNode;
  onSelect: () => void;
}

export function CommandPalette() {
  const router = useRouter();
  const { user, openAuthModal, logout } = useAuth();
  const { browserAlertsEnabled, toggleBrowserAlerts, toast } = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Global Cmd+K / Ctrl+K listener + custom trigger event
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    const onOpenCustom = () => setOpen(true);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('ch:open-command-palette', onOpenCustom);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('ch:open-command-palette', onOpenCustom);
    };
  }, []);

  // Fetch recent tasks whenever palette opens
  useEffect(() => {
    if (!open) {
      setQuery('');
      setSelectedIndex(0);
      return;
    }
    let active = true;
    ApiService.listTasks(25, 0)
      .then((res) => {
        if (active) setTasks(res.tasks);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open]);

  const statusIcon = (status: TaskStatus) => {
    switch (status) {
      case TaskStatus.COMPLETED:
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
      case TaskStatus.FAILED:
        return <XCircle className="w-3.5 h-3.5 text-rose-400" />;
      case TaskStatus.RUNNING:
        return <Loader2 className="w-3.5 h-3.5 text-brand-400 animate-spin" />;
      case TaskStatus.CANCELLED:
        return <Ban className="w-3.5 h-3.5 text-zinc-500" />;
      default:
        return <Clock className="w-3.5 h-3.5 text-amber-400" />;
    }
  };

  const items = useMemo<PaletteItem[]>(() => {
    const actions: PaletteItem[] = [
      {
        id: 'new-task',
        label: 'New coding task',
        sublabel: 'Go to dashboard composer',
        group: 'Actions',
        icon: <Plus className="w-3.5 h-3.5 text-brand-400" />,
        onSelect: () => {
          setOpen(false);
          router.push('/');
        },
      },
      {
        id: 'toggle-alerts',
        label: browserAlertsEnabled ? 'Disable desktop alerts' : 'Enable desktop alerts',
        sublabel: 'Browser notifications when tasks finish',
        group: 'Actions',
        icon: browserAlertsEnabled ? (
          <BellOff className="w-3.5 h-3.5 text-zinc-400" />
        ) : (
          <Bell className="w-3.5 h-3.5 text-brand-400" />
        ),
        onSelect: () => {
          setOpen(false);
          void toggleBrowserAlerts();
        },
      },
      user
        ? {
            id: 'logout',
            label: `Sign out (${user.email})`,
            sublabel: 'Switch to guest mode',
            group: 'Actions',
            icon: <LogOut className="w-3.5 h-3.5 text-zinc-400" />,
            onSelect: () => {
              setOpen(false);
              logout();
              toast('Signed out', { variant: 'info' });
            },
          }
        : {
            id: 'login',
            label: 'Sign in / Create account',
            sublabel: 'Access private task history & workspace',
            group: 'Actions',
            icon: <LogIn className="w-3.5 h-3.5 text-brand-400" />,
            onSelect: () => {
              setOpen(false);
              openAuthModal('login');
            },
          },
    ];

    const taskItems: PaletteItem[] = tasks.map((t) => ({
      id: `task-${t.id}`,
      label: t.repoUrl.replace('https://github.com/', ''),
      sublabel: t.prompt,
      group: 'Recent Tasks',
      icon: statusIcon(t.status),
      onSelect: () => {
        setOpen(false);
        router.push(`/tasks/${t.id}`);
      },
    }));

    const all = [...actions, ...taskItems];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        (item.sublabel && item.sublabel.toLowerCase().includes(q)),
    );
  }, [tasks, query, router, user, browserAlertsEnabled, toggleBrowserAlerts, logout, openAuthModal, toast]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, items.length]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (items.length ? (prev + 1) % items.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (items.length ? (prev - 1 + items.length) % items.length : 0));
    } else if (e.key === 'Enter' && items[selectedIndex]) {
      e.preventDefault();
      items[selectedIndex].onSelect();
    }
  };

  const grouped = {
    Actions: items.filter((i) => i.group === 'Actions'),
    'Recent Tasks': items.filter((i) => i.group === 'Recent Tasks'),
  };

  let runningIdx = -1;

  return (
    <div
      className="fixed inset-0 z-[85] flex items-start justify-center pt-[14vh] px-4 bg-black/70 backdrop-blur-sm animate-enter"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-lg rounded-xl border border-white/[0.1] bg-[#0f1014] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/[0.07]">
          <Search className="w-4 h-4 text-zinc-500 flex-shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a task or run a command…"
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
          />
          <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] font-mono text-[10px] text-zinc-500">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[360px] overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <div className="py-10 text-center text-xs text-zinc-500">
              No matching commands or tasks.
            </div>
          ) : (
            (['Actions', 'Recent Tasks'] as const).map((groupName) => {
              const groupItems = grouped[groupName];
              if (groupItems.length === 0) return null;
              return (
                <div key={groupName} className="mb-1.5 last:mb-0">
                  <div className="px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                    {groupName}
                  </div>
                  {groupItems.map((item) => {
                    runningIdx++;
                    const idx = runningIdx;
                    const active = idx === selectedIndex;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onMouseEnter={() => setSelectedIndex(idx)}
                        onClick={item.onSelect}
                        className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left transition-colors ${
                          active ? 'bg-brand-600/20 text-white' : 'text-zinc-300 hover:bg-white/[0.04]'
                        }`}
                      >
                        <span className="flex-shrink-0">{item.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium truncate flex items-center gap-1.5">
                            {groupName === 'Recent Tasks' && (
                              <GitBranch className="w-3 h-3 text-zinc-500 flex-shrink-0" />
                            )}
                            <span className={groupName === 'Recent Tasks' ? 'font-mono' : ''}>
                              {item.label}
                            </span>
                          </div>
                          {item.sublabel && (
                            <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                              {item.sublabel}
                            </p>
                          )}
                        </div>
                        {active && (
                          <CornerDownLeft className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-3.5 py-2 bg-[#0c0d11] border-t border-white/[0.06] flex items-center justify-between text-[11px] text-zinc-500">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Open</span>
          </div>
          <span className="font-mono text-[10px]">⌘K</span>
        </div>
      </div>
    </div>
  );
}
