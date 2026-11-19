import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TaskForm } from '../components/TaskForm';
import { AnalyticsBar } from '../components/AnalyticsBar';
import { ApiService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { Task, TaskAnalytics, TaskStatus } from '@coding-harness/shared';
import { GitBranch, ChevronRight, RefreshCw, Loader2, Lock } from 'lucide-react';

type FilterTab = 'ALL' | TaskStatus;

export default function Dashboard() {
  const { isAuthenticated, loading: authLoading, openAuthModal } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [analytics, setAnalytics] = useState<TaskAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterTab>('ALL');

  const loadData = useCallback(async () => {
    if (!isAuthenticated) {
      setTasks([]);
      setAnalytics(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [tasksRes, analyticsRes] = await Promise.allSettled([
        ApiService.listTasks(25, 0),
        ApiService.getTaskAnalytics(),
      ]);

      if (tasksRes.status === 'fulfilled') {
        setTasks(tasksRes.value.tasks);
      } else {
        setTasks([]);
      }
      if (analyticsRes.status === 'fulfilled') {
        setAnalytics(analyticsRes.value);
      } else {
        setAnalytics(null);
      }
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (authLoading) return;
    loadData();
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) {
        loadData();
      }
    }, 15_000);
    const onVisible = () => {
      if (!document.hidden) loadData();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [authLoading, isAuthenticated, loadData]);

  const filteredTasks = useMemo(() => {
    if (filter === 'ALL') return tasks;
    return tasks.filter((t) => t.status === filter);
  }, [tasks, filter]);

  const renderStatus = (status: TaskStatus) => {
    switch (status) {
      case TaskStatus.COMPLETED:
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Completed</span>
          </span>
        );
      case TaskStatus.FAILED:
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-rose-400">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            <span>Failed</span>
          </span>
        );
      case TaskStatus.CANCELLED:
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
            <span>Cancelled</span>
          </span>
        );
      case TaskStatus.RUNNING:
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-brand-400 font-medium">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Running</span>
          </span>
        );
      case TaskStatus.PENDING:
      default:
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-amber-400">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <span>Queued</span>
          </span>
        );
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-12 space-y-8">
      {/* Compact Workspace Header & Composer */}
      <section className="space-y-5">
        <div className="space-y-1.5 animate-enter">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-100">
            New coding task
          </h1>
          <p className="text-sm text-zinc-500">
            Connect a repository, describe the change, and inspect the live output and Git diff.
          </p>
        </div>

        <TaskForm />
      </section>

      {/* Private Workspace Analytics KPI Cards (only when signed in with runs) */}
      {isAuthenticated && <AnalyticsBar analytics={analytics} />}

      {/* Private Recent Tasks List */}
      <section className="space-y-3 animate-enter" style={{ animationDelay: '60ms' }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Your tasks
            </h2>
            {isAuthenticated && (
              <span className="text-[11px] font-mono text-zinc-500 bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 rounded">
                {filteredTasks.length}
              </span>
            )}
          </div>

          {isAuthenticated && (
            <div className="flex items-center gap-2">
              <div className="inline-flex p-0.5 rounded-lg bg-[#0f1014] border border-white/[0.07]">
                {(
                  [
                    { key: 'ALL', label: 'All' },
                    { key: TaskStatus.RUNNING, label: 'Running' },
                    { key: TaskStatus.COMPLETED, label: 'Done' },
                    { key: TaskStatus.FAILED, label: 'Failed' },
                    { key: TaskStatus.CANCELLED, label: 'Stopped' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setFilter(tab.key)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      filter === tab.key
                        ? 'bg-brand-600/20 text-brand-300'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={loadData}
                className="p-1.5 rounded-lg border border-white/[0.07] bg-[#0f1014] text-zinc-400 hover:text-zinc-200 hover:border-white/[0.15] transition-colors"
                title="Refresh tasks"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          )}
        </div>

        <div className="panel rounded-xl overflow-hidden divide-y divide-white/[0.06]">
          {!authLoading && !isAuthenticated ? (
            <div className="px-6 py-12 text-center space-y-3">
              <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mx-auto">
                <Lock className="w-4 h-4 text-brand-400" />
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-200">
                  Sign in to access your private workspace
                </p>
                <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
                  Each account has an isolated task history, live sessions, and analytics.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => openAuthModal('login')}
                  className="px-3.5 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium transition-colors"
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => openAuthModal('register')}
                  className="px-3.5 py-1.5 rounded-lg border border-white/[0.1] bg-[#09090b] hover:border-white/[0.2] text-zinc-300 hover:text-white text-xs font-medium transition-colors"
                >
                  Create account
                </button>
              </div>
            </div>
          ) : filteredTasks.length > 0 ? (
            filteredTasks.map((task) => (
              <Link
                key={task.id}
                href={`/tasks/${task.id}`}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-4 py-3.5 hover:bg-white/[0.025] transition-colors group"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <GitBranch className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span className="text-xs font-mono font-medium text-zinc-200 group-hover:text-white truncate">
                      {task.repoUrl.replace('https://github.com/', '')}
                    </span>
                    <span className="text-zinc-700 hidden sm:inline">·</span>
                    <span className="text-[11px] text-zinc-500 hidden sm:inline flex-shrink-0">
                      {new Date(task.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 truncate">{task.prompt}</p>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-4 flex-shrink-0">
                  {renderStatus(task.status)}
                  <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-brand-400 group-hover:translate-x-0.5 transition-all" />
                </div>
              </Link>
            ))
          ) : (
            <div className="px-4 py-12 text-center">
              <p className="text-xs font-medium text-zinc-400">
                {filter === 'ALL' ? 'No tasks in your workspace yet' : `No ${filter.toLowerCase()} tasks`}
              </p>
              <p className="text-xs text-zinc-600 mt-1">
                {filter === 'ALL'
                  ? 'Submit a repository and prompt above to start your first run.'
                  : 'Try another filter.'}
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
