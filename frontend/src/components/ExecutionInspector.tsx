import React, { useMemo, useState } from 'react';
import {
  Terminal,
  ListTree,
  FileText,
  FilePenLine,
  TerminalSquare,
  Search,
  Brain,
  Info,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Wrench,
} from 'lucide-react';
import { AgentStepLog } from '@coding-harness/shared';
import { LiveTerminal } from './LiveTerminal';

interface ExecutionInspectorProps {
  logs: string;
  steps?: AgentStepLog[];
  isRunning?: boolean;
}

type ToolKind = 'read' | 'write' | 'bash' | 'search' | 'reasoning' | 'system' | 'other';
type TimelineFilter = 'all' | 'tools' | 'tests' | 'errors';

interface ParsedTimelineStep {
  id: string;
  index: number;
  timestamp?: string;
  toolName: string;
  kind: ToolKind;
  title: string;
  detail: string;
  testStatus?: 'pass' | 'fail';
  isError?: boolean;
}

function classifyTool(name: string): ToolKind {
  const n = name.toLowerCase();
  if (n.includes('read') || n.includes('view_file') || n.includes('list_dir') || n.includes('glob'))
    return 'read';
  if (n.includes('write') || n.includes('edit') || n.includes('replace') || n.includes('patch'))
    return 'write';
  if (n.includes('bash') || n.includes('run_command') || n.includes('exec') || n.includes('shell'))
    return 'bash';
  if (n.includes('grep') || n.includes('search') || n.includes('find')) return 'search';
  if (n.includes('reason') || n.includes('plan') || n.includes('thought')) return 'reasoning';
  if (n.includes('system') || n.includes('git') || n.includes('docker')) return 'system';
  return 'other';
}

function detectTestStatus(text: string): 'pass' | 'fail' | undefined {
  const lower = text.toLowerCase();
  const mentionsTest =
    /\b(test|tests|jest|vitest|pytest|mocha|node:test|assert|spec|passing|failing)\b/.test(lower) ||
    lower.includes('ok 1') ||
    lower.includes('not ok');
  if (!mentionsTest) return undefined;

  if (
    /\b(failed|failing|not ok|assertionerror|error:|exit code [1-9])\b/.test(lower) &&
    !/0 failed|0 failing|fail 0/.test(lower)
  ) {
    return 'fail';
  }
  if (/\b(pass|passed|passing|ok \d+|all tests passed|✓)\b/.test(lower)) {
    return 'pass';
  }
  return undefined;
}

