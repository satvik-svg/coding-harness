import React, { useMemo, useState } from 'react';
import {
  GitPullRequest,
  Download,
  Copy,
  Check,
  FileCode,
  ChevronDown,
  ChevronRight,
  Columns2,
  AlignJustify,
  PanelLeft,
  X,
  Loader2,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import { CreatePullRequestResult, TaskStatus } from '@coding-harness/shared';
import { ApiService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

interface DiffViewerProps {
  diff: string;
  taskId: string;
  status: TaskStatus;
  repoUrl?: string;
  prompt?: string;
}

interface DiffLine {
  type: 'add' | 'del' | 'context' | 'hunk' | 'meta';
  content: string;
  oldNum?: number;
  newNum?: number;
}

interface SplitRow {
  left?: { num?: number; text: string; type: 'del' | 'context' | 'hunk' | 'empty' };
  right?: { num?: number; text: string; type: 'add' | 'context' | 'hunk' | 'empty' };
}

interface ParsedDiffFile {
  id: string;
  path: string;
  oldPath: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  addedCount: number;
  removedCount: number;
  lines: DiffLine[];
  splitRows: SplitRow[];
}

function buildSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.type === 'meta') {
      i++;
      continue;
    }
    if (line.type === 'hunk') {
      rows.push({
        left: { text: line.content, type: 'hunk' },
        right: { text: '', type: 'hunk' },
      });
      i++;
      continue;
    }
    if (line.type === 'context') {
      rows.push({
        left: { num: line.oldNum, text: line.content, type: 'context' },
        right: { num: line.newNum, text: line.content, type: 'context' },
      });
      i++;
      continue;
    }

    // Group contiguous deletions followed by additions so they pair side-by-side
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].type === 'del') {
      dels.push(lines[i]);
      i++;
    }
    while (i < lines.length && lines[i].type === 'add') {
      adds.push(lines[i]);
      i++;
    }

    const maxLen = Math.max(dels.length, adds.length);
    for (let k = 0; k < maxLen; k++) {
      const d = dels[k];
      const a = adds[k];
      rows.push({
        left: d
          ? { num: d.oldNum, text: d.content, type: 'del' }
          : { text: '', type: 'empty' },
        right: a
          ? { num: a.newNum, text: a.content, type: 'add' }
          : { text: '', type: 'empty' },
      });
    }
  }

  return rows;
}

