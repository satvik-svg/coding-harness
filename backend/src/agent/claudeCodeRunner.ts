import { spawn } from 'child_process';
import readline from 'readline';
import { AgentLoopResult, TaskMode } from '@coding-harness/shared';

const STRIPPED_CLAUDE_ENV_KEYS = [
  // Prevent npm/yarn/pnpm inside target repos from skipping devDependencies (e.g. typescript, jest, eslint)
  'NODE_ENV',
  'npm_config_production',
  'NPM_CONFIG_PRODUCTION',
  // Strip backend server secrets and internal host settings from agent subprocesses
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_CALLBACK_URL',
  'LITELLM_MASTER_KEY',
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_PASSWORD',
  'OPENAI_API_KEY',
  'AI_API_KEY',
  'PORT',
  'HOST',
  'CORS_ORIGIN',
  'WORKSPACES_DIR',
  'UPLOADS_DIR',
  'COST_REPORT_PROJECT',
  'VERTEXAI_PROJECT',
  'VERTEXAI_LOCATION',
] as const;

export const HARNESS_SYSTEM_PROMPT = [
  'You are running inside Coding Harness on an isolated local Git clone of the repository.',
  'Work efficiently to stay within your turn budget: batch related file reads and commands instead of inspecting one file per turn.',
  'Make the requested fixes directly in the workspace and verify them where practical.',
  'Stop immediately once the requested change is implemented and tests pass — do not spend extra turns chasing unrelated deprecation warnings, lint noise, or unrequested refactors.',
  'Avoid running full package installs unless strictly required.',
  'Do not run git push or create a Pull Request via git/gh CLI (push credentials are not present here); leave your verified changes in the repository and provide a concise summary so Coding Harness can capture the Git diff and open the PR from the UI.',
].join(' ');

export const READ_ONLY_SYSTEM_PROMPT = [
  'You are running inside Coding Harness in READ-ONLY analysis mode on a local Git clone of the repository.',
  'Do NOT modify any files or run shell commands.',
  'Inspect the codebase efficiently using read/search tools (batch related reads) and return a clear, concise, actionable analysis directly answering the user prompt, citing exact file paths and line numbers where relevant.',
].join(' ');

/** Build a sanitized environment for the Claude Code child process. */
export function buildClaudeEnv(sourceEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...sourceEnv };
  for (const key of STRIPPED_CLAUDE_ENV_KEYS) {
    delete env[key];
  }
  return env;
}

/** Run Claude Code in a dedicated, trusted demo workspace. */
export async function runClaudeCode(options: {
  workspacePath: string;
  prompt: string;
  onProgress: (message: string) => Promise<void>;
  executable?: string;
  executableArgs?: string[];
  signal?: AbortSignal;
  mode?: TaskMode;
}): Promise<AgentLoopResult> {
  if (options.signal?.aborted) {
    return { success: false, cancelled: true, iterations: 0, totalToolCalls: 0, steps: [] };
  }
  const isReadOnly = options.mode === 'read';
  const model = process.env.CLAUDE_CODE_MODEL || 'gemini-4-hydrogen';
  const budget = (process.env.CLAUDE_CODE_MAX_BUDGET_USD || '15.00').trim();
  const configuredTurns = Number(process.env.CLAUDE_CODE_MAX_TURNS || '30');
  const turns = String(
    isReadOnly
      ? Math.min(Number.isFinite(configuredTurns) && configuredTurns > 0 ? configuredTurns : 30, 15)
      : Number.isFinite(configuredTurns) && configuredTurns > 0
        ? configuredTurns
        : 30,
  );
  const timeoutMs = Number(process.env.CLAUDE_CODE_TIMEOUT_MS || '900000');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid Claude timeout');

  const args = [
    '-p',
    '--verbose',
    '--output-format',
    'stream-json',
    '--model',
    model,
    '--max-turns',
    turns,
    '--append-system-prompt',
    isReadOnly ? READ_ONLY_SYSTEM_PROMPT : HARNESS_SYSTEM_PROMPT,
    '--dangerously-skip-permissions',
  ];

  if (budget && budget !== '0' && budget.toLowerCase() !== 'off') {
    args.push('--max-budget-usd', budget);
  }

  if (isReadOnly) {
    args.push('--disallowedTools', 'Write,Edit,NotebookEdit,Bash');
  }
  const child = spawn(
    options.executable || process.env.CLAUDE_CODE_BINARY || 'claude',
    [...(options.executableArgs || []), ...args],
    {
      cwd: options.workspacePath,
      env: buildClaudeEnv(process.env),
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  child.stdin.on('error', () => {
    /* process failure is reported below */
  });
  child.stdin.end(options.prompt);
  let pending = Promise.resolve();
  let resultError: string | undefined;
  let finalAnswer: string | undefined;
  let lastAssistantText: string | undefined;
  let sawResult = false;
  let timedOut = false;
  let cancelled = false;
  const killChild = () => {
    if (child.pid && process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already exited */
      }
    } else {
      child.kill('SIGKILL');
    }
  };
  const onAbort = () => {
    cancelled = true;
    killChild();
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const log = (message: string) => {
    pending = pending.then(() => options.onProgress(message));
  };
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    try {
      const event = JSON.parse(line);
      if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
        for (const part of event.message.content) {
          if (part.type === 'text' && part.text) {
            lastAssistantText = String(part.text);
            log(lastAssistantText);
          } else if (part.type === 'tool_use') log(`Claude tool: ${part.name}`);
        }
      } else if (event.type === 'user' && Array.isArray(event.message?.content)) {
        for (const part of event.message.content) {
          if (part.type !== 'tool_result') continue;
          const output =
            typeof part.content === 'string'
              ? part.content
              : Array.isArray(part.content)
                ? part.content.map((item: { text?: string }) => item.text || '').join('\n')
                : '';
          if (output.trim()) log(`Tool output: ${output.slice(0, 6000)}`);
        }
      } else if (event.type === 'result') {
        sawResult = true;
        if (event.result) {
          finalAnswer = String(event.result);
          if (finalAnswer !== lastAssistantText) log(finalAnswer);
        }
        if (event.is_error || event.subtype !== 'success') {
          if (event.subtype === 'error_max_turns') {
            resultError = `Reached maximum agent turns (${turns}) before completing the task. Try narrowing the prompt or increasing CLAUDE_CODE_MAX_TURNS.`;
          } else if (event.subtype === 'error_max_budget_usd') {
            resultError = `Reached maximum budget limit ($${budget}) before completing the task.`;
          } else {
            resultError = String(event.result || event.subtype || 'Claude returned an error');
          }
        }
      }
    } catch {
      if (line.trim()) log(line);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => log(chunk.trim()));
  const timer = setTimeout(() => {
    timedOut = true;
    killChild();
  }, timeoutMs);
  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    await pending;
    if (cancelled || options.signal?.aborted) {
      return { success: false, cancelled: true, iterations: 0, totalToolCalls: 0, steps: [] };
    }
    if (timedOut) throw new Error(`Claude Code exceeded ${timeoutMs} ms`);
    if (exitCode !== 0 || resultError || !sawResult) {
      throw new Error(
        resultError || `Claude Code exited with code ${exitCode} without a successful result`,
      );
    }
    return { success: true, iterations: 0, totalToolCalls: 0, steps: [], summary: finalAnswer };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    lines.close();
  }
}