function parseLogsToTimeline(logs: string, structuredSteps: AgentStepLog[]): ParsedTimelineStep[] {
  const result: ParsedTimelineStep[] = [];
  const rawLines = logs ? logs.split('\n') : [];

  let current: ParsedTimelineStep | null = null;
  const pushCurrent = () => {
    if (!current) return;
    const combined = `${current.title}\n${current.detail}`;
    if (!current.testStatus && (current.kind === 'bash' || current.kind === 'system')) {
      current.testStatus = detectTestStatus(combined);
    }
    if (
      !current.isError &&
      /\b(error|failed|security_violation|exception)\b/i.test(current.title)
    ) {
      current.isError = true;
    }
    result.push(current);
    current = null;
  };

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    if (!raw.trim()) continue;

    // Extract optional ISO timestamp prefix: [2026-11-19T...]
    const tsMatch = raw.match(/^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]\s*(.*)$/);
    const timestamp = tsMatch ? tsMatch[1] : undefined;
    const text = tsMatch ? tsMatch[2] : raw;

    // 1. Claude Code tool invocation: "Claude tool: Read"
    const claudeToolMatch = text.match(/^Claude tool:\s*(.+)$/i);
    if (claudeToolMatch) {
      pushCurrent();
      const toolName = claudeToolMatch[1].trim();
      current = {
        id: `log-${i}`,
        index: result.length + 1,
        timestamp,
        toolName,
        kind: classifyTool(toolName),
        title: `Invoked ${toolName}`,
        detail: '',
      };
      continue;
    }

    // 2. Built-in AgentLoop tool invocation: "Executing tool [write_file] with args: {...}"
    const loopToolMatch = text.match(/^Executing tool \[([^\]]+)\](?: with args:\s*(.*))?$/i);
    if (loopToolMatch) {
      pushCurrent();
      const toolName = loopToolMatch[1].trim();
      const argsPreview = loopToolMatch[2] ? loopToolMatch[2].trim() : '';
      current = {
        id: `log-${i}`,
        index: result.length + 1,
        timestamp,
        toolName,
        kind: classifyTool(toolName),
        title: argsPreview ? `${toolName} ${argsPreview.slice(0, 80)}` : `Invoked ${toolName}`,
        detail: argsPreview,
      };
      continue;
    }

    // 3. Tool output lines attach to the active tool card
    const toolOutMatch = text.match(/^Tool output:\s*(.*)$/i);
    if (toolOutMatch) {
      if (current) {
        current.detail = current.detail
          ? `${current.detail}\n${toolOutMatch[1]}`
          : toolOutMatch[1];
      } else {
        current = {
          id: `log-${i}`,
          index: result.length + 1,
          timestamp,
          toolName: 'Output',
          kind: 'other',
          title: 'Tool output',
          detail: toolOutMatch[1],
        };
      }
      continue;
    }

    // 4. Built-in AgentLoop tool completion
    const toolDoneMatch = text.match(/^Tool \[([^\]]+)\]\s+(succeeded|failed)\s+in\s+(\d+ms)/i);
    if (toolDoneMatch && current) {
      const statusWord = toolDoneMatch[2].toLowerCase();
      current.detail = `${current.detail ? `${current.detail}\n` : ''}Result: ${statusWord} (${toolDoneMatch[3]})`;
      if (statusWord === 'failed') current.isError = true;
      continue;
    }

    // 5. Agent reasoning
    const reasoningMatch = text.match(/^Agent Reasoning:\s*(.+)$/i);
    if (reasoningMatch) {
      pushCurrent();
      current = {
        id: `log-${i}`,
        index: result.length + 1,
        timestamp,
        toolName: 'Reasoning',
        kind: 'reasoning',
        title: reasoningMatch[1].slice(0, 110),
        detail: reasoningMatch[1],
      };
      continue;
    }

    // 6. High-level lifecycle milestones
    if (
      /^(Task started|Cloning Git repository|Repository cloned|Docker sandbox|Starting autonomous|Agent execution finished|Task execution phase completed|Task execution failed|Task execution cancelled|Stop requested)/i.test(
        text,
      )
    ) {
      pushCurrent();
      current = {
        id: `log-${i}`,
        index: result.length + 1,
        timestamp,
        toolName: 'System',
        kind: 'system',
        title: text,
        detail: '',
        isError: /failed/i.test(text),
      };
      continue;
    }

    // Continuation lines for active step (e.g. multiline Tool output or reasoning)
    if (current) {
      current.detail = current.detail ? `${current.detail}\n${text}` : text;
    }
  }

  pushCurrent();

  // If we received live structured steps via WebSocket and no parsed tool cards yet, merge them
  if (result.length === 0 && structuredSteps.length > 0) {
    return structuredSteps.map((s, idx) => ({
      id: `step-${idx}`,
      index: idx + 1,
      timestamp: s.timestamp,
      toolName: s.toolName || s.action,
      kind: classifyTool(s.toolName || s.action),
      title: s.thought || `${s.action}${s.toolName ? ` · ${s.toolName}` : ''}`,
      detail: s.toolArgs ? JSON.stringify(s.toolArgs, null, 2) : '',
      isError: s.action === 'ERROR' || s.toolResult?.success === false,
    }));
  }

  return result;
}

function ToolIcon({ kind }: { kind: ToolKind }) {
  switch (kind) {
    case 'read':
      return <FileText className="w-3.5 h-3.5 text-brand-400" />;
    case 'write':
      return <FilePenLine className="w-3.5 h-3.5 text-blue-300" />;
    case 'bash':
      return <TerminalSquare className="w-3.5 h-3.5 text-brand-400" />;
    case 'search':
      return <Search className="w-3.5 h-3.5 text-brand-400" />;
    case 'reasoning':
      return <Brain className="w-3.5 h-3.5 text-zinc-400" />;
    case 'system':
      return <Info className="w-3.5 h-3.5 text-zinc-500" />;
    default:
      return <Wrench className="w-3.5 h-3.5 text-brand-400" />;
  }
}