function parseUnifiedDiff(rawDiff: string): ParsedDiffFile[] {
  if (!rawDiff || !rawDiff.trim()) return [];
  const rawLines = rawDiff.split('\n');
  const files: ParsedDiffFile[] = [];

  let current: {
    oldPath: string;
    newPath: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    addedCount: number;
    removedCount: number;
    lines: DiffLine[];
    oldLine: number;
    newLine: number;
  } | null = null;

  const finalize = () => {
    if (!current) return;
    const displayPath =
      current.newPath && current.newPath !== '/dev/null'
        ? current.newPath
        : current.oldPath || 'patch';
    files.push({
      id: `file-${files.length}`,
      path: displayPath,
      oldPath: current.oldPath,
      status: current.status,
      addedCount: current.addedCount,
      removedCount: current.removedCount,
      lines: current.lines,
      splitRows: buildSplitRows(current.lines),
    });
    current = null;
  };

  for (const line of rawLines) {
    if (line.startsWith('diff --git ')) {
      finalize();
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      current = {
        oldPath: match ? match[1] : '',
        newPath: match ? match[2] : '',
        status: 'modified',
        addedCount: 0,
        removedCount: 0,
        lines: [],
        oldLine: 0,
        newLine: 0,
      };
      continue;
    }

    if (!current) {
      // Fallback for non-git unified diffs
      current = {
        oldPath: 'changes',
        newPath: 'changes',
        status: 'modified',
        addedCount: 0,
        removedCount: 0,
        lines: [],
        oldLine: 1,
        newLine: 1,
      };
    }

    if (line.startsWith('new file mode')) {
      current.status = 'added';
      current.lines.push({ type: 'meta', content: line });
    } else if (line.startsWith('deleted file mode')) {
      current.status = 'deleted';
      current.lines.push({ type: 'meta', content: line });
    } else if (line.startsWith('rename from ') || line.startsWith('rename to ')) {
      current.status = 'renamed';
      current.lines.push({ type: 'meta', content: line });
    } else if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('index ')) {
      if (line.startsWith('--- /dev/null')) current.status = 'added';
      if (line.startsWith('+++ /dev/null')) current.status = 'deleted';
      current.lines.push({ type: 'meta', content: line });
    } else if (line.startsWith('@@')) {
      const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        current.oldLine = parseInt(hunkMatch[1], 10);
        current.newLine = parseInt(hunkMatch[2], 10);
      }
      current.lines.push({ type: 'hunk', content: line });
    } else if (line.startsWith('+')) {
      current.addedCount++;
      current.lines.push({
        type: 'add',
        content: line.slice(1),
        newNum: current.newLine++,
      });
    } else if (line.startsWith('-')) {
      current.removedCount++;
      current.lines.push({
        type: 'del',
        content: line.slice(1),
        oldNum: current.oldLine++,
      });
    } else if (line.startsWith(' ') || line === '') {
      current.lines.push({
        type: 'context',
        content: line.startsWith(' ') ? line.slice(1) : line,
        oldNum: current.oldLine++,
        newNum: current.newLine++,
      });
    } else {
      current.lines.push({ type: 'meta', content: line });
    }
  }

  finalize();
  return files;
}

const GH_TOKEN_STORAGE_KEY = 'ch_github_pat';

