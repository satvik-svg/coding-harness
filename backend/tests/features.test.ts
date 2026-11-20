import assert from 'assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import http from 'http';
import { execFileSync } from 'child_process';
import { createApp } from '../src/app';
import { GitService } from '../src/services/gitService';
import { StorageService } from '../src/services/storageService';
import {
  registerActiveTask,
  cancelActiveTask,
  isTaskCancelled,
  unregisterActiveTask,
} from '../src/jobs/taskRegistry';
import {
  runClaudeCode,
  HARNESS_SYSTEM_PROMPT,
  READ_ONLY_SYSTEM_PROMPT,
} from '../src/agent/claudeCodeRunner';
import { GitHubPrService } from '../src/services/githubPrService';
import {
  isGitHubOAuthConfigured,
  sealGitHubSession,
  unsealGitHubSession,
  signOAuthState,
  verifyOAuthState,
} from '../src/services/githubOAuthService';
import { taskRoutes } from '../src/routes/taskRoutes';
import { authRoutes } from '../src/routes/authRoutes';

async function testTaskRegistryAndCancellation() {
  const taskId = 'test-cancel-registry-1';
  let handlerCalled = false;

  const handle = registerActiveTask(taskId);
  handle.onCancel(() => {
    handlerCalled = true;
  });

  assert.strictEqual(handle.signal.aborted, false, 'Signal should start non-aborted');
  assert.strictEqual(isTaskCancelled(taskId), false, 'Task should not be marked cancelled yet');

  const cancelled = await cancelActiveTask(taskId);
  assert.strictEqual(cancelled, true, 'cancelActiveTask should return true for active task');
  assert.strictEqual(handle.signal.aborted, true, 'AbortSignal should be aborted');
  assert.strictEqual(isTaskCancelled(taskId), true, 'Task should be marked cancelled');
  assert.strictEqual(handlerCalled, true, 'Cancel handler should have fired');

  unregisterActiveTask(taskId);
  assert.strictEqual(isTaskCancelled(taskId), false, 'Unregistering clears cancel state');
}

async function testClaudeCodeAbortSignal() {
  const controller = new AbortController();
  const logs: string[] = [];

  // Spawn a short Node script that sleeps for 10s unless aborted
  const runPromise = runClaudeCode({
    workspacePath: process.cwd(),
    prompt: 'test abort',
    onProgress: async (m) => {
      logs.push(m);
    },
    executable: process.execPath,
    executableArgs: ['-e', 'setTimeout(() => {}, 10000)', '--'],
    signal: controller.signal,
  });

  setTimeout(() => controller.abort(), 150);
  const result = await runPromise;

  assert.strictEqual(result.success, false, 'Aborted run should not succeed');
  assert.strictEqual(result.cancelled, true, 'Aborted run should report cancelled=true');
}

async function testGitHubPrValidation() {
  let caughtMessage = '';
  try {
    await GitHubPrService.openPullRequestFromDiff({
      taskId: 'abc12345',
      repoUrl: 'https://gitlab.com/user/repo',
      diff: 'diff --git a/a.txt b/a.txt\n+hi\n',
      prompt: 'test',
      githubToken: 'ghp_secret_token_value',
    });
  } catch (err) {
    caughtMessage = (err as Error).message;
  }

  assert.ok(
    caughtMessage.includes('github.com'),
    `Expected GitHub validation error, got: ${caughtMessage}`,
  );
  assert.ok(
    !caughtMessage.includes('ghp_secret_token_value'),
    'GitHub token must never appear in error messages',
  );
}

function testTaskRoutesRegistered() {
  const routes = (taskRoutes as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route!.path,
      methods: Object.keys(layer.route!.methods),
    }));

  const hasRoute = (path: string, method: string) =>
    routes.some((r) => r.path === path && r.methods.includes(method));

  assert.ok(hasRoute('/analytics', 'get'), 'GET /analytics route must be registered');
  assert.ok(hasRoute('/:id/cancel', 'post'), 'POST /:id/cancel route must be registered');
  assert.ok(hasRoute('/:id/retry', 'post'), 'POST /:id/retry route must be registered');
  assert.ok(hasRoute('/:id/pr', 'post'), 'POST /:id/pr route must be registered');

  // Ensure /analytics is declared BEFORE /:id so Express does not match "analytics" as an :id
  const analyticsIdx = routes.findIndex((r) => r.path === '/analytics');
  const idIdx = routes.findIndex((r) => r.path === '/:id');
  assert.ok(
    analyticsIdx >= 0 && idIdx >= 0 && analyticsIdx < idIdx,
    '/analytics route must come before /:id route',
  );
}

