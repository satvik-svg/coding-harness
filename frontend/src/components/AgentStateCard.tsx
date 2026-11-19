import React, { useEffect, useState } from 'react';
import { TaskStatus, AgentStepLog } from '@coding-harness/shared';
import { ApiService } from '../services/api';
import {
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
  ExternalLink,
  Server,
  Ban,
  Timer,
} from 'lucide-react';

interface AgentStateCardProps {
  status: TaskStatus;
  latestStep?: AgentStepLog;
  iterations?: number;
  toolCallsCount?: number;
  repoUrl?: string;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

export function AgentStateCard({
  status,
  latestStep,
  iterations = 0,
  toolCallsCount = 0,
  repoUrl,
  startedAt,
  finishedAt,
}: AgentStateCardProps) {
  const [vmReachable, setVmReachable] = useState<boolean | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

  const isActive = status === TaskStatus.RUNNING || status === TaskStatus.PENDING;

  // Live ticking timer while active
  useEffect(() => {
    if (!isActive || !startedAt) return;
    setNowMs(Date.now());
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isActive, startedAt]);

  useEffect(() => {
    if (!demoMode) return;
    let active = true;
    const checkVm = async () => {
      try {
        const health = await ApiService.getHealth();
        if (active) setVmReachable(health?.service === 'coding-harness-backend');
      } catch {
        if (active) setVmReachable(false);
      }
    };
    checkVm();
    const timer = setInterval(checkVm, 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [demoMode]);

  const elapsedDisplay = (() => {
    if (!startedAt) return '00:00';
    const startMs = new Date(startedAt).getTime();
    if (Number.isNaN(startMs)) return '00:00';
    const endMs =
      !isActive && finishedAt ? new Date(finishedAt).getTime() : isActive ? nowMs : startMs;
    return formatElapsed(Math.max(0, endMs - startMs));
  })();

  let repositoryLink: string | undefined;
  if (repoUrl) {
    try {
      const url = new URL(repoUrl);
      if (url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password)
        repositoryLink = url.href;
    } catch {
      // Uploaded archives and other identifiers are displayed as text.
    }
  }

  const getStatusBadge = () => {
    switch (status) {
      case TaskStatus.COMPLETED:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Completed</span>
          </span>
        );
      case TaskStatus.FAILED:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs font-medium">
            <XCircle className="w-3.5 h-3.5" />
            <span>Failed</span>
          </span>
        );
      case TaskStatus.CANCELLED:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-zinc-500/10 text-zinc-400 border border-zinc-500/25 text-xs font-medium">
            <Ban className="w-3.5 h-3.5" />
            <span>Cancelled</span>
          </span>
        );
      case TaskStatus.RUNNING:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-brand-500/15 text-brand-300 border border-brand-500/30 text-xs font-medium">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Running</span>
          </span>
        );
      case TaskStatus.PENDING:
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-medium">
            <Clock className="w-3.5 h-3.5" />
            <span>Queued</span>
          </span>
        );
    }
  };

  return (
    <div className="panel rounded-xl p-5 relative overflow-hidden">
      {/* Crisp 2px animated blue hairline while active */}
      {isActive && (
        <div className="absolute top-0 inset-x-0 h-[2px] bg-white/[0.04] overflow-hidden">
          <div className="w-1/3 h-full bg-brand-500 animate-progress-slide" />
        </div>
      )}

      <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Status</h3>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#09090b] border font-mono text-[11px] ${
              isActive
                ? 'border-brand-500/30 text-brand-300'
                : 'border-white/[0.07] text-zinc-400'
            }`}
            title="Elapsed execution time"
          >
            <Timer className="w-3 h-3" />
            <span>{elapsedDisplay}</span>
          </span>
        </div>
        <div>{getStatusBadge()}</div>
      </div>

      <div className="mt-3.5">
        <p className="text-[11px] text-zinc-500">Repository</p>
        {repositoryLink ? (
          <a
            href={repositoryLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-start gap-1.5 text-xs font-mono text-brand-400 hover:text-brand-300 break-all transition-colors"
          >
            <span>{repoUrl}</span>
            <ExternalLink className="mt-0.5 h-3 w-3 flex-shrink-0" />
          </a>
        ) : (
          <p className="mt-1 text-xs font-mono text-zinc-200 break-all">
            {repoUrl || 'Repository unavailable'}
          </p>
        )}
      </div>

      {demoMode ? (
        <div className="mt-4 rounded-lg border border-white/[0.06] bg-[#09090b] p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <Server className="h-3.5 w-3.5 text-brand-400" />
            <span>Environment</span>
          </div>
          <p
            className="mt-1.5 flex items-center gap-2 text-xs font-medium text-zinc-100"
            aria-live="polite"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                vmReachable === true
                  ? 'bg-emerald-400'
                  : vmReachable === false
                    ? 'bg-amber-400'
                    : 'bg-zinc-600'
              }`}
            />
            {vmReachable === true
              ? 'GCP VM running'
              : vmReachable === false
                ? 'GCP VM status unavailable'
                : 'Checking GCP VM…'}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            {vmReachable === true
              ? 'Backend reachable · Trusted repositories only.'
              : 'Checking whether the demo backend is reachable.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 mt-4">
          <div className="bg-[#09090b] p-2.5 rounded-lg border border-white/[0.06]">
            <div className="text-[11px] text-zinc-500">Iterations</div>
            <div className="text-base font-semibold font-mono text-zinc-100 mt-0.5">
              {iterations}
            </div>
          </div>

          <div className="bg-[#09090b] p-2.5 rounded-lg border border-white/[0.06]">
            <div className="text-[11px] text-zinc-500">Tool calls</div>
            <div className="text-base font-semibold font-mono text-zinc-100 mt-0.5">
              {toolCallsCount}
            </div>
          </div>

          <div className="bg-[#09090b] p-2.5 rounded-lg border border-white/[0.06]">
            <div className="text-[11px] text-zinc-500">Sandbox</div>
            <div className="text-xs font-medium text-zinc-200 mt-1.5">Docker</div>
          </div>
        </div>
      )}

      {latestStep && (
        <div className="mt-4 p-3 rounded-lg bg-brand-500/[0.07] border border-brand-500/20 animate-enter">
          <div className="flex items-center gap-2 text-xs font-medium text-brand-300">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-400" />
            <span>{latestStep.action}</span>
            {latestStep.toolName && (
              <span className="px-1.5 py-0.5 rounded bg-brand-500/15 text-blue-200 font-mono text-[10px]">
                {latestStep.toolName}
              </span>
            )}
          </div>
          {latestStep.thought && (
            <p className="text-xs text-zinc-400 line-clamp-2 mt-1">{latestStep.thought}</p>
          )}
        </div>
      )}
    </div>
  );
}