export function DiffViewer({ diff, taskId, status, repoUrl, prompt }: DiffViewerProps) {
  const { github, connectGitHub } = useAuth();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');
  const [showSidebar, setShowSidebar] = useState(true);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});
  const [showManualPat, setShowManualPat] = useState(false);

  // GitHub PR modal state
  const [prModalOpen, setPrModalOpen] = useState(false);
  const [githubToken, setGithubToken] = useState(() =>
    typeof window !== 'undefined' ? window.localStorage.getItem(GH_TOKEN_STORAGE_KEY) || '' : '',
  );
  const [rememberToken, setRememberToken] = useState(() =>
    typeof window !== 'undefined' ? Boolean(window.localStorage.getItem(GH_TOKEN_STORAGE_KEY)) : false,
  );
  const [branchName, setBranchName] = useState(`coding-harness/${taskId.substring(0, 8)}`);
  const [baseBranch, setBaseBranch] = useState('');
  const [prTitle, setPrTitle] = useState(
    prompt ? `Coding Harness: ${prompt.trim().replace(/\s+/g, ' ').slice(0, 68)}` : 'Coding Harness changes',
  );
  const [prBody, setPrBody] = useState(
    prompt ? `Automated changes generated by Coding Harness.\n\n**Prompt:** ${prompt.trim()}` : '',
  );
  const [prSubmitting, setPrSubmitting] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);
  const [prResult, setPrResult] = useState<CreatePullRequestResult | null>(null);

  const files = useMemo(() => parseUnifiedDiff(diff), [diff]);

  const { totalAdded, totalRemoved } = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const f of files) {
      added += f.addedCount;
      removed += f.removedCount;
    }
    return { totalAdded: added, totalRemoved: removed };
  }, [files]);

  const isGitHubRepo = Boolean(repoUrl && repoUrl.startsWith('https://github.com/'));

  const visibleFiles = useMemo(() => {
    if (!selectedFileId) return files;
    return files.filter((f) => f.id === selectedFileId);
  }, [files, selectedFileId]);

  const handleCopy = () => {
    navigator.clipboard.writeText(diff);
    setCopied(true);
    toast('Diff copied to clipboard', { variant: 'info' });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadPatch = () => {
    const blob = new Blob([diff], { type: 'text/x-diff;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `task-${taskId.substring(0, 8)}.patch`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const toggleCollapseFile = (id: string) => {
    setCollapsedFiles((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleOpenPr = async (e: React.FormEvent) => {
    e.preventDefault();
    setPrError(null);
    setPrSubmitting(true);
    try {
      if (typeof window !== 'undefined') {
        if (rememberToken && githubToken.trim()) {
          window.localStorage.setItem(GH_TOKEN_STORAGE_KEY, githubToken.trim());
        } else {
          window.localStorage.removeItem(GH_TOKEN_STORAGE_KEY);
        }
      }

      const result = await ApiService.createPullRequest(taskId, {
        githubToken: !github.connected && githubToken.trim() ? githubToken.trim() : undefined,
        branchName: branchName.trim() || undefined,
        baseBranch: baseBranch.trim() || undefined,
        title: prTitle.trim() || undefined,
        body: prBody.trim() || undefined,
      });

      setPrResult(result);
      setPrModalOpen(false);
      toast(`Pull Request #${result.prNumber} opened`, {
        description: `Pushed branch ${result.branchName}`,
        variant: 'success',
      });
    } catch (err: any) {
      setPrError(err.message || 'Could not open Pull Request');
    } finally {
      setPrSubmitting(false);
    }
  };

  if (!diff || !diff.trim()) {
    return (
      <div className="panel rounded-xl p-8 text-center">
        <FileCode className="w-6 h-6 text-zinc-600 mx-auto mb-2.5" />
        <h4 className="text-xs font-medium text-zinc-300">
          {status === TaskStatus.COMPLETED ? 'No code changes' : 'No diff yet'}
        </h4>
        <p className="text-xs text-zinc-500 mt-1 max-w-xs mx-auto">
          {status === TaskStatus.COMPLETED
            ? 'This run finished without modifying any files.'
            : status === TaskStatus.FAILED
              ? 'No patch was generated for this failed run.'
              : status === TaskStatus.CANCELLED
                ? 'Task was stopped before a patch was recorded.'
                : 'Changes will appear here once the agent edits files.'}
        </p>
      </div>
    );
  }

  const fileStatusBadge = (s: ParsedDiffFile['status']) => {
    switch (s) {
      case 'added':
        return <span className="px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-mono text-[10px]">A</span>;
      case 'deleted':
        return <span className="px-1 py-0.5 rounded bg-rose-500/15 text-rose-400 font-mono text-[10px]">D</span>;
      case 'renamed':
        return <span className="px-1 py-0.5 rounded bg-amber-500/15 text-amber-400 font-mono text-[10px]">R</span>;
      default:
        return <span className="px-1 py-0.5 rounded bg-brand-500/15 text-brand-300 font-mono text-[10px]">M</span>;
    }
  };

  return (
    <>
      <div className="panel rounded-xl overflow-hidden flex flex-col animate-enter">
        {/* Top Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-[#121318] border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              type="button"
              onClick={() => setShowSidebar((prev) => !prev)}
              className={`p-1 rounded-md border transition-colors ${
                showSidebar
                  ? 'border-brand-500/35 bg-brand-500/15 text-brand-300'
                  : 'border-white/[0.08] bg-[#09090b] text-zinc-500 hover:text-zinc-200'
              }`}
              title="Toggle changed files sidebar"
            >
              <PanelLeft className="w-3.5 h-3.5" />
            </button>
            <GitPullRequest className="w-3.5 h-3.5 text-brand-400" />
            <span className="text-xs font-medium text-zinc-200">
              Changed files ({files.length})
            </span>
            <span className="text-[11px] font-mono text-emerald-400">+{totalAdded}</span>
            {totalRemoved > 0 && (
              <span className="text-[11px] font-mono text-rose-400">-{totalRemoved}</span>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Unified / Split Switcher */}
            <div className="inline-flex p-0.5 rounded-md bg-[#09090b] border border-white/[0.08]">
              <button
                type="button"
                onClick={() => setViewMode('unified')}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                  viewMode === 'unified'
                    ? 'bg-brand-600/20 text-brand-300'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
                title="Unified diff view"
              >
                <AlignJustify className="w-3 h-3" />
                <span>Unified</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('split')}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                  viewMode === 'split'
                    ? 'bg-brand-600/20 text-brand-300'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
                title="Side-by-side split diff view"
              >
                <Columns2 className="w-3 h-3" />
                <span>Split</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#09090b] border border-white/[0.08] hover:border-white/[0.18] text-xs text-zinc-300 hover:text-white transition-colors"
            >
              {copied ? (
                <Check className="w-3 h-3 text-brand-400" />
              ) : (
                <Copy className="w-3 h-3 text-zinc-500" />
              )}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadPatch}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#09090b] border border-white/[0.08] hover:border-white/[0.18] text-xs text-zinc-300 hover:text-white transition-colors"
            >
              <Download className="w-3 h-3 text-zinc-400" />
              <span>.patch</span>
            </button>

            {isGitHubRepo &&
              (prResult ? (
                <a
                  href={prResult.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition-colors"
                >
                  <GitPullRequest className="w-3 h-3" />
                  <span>PR #{prResult.prNumber}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setPrError(null);
                    setPrModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-brand-600 hover:bg-brand-500 text-white font-medium text-xs transition-colors"
                >
                  <GitPullRequest className="w-3 h-3" />
                  <span>Open PR</span>
                </button>
              ))}
          </div>
        </div>

        {/* Success PR Banner if created in this session */}
        {prResult && (
          <div className="px-4 py-2.5 bg-emerald-500/10 border-b border-emerald-500/20 flex items-center justify-between gap-2 text-xs">
            <span className="text-emerald-300 font-medium">
              Pull Request #{prResult.prNumber} opened on branch{' '}
              <code className="font-mono text-emerald-200">{prResult.branchName}</code>
            </span>
            <a
              href={prResult.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200 underline underline-offset-2 font-medium"
            >
              <span>View on GitHub</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        {/* Body: Sidebar + Diff Content */}
        <div className="flex flex-col md:flex-row min-h-[300px] max-h-[600px]">
          {/* Changed Files Sidebar */}
          {showSidebar && (
            <aside className="w-full md:w-60 flex-shrink-0 border-b md:border-b-0 md:border-r border-white/[0.06] bg-[#0c0d11] overflow-y-auto p-2 space-y-0.5">
              <button
                type="button"
                onClick={() => setSelectedFileId(null)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                  selectedFileId === null
                    ? 'bg-brand-600/20 text-brand-300 font-medium'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
                }`}
              >
                <span>All files</span>
                <span className="font-mono text-[10px]">{files.length}</span>
              </button>

              {files.map((file) => {
                const isSelected = selectedFileId === file.id;
                const fileName = file.path.split('/').pop() || file.path;
                const dirPath = file.path.includes('/')
                  ? file.path.slice(0, file.path.lastIndexOf('/'))
                  : '';
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => setSelectedFileId(isSelected ? null : file.id)}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-left transition-colors ${
                      isSelected
                        ? 'bg-brand-600/20 text-white'
                        : 'text-zinc-300 hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {fileStatusBadge(file.status)}
                      <div className="min-w-0">
                        <div className="text-xs font-mono truncate">{fileName}</div>
                        {dirPath && (
                          <div className="text-[10px] font-mono text-zinc-600 truncate">
                            {dirPath}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 font-mono text-[10px] flex-shrink-0">
                      {file.addedCount > 0 && (
                        <span className="text-emerald-400">+{file.addedCount}</span>
                      )}
                      {file.removedCount > 0 && (
                        <span className="text-rose-400">-{file.removedCount}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </aside>
          )}

          {/* File Diffs Pane */}
          <div className="flex-1 overflow-auto bg-[#09090b] p-3 space-y-3">
            {visibleFiles.map((file) => {
              const collapsed = Boolean(collapsedFiles[file.id]);
              return (
                <div
                  key={file.id}
                  className="rounded-lg border border-white/[0.07] overflow-hidden"
                >
                  {/* File Header */}
                  <button
                    type="button"
                    onClick={() => toggleCollapseFile(file.id)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-[#121318] hover:bg-[#171922] border-b border-white/[0.06] text-left transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {collapsed ? (
                        <ChevronRight className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                      )}
                      {fileStatusBadge(file.status)}
                      <span className="text-xs font-mono text-zinc-200 truncate">{file.path}</span>
                    </div>
                    <div className="flex items-center gap-1.5 font-mono text-[11px] flex-shrink-0">
                      <span className="text-emerald-400">+{file.addedCount}</span>
                      <span className="text-rose-400">-{file.removedCount}</span>
                    </div>
                  </button>

                  {!collapsed && (
                    <div className="overflow-x-auto font-mono text-[12px] leading-5">
                      {viewMode === 'unified' ? (
                        <div className="min-w-full">
                          {file.lines
                            .filter((l) => l.type !== 'meta')
                            .map((line, idx) => {
                              const rowClass =
                                line.type === 'add'
                                  ? 'bg-emerald-500/[0.1] text-emerald-300'
                                  : line.type === 'del'
                                    ? 'bg-rose-500/[0.1] text-rose-300'
                                    : line.type === 'hunk'
                                      ? 'bg-brand-500/[0.1] text-brand-300'
                                      : 'text-zinc-400';
                              const marker =
                                line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
                              return (
                                <div key={idx} className={`flex items-start px-2 py-0.5 ${rowClass}`}>
                                  <span className="w-9 text-right pr-2 text-zinc-600 select-none flex-shrink-0">
                                    {line.oldNum ?? ''}
                                  </span>
                                  <span className="w-9 text-right pr-2 text-zinc-600 select-none flex-shrink-0">
                                    {line.newNum ?? ''}
                                  </span>
                                  <span className="w-4 select-none flex-shrink-0 opacity-70">
                                    {line.type === 'hunk' ? '' : marker}
                                  </span>
                                  <span className="whitespace-pre-wrap break-all flex-1">
                                    {line.content}
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      ) : (
                        /* Split (Side-by-Side) Diff View */
                        <div className="min-w-[680px] divide-y divide-white/[0.03]">
                          {file.splitRows.map((row, idx) => {
                            if (row.left?.type === 'hunk') {
                              return (
                                <div
                                  key={idx}
                                  className="px-3 py-1 bg-brand-500/[0.1] text-brand-300 text-[11px]"
                                >
                                  {row.left.text}
                                </div>
                              );
                            }
                            const leftClass =
                              row.left?.type === 'del'
                                ? 'bg-rose-500/[0.1] text-rose-300'
                                : row.left?.type === 'empty'
                                  ? 'bg-white/[0.015]'
                                  : 'text-zinc-400';
                            const rightClass =
                              row.right?.type === 'add'
                                ? 'bg-emerald-500/[0.1] text-emerald-300'
                                : row.right?.type === 'empty'
                                  ? 'bg-white/[0.015]'
                                  : 'text-zinc-400';

                            return (
                              <div key={idx} className="grid grid-cols-2 divide-x divide-white/[0.06]">
                                <div className={`flex items-start px-2 py-0.5 ${leftClass}`}>
                                  <span className="w-8 text-right pr-2 text-zinc-600 select-none flex-shrink-0">
                                    {row.left?.num ?? ''}
                                  </span>
                                  <span className="whitespace-pre-wrap break-all flex-1">
                                    {row.left?.text ?? ''}
                                  </span>
                                </div>
                                <div className={`flex items-start px-2 py-0.5 ${rightClass}`}>
                                  <span className="w-8 text-right pr-2 text-zinc-600 select-none flex-shrink-0">
                                    {row.right?.num ?? ''}
                                  </span>
                                  <span className="whitespace-pre-wrap break-all flex-1">
                                    {row.right?.text ?? ''}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Open GitHub Pull Request Modal */}
      {prModalOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-enter"
          onClick={() => setPrModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="open-pr-modal-title"
        >
          <div
            className="w-full max-w-md rounded-xl border border-white/[0.1] bg-[#0f1014] shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GitPullRequest className="w-4 h-4 text-brand-400" />
                <h3 id="open-pr-modal-title" className="text-sm font-semibold text-zinc-100">
                  Open GitHub Pull Request
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPrModalOpen(false)}
                className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleOpenPr} className="p-5 space-y-3.5">
              {prError && (
                <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>{prError}</span>
                </div>
              )}

              {github.connected ? (
                <div className="px-3 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    {github.avatarUrl && (
                      <img
                        src={github.avatarUrl}
                        alt={github.login || 'GitHub'}
                        className="w-4 h-4 rounded-full"
                      />
                    )}
                    <span className="text-emerald-300 truncate">
                      Connected as <strong className="font-mono">@{github.login}</strong>
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400/80 uppercase">OAuth</span>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={() => connectGitHub(`/tasks/${taskId}`)}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-white text-zinc-950 hover:bg-zinc-200 text-xs font-semibold transition-colors"
                  >
                    <span>Connect GitHub Account (1-click OAuth)</span>
                  </button>

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => setShowManualPat((prev) => !prev)}
                      className="text-[11px] text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
                    >
                      {showManualPat
                        ? 'Hide manual token input'
                        : 'Or paste a Personal Access Token manually'}
                    </button>
                  </div>

                  {showManualPat && (
                    <div>
                      <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                        GitHub Personal Access Token <span className="text-brand-400">*</span>
                      </label>
                      <input
                        type="password"
                        required={!github.connected}
                        placeholder="ghp_... or github_pat_..."
                        value={githubToken}
                        onChange={(e) => setGithubToken(e.target.value)}
                        className="w-full px-3 py-2 bg-[#09090b] border border-white/[0.08] focus:border-brand-500 rounded-lg text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none"
                      />
                      <label className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-500 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rememberToken}
                          onChange={(e) => setRememberToken(e.target.checked)}
                          className="rounded border-white/20 bg-[#09090b]"
                        />
                        <span>Remember token in this browser (repo + pull_requests scope)</span>
                      </label>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                    New branch name
                  </label>
                  <input
                    type="text"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    className="w-full px-3 py-2 bg-[#09090b] border border-white/[0.08] focus:border-brand-500 rounded-lg text-xs font-mono text-zinc-100 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                    Base branch (optional)
                  </label>
                  <input
                    type="text"
                    placeholder="default branch"
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    className="w-full px-3 py-2 bg-[#09090b] border border-white/[0.08] focus:border-brand-500 rounded-lg text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">PR title</label>
                <input
                  type="text"
                  required
                  value={prTitle}
                  onChange={(e) => setPrTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-[#09090b] border border-white/[0.08] focus:border-brand-500 rounded-lg text-xs text-zinc-100 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={prBody}
                  onChange={(e) => setPrBody(e.target.value)}
                  className="w-full px-3 py-2 bg-[#09090b] border border-white/[0.08] focus:border-brand-500 rounded-lg text-xs text-zinc-100 focus:outline-none resize-y"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPrModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-white/[0.08] text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={prSubmitting}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium transition-colors disabled:opacity-50"
                >
                  {prSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Pushing &amp; opening…</span>
                    </>
                  ) : (
                    <>
                      <GitPullRequest className="w-3.5 h-3.5" />
                      <span>Push &amp; open PR</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