function testGitHubOAuthServiceAndRoutes() {
  assert.strictEqual(
    isGitHubOAuthConfigured(),
    true,
    'GitHub OAuth should be configured from backend/.env',
  );

  // AES-256-GCM seal / unseal roundtrip
  const sealed = sealGitHubSession({
    accessToken: 'gho_test_access_token_123',
    login: 'satvik-svg',
    name: 'Satvik',
    avatarUrl: 'https://avatars.githubusercontent.com/u/1',
  });
  assert.ok(!sealed.includes('gho_test_access_token_123'), 'Sealed session must not leak raw token');

  const unsealed = unsealGitHubSession(sealed);
  assert.strictEqual(unsealed.accessToken, 'gho_test_access_token_123');
  assert.strictEqual(unsealed.login, 'satvik-svg');

  // Tamper rejection
  let tamperRejected = false;
  try {
    unsealGitHubSession(`${sealed.slice(0, -4)}AAAA`);
  } catch {
    tamperRejected = true;
  }
  assert.strictEqual(tamperRejected, true, 'Tampered GitHub session must be rejected');

  // State JWT roundtrip + open-redirect protection
  const state = signOAuthState('http://localhost:3000', '//evil.example.com');
  const verified = verifyOAuthState(state);
  assert.strictEqual(verified.origin, 'http://localhost:3000');
  assert.strictEqual(verified.returnTo, '/', 'Protocol-relative returnTo must sanitize to /');

  // Routes mounted
  const routes = (
    authRoutes as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }
  ).stack
    .filter((layer) => layer.route)
    .map((layer) => layer.route!.path);

  assert.ok(routes.includes('/github/status'), 'GET /github/status must be mounted');
  assert.ok(routes.includes('/github/start'), 'GET /github/start must be mounted');
  assert.ok(routes.includes('/github/callback'), 'GET /github/callback must be mounted');
  assert.ok(routes.includes('/github/repos'), 'GET /github/repos must be mounted');
  assert.ok(routes.includes('/github/link'), 'POST /github/link must be mounted');
  assert.ok(routes.includes('/github/disconnect'), 'DELETE /github/disconnect must be mounted');
}

