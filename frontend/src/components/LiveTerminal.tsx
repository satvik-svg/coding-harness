import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Copy, Check, ArrowDown, Search } from 'lucide-react';

interface LiveTerminalProps {
  logs: string;
  isRunning?: boolean;
}

export function LiveTerminal({ logs, isRunning = false }: LiveTerminalProps) {
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll) {
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const handleCopy = () => {
    navigator.clipboard.writeText(logs);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const logLines = logs ? logs.split('\n').filter((l) => l.trim().length > 0) : [];
  const filteredLines = searchQuery
    ? logLines.filter((l) => l.toLowerCase().includes(searchQuery.toLowerCase()))
    : logLines;

  const renderLogLine = (line: string, index: number) => {
    let textColor = 'text-zinc-300';

    if (
      line.includes('error') ||
      line.includes('Error') ||
      line.includes('failed') ||
      line.includes('SECURITY_VIOLATION')
    ) {
      textColor = 'text-rose-400 bg-rose-500/10';
    } else if (line.includes('warn') || line.includes('Warning')) {
      textColor = 'text-amber-300';
    } else if (line.includes('Agent Reasoning:') || line.includes('[Agent Thought]')) {
      textColor = 'text-blue-200 font-medium';
    } else if (
      line.includes('Executing tool') ||
      line.includes('Tool [') ||
      line.includes('Claude tool:')
    ) {
      textColor = 'text-brand-400';
    } else if (line.includes('completed successfully') || line.includes('PASSED')) {
      textColor = 'text-emerald-400 font-medium';
    } else if (line.includes('--- Starting Agent Iteration')) {
      textColor = 'text-zinc-100 font-semibold';
    }

    return (
      <div
        key={index}
        className={`flex items-start font-mono text-[12px] leading-5 py-0.5 px-2.5 rounded hover:bg-white/[0.03] ${textColor}`}
      >
        <span className="text-zinc-600 select-none mr-3 w-8 text-right flex-shrink-0">
          {index + 1}
        </span>
        <span className="break-all whitespace-pre-wrap">{line}</span>
      </div>
    );
  };

  return (
    <div className="panel flex flex-col h-full rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#121318] border-b border-white/[0.06] flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-brand-400" />
          <span className="text-xs font-medium text-zinc-200">Console</span>
          <span className="text-[11px] font-mono text-zinc-500">{logLines.length} lines</span>
          {isRunning && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-brand-500/15 text-brand-300 text-[11px] font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
              Live
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="w-3 h-3 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-7 pr-2.5 py-1 bg-[#09090b] border border-white/[0.07] focus:border-brand-500 rounded-md text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none w-32 sm:w-40 transition-colors"
            />
          </div>

          <button
            type="button"
            onClick={() => setAutoScroll(!autoScroll)}
            className={`p-1.5 rounded-md border text-xs transition-colors ${
              autoScroll
                ? 'bg-brand-500/15 border-brand-500/35 text-brand-300'
                : 'bg-[#09090b] border-white/[0.07] text-zinc-500 hover:text-zinc-200'
            }`}
            title={autoScroll ? 'Autoscroll on' : 'Autoscroll off'}
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#09090b] border border-white/[0.07] hover:border-white/[0.16] text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            {copied ? (
              <Check className="w-3 h-3 text-brand-400" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 p-2.5 overflow-y-auto font-mono text-xs terminal-scroll space-y-0.5 bg-[#09090b]">
        {filteredLines.length > 0 ? (
          filteredLines.map((line, idx) => renderLogLine(line, idx))
        ) : (
          <div className="p-10 text-center text-zinc-600 text-xs">
            {searchQuery ? 'No matching log lines.' : 'Waiting for output…'}
          </div>
        )}
        <div ref={terminalEndRef} />
      </div>
    </div>
  );
}
