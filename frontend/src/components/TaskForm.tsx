import React, { useState } from 'react';
import { useRouter } from 'next/router';
import {
  GitBranch,
  FolderArchive,
  ArrowUp,
  Loader2,
  Link2,
  UploadCloud,
  AlertCircle,
  ChevronDown,
  Lock,
  Eye,
  Code2,
} from 'lucide-react';
import { TaskMode } from '@coding-harness/shared';
import { ApiService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

const QUICK_PROMPTS = [
  {
    label: 'Fix failing tests',
    prompt: 'Fix failing unit tests in the test suite and verify clean test execution.',
  },
  {
    label: 'Add /health endpoint',
    prompt: 'Add a /health status endpoint and verify it with automated tests.',
  },
  {
    label: 'Write CONTRIBUTING.md',
    prompt:
      'Inspect this repository and add a concise CONTRIBUTING.md file with setup and contribution guidelines based on the existing project files.',
  },
  {
    label: 'Refactor DB queries',
    prompt: 'Refactor database query logic to use connection pooling and handle timeouts.',
  },
];

export function TaskForm() {
  const router = useRouter();
  const { isAuthenticated, openAuthModal, github, githubRepos } = useAuth();
  const { toast } = useToast();
  const [sourceType, setSourceType] = useState<'url' | 'zip'>('url');
  const [mode, setMode] = useState<TaskMode>('edit');
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [prompt, setPrompt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [repoMenuOpen, setRepoMenuOpen] = useState(false);

  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

  const submitTask = async () => {
    setErrorMessage(null);

    if (!isAuthenticated) {
      toast('Sign in required', {
        description: 'Sign in or create an account to run private coding tasks.',
        variant: 'info',
      });
      openAuthModal('login');
      return;
    }

    if (!prompt.trim()) {
      setErrorMessage('Enter instructions for what you want the agent to do.');
      return;
    }

    if (sourceType === 'url' && !repoUrl.trim()) {
      setErrorMessage('Provide a Git repository URL.');
      return;
    }

    if (sourceType === 'zip' && !file) {
      setErrorMessage('Select a .zip repository archive to upload.');
      return;
    }

    setIsSubmitting(true);

    try {
      const task = await ApiService.submitTask({
        repoUrl: sourceType === 'url' ? repoUrl.trim() : undefined,
        branch: branch.trim() || undefined,
        prompt: prompt.trim(),
        file: sourceType === 'zip' && file ? file : undefined,
        mode,
      });

      router.push(`/tasks/${task.id}`);
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred while submitting your task.');
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitTask();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !isSubmitting) {
      e.preventDefault();
      submitTask();
    }
  };

  return (
    <div className="space-y-3 animate-enter">
      {errorMessage && (
        <div className="px-3.5 py-2.5 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-200 text-xs flex items-center gap-2 animate-enter">
          <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Unified Chat Composer Shell */}
        <div className="panel rounded-xl overflow-hidden transition-colors duration-150 focus-within:border-brand-500/60 focus-within:ring-1 focus-within:ring-brand-500/25">
          {/* Top Context Strip: Repo / Branch / Source Switch */}
          <div className="px-3.5 py-2.5 bg-[#121318] border-b border-white/[0.06] flex flex-wrap items-center gap-2">
            {!demoMode && (
              <div className="inline-flex p-0.5 rounded-lg bg-[#09090b] border border-white/[0.07] flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setSourceType('url')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    sourceType === 'url'
                      ? 'bg-[#1c1f29] text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <Link2 className="w-3 h-3" />
                  <span>Git</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSourceType('zip')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    sourceType === 'zip'
                      ? 'bg-[#1c1f29] text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <FolderArchive className="w-3 h-3" />
                  <span>ZIP</span>
                </button>
              </div>
            )}

            {sourceType === 'url' ? (
              <div className="flex-1 min-w-[220px] flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                {github.connected && githubRepos.length > 0 && (
                  <div className="relative flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => setRepoMenuOpen((prev) => !prev)}
                      className="w-full sm:w-auto flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#09090b] border border-brand-500/30 hover:border-brand-500/60 text-xs text-brand-300 transition-colors whitespace-nowrap"
                    >
                      <span>My repos</span>
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    {repoMenuOpen && (
                      <div className="absolute left-0 top-full mt-1.5 z-40 w-72 max-h-64 overflow-y-auto rounded-xl border border-white/[0.1] bg-[#111216] p-1.5 shadow-2xl animate-enter">
                        {githubRepos.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => {
                              setRepoUrl(r.htmlUrl);
                              setBranch(r.defaultBranch);
                              setRepoMenuOpen(false);
                            }}
                            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-white/[0.05] transition-colors"
                          >
                            <span className="text-xs font-mono text-zinc-200 truncate">
                              {r.fullName}
                            </span>
                            {r.private && <Lock className="w-3 h-3 text-zinc-500 flex-shrink-0" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="relative flex-1">
                  <Link2 className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="url"
                    required
                    placeholder="https://github.com/owner/repo"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 bg-[#09090b] border border-white/[0.07] hover:border-white/[0.14] focus:border-brand-500 rounded-lg text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none transition-colors font-mono"
                  />
                </div>
                <div className="relative sm:w-36">
                  <GitBranch className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="branch (main)"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    className="w-full pl-8 pr-2.5 py-1.5 bg-[#09090b] border border-white/[0.07] hover:border-white/[0.14] focus:border-brand-500 rounded-lg text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none transition-colors font-mono"
                  />
                </div>
              </div>
            ) : (
              <div className="flex-1 min-w-[220px]">
                <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-dashed border-white/[0.14] hover:border-brand-500/60 bg-[#09090b] cursor-pointer text-xs text-zinc-300 transition-colors">
                  <UploadCloud className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                  <span className="truncate">
                    {file
                      ? `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`
                      : 'Choose .zip archive (max 50MB)'}
                  </span>
                  <input
                    type="file"
                    accept=".zip"
                    required={sourceType === 'zip'}
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="sr-only"
                  />
                </label>
              </div>
            )}
          </div>

          {/* Prompt Textarea */}
          <textarea
            required
            rows={5}
            placeholder={
              mode === 'read'
                ? 'Ask a question or request a read-only code review (no files modified, faster & cheaper)...'
                : 'Describe the changes you want to make...'
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full px-4 py-3.5 bg-transparent text-zinc-100 placeholder-zinc-600 text-sm focus:outline-none resize-y leading-relaxed"
          />

          {/* Bottom Action Bar */}
          <div className="px-3.5 py-2.5 bg-[#0c0d11] border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {/* Read-Only Analyze vs Edit/Write Mode Toggle */}
              <div
                className="inline-flex p-0.5 rounded-lg bg-[#09090b] border border-white/[0.08] flex-shrink-0"
                role="group"
                aria-label="Execution mode"
              >
                <button
                  type="button"
                  onClick={() => setMode('edit')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    mode === 'edit'
                      ? 'bg-brand-600/20 text-brand-300'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                  title="Edit files, run tests, and generate a Git diff"
                >
                  <Code2 className="w-3 h-3" />
                  <span>Code</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('read')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    mode === 'read'
                      ? 'bg-brand-600/20 text-brand-300'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                  title="Read-only analysis & Q&A — no edits or shell commands, faster & lower cost"
                >
                  <Eye className="w-3 h-3" />
                  <span>Read only</span>
                </button>
              </div>

              <span className="hidden md:inline text-[11px] text-zinc-500 truncate">
                {mode === 'read'
                  ? 'Inspect & answer only · no edits'
                  : demoMode
                    ? 'Demo VM · trusted public repos only'
                    : 'Press ⌘↵ to run'}
              </span>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 active:scale-[0.98] text-white text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Starting…</span>
                </>
              ) : (
                <>
                  <span>{mode === 'read' ? 'Analyze repo' : 'Run task'}</span>
                  <ArrowUp className="w-3.5 h-3.5 group-hover:-translate-y-0.5 transition-transform" />
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Understated Quick Starters */}
      <div className="flex flex-wrap items-center gap-1.5">
        {QUICK_PROMPTS.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => setPrompt(item.prompt)}
            className="px-2.5 py-1 rounded-md bg-white/[0.03] hover:bg-brand-500/10 border border-white/[0.06] hover:border-brand-500/30 text-[11px] text-zinc-400 hover:text-blue-200 transition-colors"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
