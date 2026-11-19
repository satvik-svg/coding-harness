import assert from 'assert';
import {
  registerActiveTask,
  cancelActiveTask,
  isTaskCancelled,
  unregisterActiveTask,
} from '../src/jobs/taskRegistry';
import { runClaudeCode } from '../src/agent/claudeCodeRunner';
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
}

async function run() {
  await testTaskRegistryAndCancellation();
  await testClaudeCodeAbortSignal();
  await testGitHubPrValidation();
  testTaskRoutesRegistered();
  testGitHubOAuthServiceAndRoutes();
  console.log('All new feature + GitHub OAuth backend tests passed.');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
