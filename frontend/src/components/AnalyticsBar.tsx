import React from 'react';
import { TaskAnalytics } from '@coding-harness/shared';

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

interface AnalyticsBarProps {
  analytics: TaskAnalytics | null;
}

export function AnalyticsBar({ analytics }: AnalyticsBarProps) {
  if (!analytics || analytics.totalTasks === 0) return null;

  const activeCount = analytics.runningTasks + analytics.pendingTasks;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 animate-enter">
      {/* Success Rate */}
      <div className="panel rounded-xl px-3.5 py-3">
        <div className="text-[11px] text-zinc-500">Success rate</div>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span className="text-lg font-semibold font-mono text-zinc-100">
            {analytics.successRate}%
          </span>
          <span className="text-[11px] font-mono text-zinc-500">
            {analytics.completedTasks}/{analytics.totalTasks}
          </span>
        </div>
        <div className="mt-2 h-1 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full rounded-full bg-brand-500 transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, analytics.successRate))}%` }}
          />
        </div>
      </div>

      {/* Avg Runtime */}
      <div className="panel rounded-xl px-3.5 py-3">
        <div className="text-[11px] text-zinc-500">Avg runtime</div>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span className="text-lg font-semibold font-mono text-zinc-100">
            {formatDuration(analytics.avgDurationSeconds)}
          </span>
          {activeCount > 0 && (
            <span className="text-[11px] font-medium text-brand-400">{activeCount} active</span>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-600 truncate">
          {analytics.failedTasks > 0
            ? `${analytics.failedTasks} failed`
            : analytics.cancelledTasks > 0
              ? `${analytics.cancelledTasks} stopped`
              : 'All recent runs clean'}
        </p>
      </div>

      {/* Lines Changed */}
      <div className="panel rounded-xl px-3.5 py-3">
        <div className="text-[11px] text-zinc-500">Lines changed</div>
        <div className="mt-1 flex items-baseline gap-2 font-mono">
          <span className="text-lg font-semibold text-emerald-400">
            +{analytics.totalLinesAdded.toLocaleString()}
          </span>
          <span className="text-xs text-rose-400">
            -{analytics.totalLinesRemoved.toLocaleString()}
          </span>
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-600">Across recorded diffs</p>
      </div>

      {/* Estimated Usage */}
      <div className="panel rounded-xl px-3.5 py-3">
        <div className="text-[11px] text-zinc-500">Est. session cost</div>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span className="text-lg font-semibold font-mono text-zinc-100">
            ${analytics.estimatedCostUsd.toFixed(3)}
          </span>
          <span className="text-[11px] text-zinc-600">USD</span>
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-600 truncate">
          {analytics.totalTasks} {analytics.totalTasks === 1 ? 'session' : 'sessions'} tracked
        </p>
      </div>
    </div>
  );
}
