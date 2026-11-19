import React, { useState } from 'react';
import { Check, Clipboard, AlertCircle } from 'lucide-react';
import { TaskStatus } from '@coding-harness/shared';

/** Render common Markdown safely as React elements; raw HTML is never interpreted. */
function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return (
        <strong key={index} className="font-semibold text-zinc-100">
          {part.slice(2, -2)}
        </strong>
      );
    if (part.startsWith('`') && part.endsWith('`'))
      return (
        <code
          key={index}
          className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[11px] text-blue-200"
        >
          {part.slice(1, -1)}
        </code>
      );
    return part;
  });
}

function MarkdownResult({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split('\n');
  let code: string[] | null = null;
  let language = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      if (code === null) {
        code = [];
        language = line.trim().slice(3).trim();
      } else {
        blocks.push(
          <pre
            key={`code-${i}`}
            className="overflow-x-auto rounded-lg border border-white/[0.07] bg-[#09090b] p-3 text-xs leading-relaxed text-zinc-200 my-2"
          >
            <code aria-label={language || undefined}>{code.join('\n')}</code>
          </pre>,
        );
        code = null;
      }
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      blocks.push(<div key={`space-${i}`} className="h-2" />);
      continue;
    }
    if (/^\s*---\s*$/.test(line)) {
      blocks.push(<hr key={`rule-${i}`} className="border-white/[0.07] my-3" />);
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push(
        <div
          key={`heading-${i}`}
          role="heading"
          aria-level={Math.min(heading[1].length + 3, 6)}
          className="mt-3 text-sm font-semibold text-zinc-100"
        >
          {inline(heading[2])}
        </div>,
      );
      continue;
    }
    const list = line.match(/^\s*(?:[-*+]\s+|\d+\.\s+)(.*)$/);
    if (list) {
      blocks.push(
        <div key={`item-${i}`} className="flex gap-2 pl-1.5">
          <span aria-hidden="true" className="text-brand-400">
            –
          </span>
          <span>{inline(list[1])}</span>
        </div>,
      );
      continue;
    }
    blocks.push(<p key={`line-${i}`}>{inline(line)}</p>);
  }
  if (code !== null)
    blocks.push(
      <pre
        key="unfinished-code"
        className="overflow-x-auto rounded-lg border border-white/[0.07] bg-[#09090b] p-3 text-xs"
      >
        <code>{code.join('\n')}</code>
      </pre>,
    );
  return <div className="space-y-1.5 text-[13px] leading-6 text-zinc-300 break-words">{blocks}</div>;
}

interface TaskResultProps {
  summary: string;
  prompt?: string;
  status?: TaskStatus;
}

export function TaskResult({ summary, prompt, status = TaskStatus.COMPLETED }: TaskResultProps) {
  const [copied, setCopied] = useState(false);
  const isRunning = status === TaskStatus.RUNNING || status === TaskStatus.PENDING;

  return (
    <section
      className="panel rounded-xl overflow-hidden animate-enter"
      aria-labelledby="task-result-heading"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-[#121318] border-b border-white/[0.06]">
        <h2 id="task-result-heading" className="text-xs font-medium uppercase tracking-wider text-zinc-400">
          Thread
        </h2>

        {summary && (
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(summary);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-[#09090b] hover:border-white/[0.18] px-2.5 py-1 text-xs text-zinc-300 hover:text-white transition-colors"
          >
            {copied ? (
              <Check className="w-3 h-3 text-brand-400" />
            ) : (
              <Clipboard className="w-3 h-3 text-zinc-500" />
            )}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        )}
      </div>

      {/* Chat Messages */}
      <div className="max-h-[540px] overflow-y-auto divide-y divide-white/[0.06]">
        {prompt && (
          <div className="px-4 py-3.5 bg-brand-600/[0.06]">
            <div className="text-[11px] font-medium text-brand-400 mb-1">You</div>
            <p className="text-[13px] text-zinc-200 whitespace-pre-wrap leading-relaxed">{prompt}</p>
          </div>
        )}

        <div className="px-4 py-4">
          <div className="text-[11px] font-medium text-zinc-500 mb-1.5">Agent</div>
          {summary ? (
            <MarkdownResult text={summary} />
          ) : isRunning ? (
            <div className="flex items-center gap-2.5 py-1">
              <div className="flex items-center gap-1" aria-hidden="true">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-typing-1" />
                <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-typing-2" />
                <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-typing-3" />
              </div>
              <span className="text-xs text-zinc-500">
                {status === TaskStatus.PENDING
                  ? 'Waiting for worker…'
                  : 'Working on repository…'}
              </span>
            </div>
          ) : status === TaskStatus.FAILED ? (
            <div className="flex items-center gap-2 text-xs text-rose-400">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Run failed before producing a summary. See console output.</span>
            </div>
          ) : status === TaskStatus.CANCELLED ? (
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>This task was stopped before completion.</span>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">Completed without a text summary.</p>
          )}
        </div>
      </div>
    </section>
  );
}