async function testPrivateTaskRoutesRequireAuth() {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;

  try {
    const listRes = await fetch(`${base}/api/tasks`);
    assert.strictEqual(listRes.status, 401, 'GET /api/tasks must require auth (401)');

    const analyticsRes = await fetch(`${base}/api/tasks/analytics`);
    assert.strictEqual(analyticsRes.status, 401, 'GET /api/tasks/analytics must require auth (401)');

    const createRes = await fetch(`${base}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'https://github.com/octocat/Hello-World', prompt: 'test' }),
    });
    assert.strictEqual(createRes.status, 401, 'POST /api/tasks must require auth (401)');

    const linkRes = await fetch(`${base}/api/auth/github/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ githubSession: 'dummy' }),
    });
    assert.strictEqual(linkRes.status, 401, 'POST /api/auth/github/link must require auth (401)');

    const disconnectRes = await fetch(`${base}/api/auth/github/disconnect`, {
      method: 'DELETE',
    });
    assert.strictEqual(
      disconnectRes.status,
      401,
      'DELETE /api/auth/github/disconnect must require auth (401)',
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testPrepareWorkspaceCleansStaleFiles() {
  const taskId = `stale-workspace-${Date.now()}`;
  const wsPath = await GitService.prepareWorkspace(taskId);
  try {
    await fs.writeFile(path.join(wsPath, 'leftover.txt'), 'from crashed run', 'utf8');
    // Re-preparing the same workspace (e.g. BullMQ stalled job retry) must wipe stale files
    await GitService.prepareWorkspace(taskId);
    const entries = await fs.readdir(wsPath);
    assert.strictEqual(entries.length, 0, 'prepareWorkspace must leave a completely empty directory');
  } finally {
    await GitService.cleanupWorkspace(taskId);
  }
}

async function testReadOnlyModeAndCostGuardrails() {
  assert.ok(
    HARNESS_SYSTEM_PROMPT.includes('Stop immediately once the requested change is implemented'),
    'Edit mode prompt must instruct agent to stop once done to save cost',
  );
  assert.ok(
    READ_ONLY_SYSTEM_PROMPT.includes('READ-ONLY'),
    'Read-only prompt must enforce read-only analysis',
  );

  let capturedArgs: string[] = [];
  const res = await runClaudeCode({
    workspacePath: process.cwd(),
    prompt: 'explain architecture',
    mode: 'read',
    onProgress: async () => {},
    executable: process.execPath,
    executableArgs: [
      '-e',
      `const args = process.argv.slice(1);
       console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(args) }));`,
      '--',
    ],
  });

  assert.strictEqual(res.success, true, 'Read-only run should succeed');
  capturedArgs = JSON.parse(res.summary || '[]');
  assert.ok(capturedArgs.includes('--disallowedTools'), 'Read-only mode must pass --disallowedTools');
  const idx = capturedArgs.indexOf('--disallowedTools');
  assert.strictEqual(
    capturedArgs[idx + 1],
    'Write,Edit,NotebookEdit,Bash',
    'Read-only mode must disallow Write,Edit,NotebookEdit,Bash',
  );
}

async function testZipExtractAndBaselineDiff() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ch-zip-test-'));
  const srcDir = path.join(tmp, 'src');
  const outDir = path.join(tmp, 'out');
  const zipPath = path.join(tmp, 'repo.zip');

  try {
    await fs.mkdir(path.join(srcDir, '.git'), { recursive: true });
    await fs.mkdir(path.join(srcDir, '__MACOSX'), { recursive: true });
    await fs.writeFile(path.join(srcDir, 'hello.js'), 'console.log("v1");\n', 'utf8');
    await fs.writeFile(path.join(srcDir, '.git', 'HEAD'), 'ref: refs/heads/old\n', 'utf8');
    await fs.writeFile(path.join(srcDir, '__MACOSX', 'junk'), 'junk\n', 'utf8');

    // Create zip archive using python3 zipfile (portable on macOS and Linux)
    execFileSync('python3', [
      '-c',
      `import os, sys, zipfile
src, dest = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dest, 'w') as zf:
    for root, _, files in os.walk(src):
        for f in files:
            full = os.path.join(root, f)
            zf.write(full, os.path.relpath(full, src))`,
      srcDir,
      zipPath,
    ]);

    await StorageService.extractZip(zipPath, outDir);

    // Extracted hello.js exists, while .git and __MACOSX were stripped
    const extracted = await fs.readFile(path.join(outDir, 'hello.js'), 'utf8');
    assert.strictEqual(extracted, 'console.log("v1");\n');
    const outEntries = await fs.readdir(outDir);
    assert.ok(!outEntries.includes('.git'), '.git inside uploaded zip must be stripped');
    assert.ok(!outEntries.includes('__MACOSX'), '__MACOSX inside uploaded zip must be stripped');

    // Baseline git init + diff works cleanly
    await GitService.initRepository(outDir);
    const baseCommit = await GitService.getHeadCommit(outDir);
    await fs.writeFile(path.join(outDir, 'hello.js'), 'console.log("v2");\n', 'utf8');
    const diff = await GitService.getGitDiff(outDir, baseCommit);
    assert.ok(diff.includes('+console.log("v2");'), 'Diff should capture edits on zip workspace');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function run() {
  await testTaskRegistryAndCancellation();
  await testClaudeCodeAbortSignal();
  await testGitHubPrValidation();
  testTaskRoutesRegistered();
  testGitHubOAuthServiceAndRoutes();
  await testPrivateTaskRoutesRequireAuth();
  await testPrepareWorkspaceCleansStaleFiles();
  await testReadOnlyModeAndCostGuardrails();
  await testZipExtractAndBaselineDiff();
  console.log('All feature, OAuth, private workspace, read-only, and zip archive tests passed.');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