export function ExecutionInspector({
  logs,
  steps = [],
  isRunning = false,
}: ExecutionInspectorProps) {
  const [activeTab, setActiveTab] = useState<'timeline' | 'console'>('timeline');
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const timelineSteps = useMemo(() => parseLogsToTimeline(logs, steps), [logs, steps]);

  const filteredSteps = useMemo(() => {
    switch (filter) {
      case 'tools':
        return timelineSteps.filter(
          (s) => s.kind !== 'system' && s.kind !== 'reasoning',
        );
      case 'tests':
        return timelineSteps.filter((s) => Boolean(s.testStatus));
      case 'errors':
        return timelineSteps.filter((s) => s.isError || s.testStatus === 'fail');
      default:
        return timelineSteps;
    }
  }, [timelineSteps, filter]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleAll = (expand: boolean) => {
    if (!expand) {
      setExpandedIds({});
      return;
    }
    const map: Record<string, boolean> = {};
    for (const s of filteredSteps) {
      if (s.detail) map[s.id] = true;
    }
    setExpandedIds(map);
  };

  const logLineCount = useMemo(
    () => (logs ? logs.split('\n').filter((l) => l.trim().length > 0).length : 0),
    [logs],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Top Mode Switcher Bar */}
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="inline-flex p-0.5 rounded-lg bg-[#0f1014] border border-white/[0.08]">
          <button
            type="button"
            onClick={() => setActiveTab('timeline')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'timeline'
                ? 'bg-brand-600/20 text-brand-300'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <ListTree className="w-3.5 h-3.5" />
            <span>Timeline</span>
            <span className="font-mono text-[10px] opacity-75">{timelineSteps.length}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('console')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'console'
                ? 'bg-brand-600/20 text-brand-300'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Console</span>
            <span className="font-mono text-[10px] opacity-75">{logLineCount}</span>
          </button>
        </div>

        {activeTab === 'timeline' && timelineSteps.length > 0 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => toggleAll(true)}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded hover:bg-white/[0.04] transition-colors"
            >
              Expand all
            </button>
            <button
              type="button"
              onClick={() => toggleAll(false)}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded hover:bg-white/[0.04] transition-colors"
            >
              Collapse
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {activeTab === 'console' ? (
          <LiveTerminal logs={logs} isRunning={isRunning} />
        ) : (
          <div className="panel flex flex-col h-full rounded-xl overflow-hidden">
            {/* Timeline Filter Sub-header */}
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-[#121318] border-b border-white/[0.06]">
              <div className="flex items-center gap-1">
                {(
                  [
                    { key: 'all', label: 'All' },
                    { key: 'tools', label: 'Tools' },
                    { key: 'tests', label: 'Tests' },
                    { key: 'errors', label: 'Errors' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setFilter(tab.key)}
                    className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                      filter === tab.key
                        ? 'bg-brand-600/20 text-brand-300'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {isRunning && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-brand-500/15 text-brand-300 text-[11px] font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
                  Live
                </span>
              )}
            </div>

            {/* Collapsible Timeline Cards */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[#09090b]">
              {filteredSteps.length === 0 ? (
                <div className="py-16 text-center text-xs text-zinc-500">
                  {timelineSteps.length === 0
                    ? isRunning
                      ? 'Waiting for agent tool events…'
                      : 'No structured tool steps captured yet. Switch to Console for raw output.'
                    : `No ${filter} events in this session.`}
                </div>
              ) : (
                filteredSteps.map((step) => {
                  const hasDetail = step.detail.trim().length > 0;
                  const isExpanded = Boolean(expandedIds[step.id]);
                  return (
                    <div
                      key={step.id}
                      className={`rounded-lg border transition-colors animate-enter ${
                        step.isError || step.testStatus === 'fail'
                          ? 'border-rose-500/25 bg-rose-500/[0.04]'
                          : step.kind !== 'system'
                            ? 'border-white/[0.07] bg-[#0f1014] hover:border-brand-500/35'
                            : 'border-white/[0.05] bg-[#0c0d11]'
                      }`}
                    >
                      <button
                        type="button"
                        disabled={!hasDetail}
                        onClick={() => hasDetail && toggleExpand(step.id)}
                        className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 text-left ${
                          hasDetail ? 'cursor-pointer' : 'cursor-default'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <span className="text-[10px] font-mono text-zinc-600 w-5 text-right flex-shrink-0">
                            {step.index}
                          </span>
                          <span className="flex-shrink-0">
                            <ToolIcon kind={step.kind} />
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-brand-500/10 border border-brand-500/20 font-mono text-[10px] font-medium text-brand-300 flex-shrink-0">
                            {step.toolName}
                          </span>
                          <span className="text-xs text-zinc-200 truncate">{step.title}</span>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          {step.testStatus === 'pass' && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/25 text-[10px] font-mono font-semibold text-emerald-300">
                              <CheckCircle2 className="w-3 h-3" />
                              PASS
                            </span>
                          )}
                          {step.testStatus === 'fail' && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/15 border border-rose-500/25 text-[10px] font-mono font-semibold text-rose-300">
                              <XCircle className="w-3 h-3" />
                              FAIL
                            </span>
                          )}
                          {step.timestamp && (
                            <span className="hidden sm:inline text-[10px] font-mono text-zinc-600">
                              {new Date(step.timestamp).toLocaleTimeString()}
                            </span>
                          )}
                          {hasDetail && (
                            <span className="text-zinc-500">
                              {isExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5" />
                              )}
                            </span>
                          )}
                        </div>
                      </button>

                      {hasDetail && isExpanded && (
                        <div className="px-3 pb-3 pt-1 border-t border-white/[0.05]">
                          <pre className="p-2.5 rounded-md bg-[#09090b] border border-white/[0.06] font-mono text-[11px] leading-5 text-zinc-300 overflow-x-auto max-h-64 whitespace-pre-wrap break-words">
                            {step.detail}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
