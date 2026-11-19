# Coding Harness

An autonomous AI software engineering platform and sandbox execution engine. Coding Harness accepts a Git repository (or archive) and a natural-language instruction, clones the codebase into an isolated workspace, executes an AI coding agent with real-time telemetry streaming, and produces a reviewable unified/split Git diff that can be pushed directly to GitHub as a Pull Request.

**Live Deployment:** [Open Coding Harness Demo](https://codingharness.136-64-150-85.sslip.io/?key=a2824b836ec9132861afaf537dcc1c9e)

_(The first visit sets an access cookie via Nginx and redirects to the clean URL `https://codingharness.136-64-150-85.sslip.io/`. Create an account via **Sign in** to initialize a private workspace, and optionally click **Connect GitHub** for one-click repository selection and Pull Request creation.)_

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Monorepo Structure & Tech Stack](#monorepo-structure--tech-stack)
3. [AI Agent & Execution Engine](#ai-agent--execution-engine)
4. [Queueing, Streaming & Cancellation](#queueing-streaming--cancellation)
5. [Security, Private Workspaces & GitHub Automation](#security-private-workspaces--github-automation)
6. [Frontend Architecture & UX Capabilities](#frontend-architecture--ux-capabilities)
7. [DevOps, GCP Infrastructure & AI Gateway](#devops-gcp-infrastructure--ai-gateway)
8. [Database Schema](#database-schema)
9. [API & WebSocket Reference](#api--websocket-reference)
10. [Local Development & Testing](#local-development--testing)

---

## System Architecture

```text
+-----------------------------------------------------------------------------+
|                           Client Browser (Next.js UI)                       |
|  Chat Composer (Code / Read only) | Timeline & Console | Split Diff | PR UI |
+----------------------+---------------------------------+--------------------+
                       | HTTPS (REST + Cookie Gate)      | WSS (Socket.IO)
                       v                                 v
+-----------------------------------------------------------------------------+
|                    Nginx Reverse Proxy (TLS + Cookie Gate)                  |
|   / -> 127.0.0.1:3000    /api/* & /health -> :4000    /socket.io/ -> :4000  |
+----------------------+---------------------------------+--------------------+
                       |                                 |
                       v                                 v
          +-------------------------+       +---------------------------------+
          | Next.js Frontend (:3000)|       | Express + Socket.IO API (:4000) |
          |  Pages Router, React 18 |       |  JWT Auth, Rate Limit, Routes   |
          +-------------------------+       +--------+---------------+--------+
                                                     |               |
                         +---------------------------+               |
                         v                                           v
          +-----------------------------+               +-----------------------+
          |     PostgreSQL (:5432)      |               |     Redis (:6379)     |
          |  Users, Tasks, Sessions     |               |  BullMQ TaskQueue     |
          +--------------+--------------+               +-----------+-----------+
                         ^                                          |
                         | Persists logs, diffs, summaries          v
          +--------------+------------------------------------------+-----------+
          |                   BullMQ Background Task Worker                     |
          |  Workspace Prep -> Git Clone -> Agent Runner -> Diff Capture        |
          +-----------------+--------------------------------+------------------+
                            |                                |
           Mode A (GCP VM)  |                                | Mode B (Local/Prod)
                            v                                v
          +------------------------------------+   +----------------------------+
          |   Claude Code CLI (Subprocess)     |   | Built-in OpenAI AgentLoop  |
          |   Sanitized Env, stream-json       |   | 6 Tools + Docker Sandbox   |
          +-----------------+------------------+   +----------------------------+
                            | Anthropic Messages API (127.0.0.1:4010)
                            v
          +------------------------------------+
          |  LiteLLM Compatibility Gateway     |
          |  vertex_ai/gemini-4-hydrogen       |
          |  (fallback: gemini-3.5-flash)      |
          +-----------------+------------------+
                            | GCP VM Service Account (OAuth2 Metadata Token)
                            v
          +------------------------------------+
          |      Google Cloud Vertex AI        |
          |     (Global Endpoint, 1M ctx)      |
          +------------------------------------+
```

### End-to-End Task Lifecycle

1. **Authentication & Submission:** An authenticated user submits a GitHub repository URL (or `.zip` archive in non-demo mode), optional branch, execution mode (`edit` or `read`), and prompt via `POST /api/tasks`.
2. **Persistence & Dispatch:** Express validates the payload, creates a `Task` row (`PENDING`) strictly bound to `userId`, and enqueues a job in Redis via BullMQ (`jobId = task.id`).
3. **Workspace Preparation:** The BullMQ worker wipes any stale directory for `taskId` (preventing clone collisions on stalled job retries), prepares a fresh directory, clones the repository (or extracts and initializes Git on an archive), and records the base commit SHA (`HEAD`).
4. **Agent Execution & Live Streaming:** The worker runs either the Claude Code CLI runner or the built-in OpenAI function-calling loop. Every reasoning message, tool call, tool output, and status change is broadcast immediately to the task's Socket.IO room (`task:<taskId>`) and persisted to the `Session` record in PostgreSQL.
5. **Diff Capture & Review:** Upon completion (and even on partial failure such as hitting turn or budget limits), `GitService.getGitDiff` stages untracked files with `git add --intent-to-add --all` and computes a binary-safe unified diff against the base commit.
6. **Pull Request Automation:** From the Diff Viewer, the user clicks **Open PR**. The backend decrypts the user's sealed GitHub OAuth session (or uses an optional PAT), shallow-clones the base branch into a temporary directory, applies the patch cleanly, commits, pushes a new feature branch (`coding-harness/<shortId>`), and opens a Pull Request via the GitHub REST API.

---

## Monorepo Structure & Tech Stack

Managed via npm workspaces (`package.json`):

```text
coding_harness/
├── shared/                     # Shared TypeScript enums, domain models, and API contracts
│   └── src/index.ts
├── backend/                    # Express REST API, Socket.IO server, BullMQ worker, AI runners
│   ├── prisma/                 # PostgreSQL schema and SQL migrations
│   ├── src/
│   │   ├── agent/              # claudeCodeRunner.ts, agentLoop.ts, llmClient.ts, prompts.ts
│   │   ├── config/             # Environment configuration loader
│   │   ├── controllers/        # authController, githubAuthController, taskController, health
│   │   ├── db/                 # Prisma client and DB health probes
│   │   ├── jobs/               # queue.ts (BullMQ), taskWorker.ts, taskRegistry.ts (cancel)
│   │   ├── middlewares/        # JWT auth, rateLimiter, errorHandler, requestLogger
│   │   ├── routes/             # Express route definitions
│   │   ├── sandbox/            # Dockerode container lifecycle manager and resource limits
│   │   ├── services/           # gitService, githubOAuthService, githubPrService, projectCost
│   │   ├── tools/              # 6 agent tools (view, write, replace, list, grep, command)
│   │   └── websocket/          # Socket.IO server and room emitters
│   └── tests/                  # Unit, API, demo runner, cost, and feature test suites
├── frontend/                   # Next.js 14 web workspace
│   ├── public/favicon.svg      # Custom geometric SVG favicon
│   └── src/
│       ├── components/         # TaskForm, ExecutionInspector, DiffViewer, CommandPalette, etc.
│       ├── contexts/           # AuthContext (JWT + GitHub OAuth), ToastContext
│       ├── pages/              # Dashboard (index.tsx) and live session view (tasks/[id].tsx)
│       └── services/           # Typed REST API client and Socket.IO client
├── deployment/gcp-demo/        # GCP VM setup script, LiteLLM config, systemd units, Nginx, SQL
├── .github/workflows/ci.yml    # GitHub Actions CI (Prettier, TypeScript build, backend tests)
├── docker-compose.yml          # Local PostgreSQL 16 + Redis 7 services
└── docker-compose.prod.yml     # Full containerized production stack
```

| Layer                | Technologies                                                                                  |
| :------------------- | :-------------------------------------------------------------------------------------------- |
| **Language**         | TypeScript 5.6 across `shared`, `backend`, and `frontend`                                     |
| **Frontend**         | Next.js 14 (Pages Router), React 18, Tailwind CSS 3, Lucide Icons, Socket.IO Client           |
| **Backend API**      | Node.js 22, Express 4, Helmet, CORS, Express Rate Limit, Winston, Multer                      |
| **Database & ORM**   | PostgreSQL 16, Prisma 5 (`User`, `Task`, `Session`, `TaskStatus`)                             |
| **Queue & Realtime** | Redis 7, BullMQ 6, IORedis 6, Socket.IO 4                                                     |
| **AI & Sandbox**     | Claude Code CLI, LiteLLM Proxy, Google Vertex AI (`gemini-4-hydrogen`), OpenAI SDK, Dockerode |
| **Git & GitHub**     | `simple-git`, native `git` CLI (`apply`, `push`), GitHub OAuth 2.0 & REST API v2022-11-28     |

---

## AI Agent & Execution Engine

Coding Harness supports two pluggable execution engines controlled by `AI_PROVIDER`:

### 1. Claude Code CLI Runner (`AI_PROVIDER=claude-code`)

Implemented in `backend/src/agent/claudeCodeRunner.ts`. This is the primary production runtime on the GCP deployment:

- **Subprocess Environment Sanitization (`buildClaudeEnv`):** Before spawning the `claude` CLI inside a target repository, the runner strips 20+ sensitive backend environment variables (`DATABASE_URL`, `JWT_SECRET`, `GITHUB_CLIENT_SECRET`, `LITELLM_MASTER_KEY`, `REDIS_PASSWORD`, `OPENAI_API_KEY`, etc.) as well as `NODE_ENV` and `npm_config_production` (ensuring target repos install `devDependencies` such as Jest, ESLint, and TypeScript when needed).
- **Streaming JSON Event Parser:** Launches `claude -p --verbose --output-format stream-json` in a detached process group and parses newline-delimited JSON events (`assistant` text, `tool_use`, `user` `tool_result`, and final `result`) in real time.
- **Dual Execution Modes (`Code` vs `Read only`):**
  - **`edit` (Code mode):** Full autonomous editing and test execution. Appends `HARNESS_SYSTEM_PROMPT`, which instructs the agent to batch file reads, avoid unnecessary package installs, stop immediately once the requested fix and tests pass (avoiding wasted turns on unrelated deprecation warnings), and leave changes uncommitted for Coding Harness to diff.
  - **`read` (Read only mode):** Enforces zero mutations at the CLI layer by passing `--disallowedTools Write,Edit,NotebookEdit,Bash`, appending `READ_ONLY_SYSTEM_PROMPT`, and capping turns at `15`. Ideal for fast, low-cost codebase audits, bug discovery, and architectural Q&A.
- **Cost & Turn Guardrails:** Enforces `--max-turns` (default `30` in edit mode, `15` in read-only mode), `--max-budget-usd` (default `15.00`, calibrated to account for Claude Code's fallback pricing table when routing to non-Claude Vertex models), and a hard wall-clock timeout (`CLAUDE_CODE_TIMEOUT_MS`, default `900000` ms).
- **Partial Diff Preservation:** If a run exceeds turn or budget limits after making code modifications, `taskWorker.ts` still captures and persists the working-tree Git diff instead of discarding completed edits.

### 2. Built-In AgentLoop + Docker Sandbox (`AI_PROVIDER=openai` or `mock`)

Implemented in `backend/src/agent/agentLoop.ts`, `backend/src/tools/`, and `backend/src/sandbox/dockerManager.ts`:

- Executes an OpenAI-compatible function-calling loop (`Analyze -> Plan -> Tool Call -> Verify -> Fix -> Diff`).
- Exposes 6 registered tools via `ToolRegistry`: `view_file`, `write_file`, `replace_file_content`, `list_dir`, `grep_search`, and `run_command` (in `read` mode, write and command tools are filtered out before dispatch).
- When a local Docker daemon is reachable, `DockerManager` provisions an isolated container per task with enforced memory and CPU limits (`SANDBOX_MEMORY_LIMIT`, `SANDBOX_NANOCPUS`), executes commands inside the container, and guarantees cleanup in a `finally` block.
- Automatically feeds non-zero command exit codes (`stdout`/`stderr`) back into the conversation loop so the agent can self-correct failing tests.

---

## Queueing, Streaming & Cancellation

- **BullMQ Worker (`backend/src/jobs/taskWorker.ts`):** Processes jobs asynchronously from Redis (`TaskQueue`) with tuned stall protection (`lockDuration: 120000`, `stalledInterval: 60000`) so heavy test runs or builds do not trigger false stall retries.
- **Stale Workspace Recovery (`backend/src/services/gitService.ts`):** `GitService.prepareWorkspace(taskId)` removes any pre-existing directory before creating a clean workspace, guaranteeing safe retries if a worker restarts mid-job.
- **In-Flight Task Cancellation (`backend/src/jobs/taskRegistry.ts`):**
  - Each active task registers an `AbortController`, cancel callbacks, and optional `containerId`.
  - Calling `POST /api/tasks/:id/cancel` removes queued BullMQ jobs via `removeQueuedJob`, aborts the active `AbortSignal`, sends `SIGKILL` to the entire detached child process group (`process.kill(-child.pid, 'SIGKILL')`), stops and removes any Docker sandbox container, persists `TaskStatus.CANCELLED`, and emits a live WebSocket status update.
- **Real-Time Socket.IO Streaming (`backend/src/websocket/socketServer.ts`):** Clients join `task:<taskId>` rooms and receive `task:log`, `task:status`, `task:step`, and `task:diff` events over WebSockets with polling fallback.
- **Multi-Attempt Session History:** Because `Task` has a one-to-many relationship with `Session`, retries preserve every prior attempt's logs, timestamps, summary, and diff. The UI exposes a **Run attempts** switcher whenever a task has multiple sessions.

---

## Security, Private Workspaces & GitHub Automation

### Private Per-User Isolation

- All `/api/tasks*` routes require JWT authentication (`authenticate` middleware in `backend/src/routes/taskRoutes.ts`). Unauthenticated requests return `401 Unauthorized`.
- Passwords are hashed with `bcryptjs` and sessions use signed JWTs (`7d` default expiry).
- Every task query (`listTasks`, `getTaskAnalytics`, `getTaskById`, `getTaskDiff`, `cancelTask`, `retryTask`, `createPullRequest`) enforces `where: { id, userId }` so users can only view or act on their own tasks.

### GitHub OAuth 2.0 with AES-256-GCM Sealed Sessions

Implemented in `backend/src/services/githubOAuthService.ts` and `backend/src/controllers/githubAuthController.ts`:

- **CSRF Protection:** `GET /api/auth/github/start` signs a 10-minute JWT `state` containing a random 16-byte nonce, validated return path (sanitizing open redirects), and verified origin.
- **Zero Plaintext Tokens in the Browser:** On callback (`GET /api/auth/github/callback`), the backend exchanges the authorization code for a GitHub access token, fetches the GitHub profile, and encrypts `{ accessToken, login, name, avatarUrl }` using **AES-256-GCM** (random 12-byte IV + 16-byte authentication tag, key derived via SHA-256 from `JWT_SECRET`).
- **Hash Fragment Delivery:** The sealed session token is returned via URL fragment (`#gh_session=...`), which is never sent in HTTP requests or access logs; the frontend reads it on mount, strips the hash via `history.replaceState`, and transmits it via the `X-GitHub-Session` header.

### Automated Branch Push & Pull Request Creation

Implemented in `backend/src/services/githubPrService.ts`:

- Accepts either the decrypted `X-GitHub-Session` OAuth token or a manual GitHub Personal Access Token.
- Resolves the repository's default branch via the GitHub API (`GET /repos/:owner/:repo`) unless overridden.
- Creates a temporary directory in `os.tmpdir()`, performs a shallow clone (`--depth 1`) using `http.https://github.com/.extraheader` Basic auth (keeping tokens out of remote URLs and `.git/config`), creates the feature branch (`coding-harness/<shortId>`), applies the stored diff (`git apply --whitespace=nowarn`), commits, pushes, and opens a PR via `POST /repos/:owner/:repo/pulls`.
- Redacts any credential substring from Git error output and removes the temporary directory in a `finally` block.

### Proxy-Aware Rate Limiting

- `app.set('trust proxy', 1)` in `backend/src/app.ts` ensures Express resolves real client IPs from Nginx `X-Forwarded-For` headers instead of grouping all users under `127.0.0.1`.
- Separate limiters protect general API endpoints (`1000 req / 15 min`, exempting lightweight health/cost/auth paths), authentication endpoints (`30 attempts / 15 min`), and task submissions (`20 tasks / 15 min`).

---

## Frontend Architecture & UX Capabilities

Built in Next.js 14 with a monochrome obsidian (`#09090b`) and single cobalt-blue (`#2563EB`) design system and custom geometric SVG branding (`LogoMark.tsx`, `public/favicon.svg`):

- **Unified Chat Composer (`TaskForm.tsx`):** Combines repository input (with a one-click **My repos** GitHub dropdown when connected via OAuth), branch selector, prompt textarea with `Cmd/Ctrl + Enter` submission, quick-start prompt chips, and the **`Code` | `Read only`** mode toggle.
- **Interactive Execution Inspector (`ExecutionInspector.tsx` & `LiveTerminal.tsx`):** Provides a **Timeline | Console** switcher. The Timeline parser converts both structured `AgentStepLog` events and raw Claude Code tool logs (`Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`) into collapsible cards with expandable command outputs, category filters (`All`, `Tools`, `Tests`, `Errors`), and automatic **`PASS`** / **`FAIL`** test detection badges.
- **Upgraded Diff Viewer (`DiffViewer.tsx`):** Parses unified Git patches into structured file entries with status badges (`A`, `M`, `D`, `R`), per-file `+N / -N` counts, a toggleable **Changed Files** sidebar, per-file collapse, **Unified | Split** (side-by-side) diff rendering, `.patch` download, and the **Open PR** modal (auto-closing on success and converting the toolbar button into a direct **`PR #N`** link).
- **Live Session Controls (`tasks/[id].tsx`, `AgentStateCard.tsx`, `TaskResult.tsx`):** Includes a live ticking elapsed timer (`00:00`), **Stop agent** cancellation, one-click **Retry**, **Edit & re-run** modal, multi-attempt **Run attempts** switcher, and a threaded User/Agent markdown summary view.
- **Workspace Productivity (`AnalyticsBar.tsx`, `CommandPalette.tsx`, `ToastContext.tsx`):**
  - Dashboard KPI cards for Success Rate, Avg Runtime, Lines Changed, and Estimated Session Cost.
  - Global `Cmd+K` / `Ctrl+K` Command Palette for keyboard navigation across recent tasks and workspace actions.
  - Slide-in toast notifications and optional Web Notification API desktop alerts when background tasks complete or fail.
  - Visibility-aware dashboard polling (`15s` active interval, paused automatically when the browser tab is hidden).

---

## DevOps, GCP Infrastructure & AI Gateway

The live production demo runs on **Google Cloud Platform (GCP)** using an automated, single-VM architecture defined in `deployment/gcp-demo/`.

### 1. GCP Project & Compute Engine Topology

| Resource                  | Configuration                                            | Purpose                                                                                                                                                                                     |
| :------------------------ | :------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **GCP Project**           | `coding-harness-demo-20261119`                           | Isolated project boundary so deleting the project cleanly tears down all infrastructure and billing                                                                                         |
| **Compute Engine VM**     | `coding-harness-demo` (`us-central1-a`)                  | Single Debian 12 Linux host running the complete application, database, queue, proxy, and AI gateway                                                                                        |
| **Machine Type**          | `e2-medium` (2 vCPUs, 3.8 GiB RAM)                       | Upgraded from `e2-micro` (1 GB) to prevent swap thrashing and OOM kills during `npm install` and test suites on multi-stack repositories                                                    |
| **Storage & Swap**        | 20 GB standard persistent disk + 3 GB `/swapfile`        | Disk storage for Postgres, Redis, workspaces, and builds, plus swap headroom for peak compilation                                                                                           |
| **Networking & IP**       | Static regional IP `136.64.150.85` (`coding-harness-ip`) | Reserved IP mapped via `sslip.io` (`codingharness.136-64-150-85.sslip.io`) with HTTPS TLS termination so VM stops and resizes never break the domain, certificate, or GitHub OAuth callback |
| **IAM & Service Account** | Least-privilege VM service account                       | Scoped exclusively to Vertex AI inference (no broad project owner permissions, no static Google API keys stored on disk)                                                                    |
| **OS Isolation**          | Unprivileged `harness` system user                       | All three app services and Claude Code run as `harness` with data isolated in `/var/lib/coding-harness` and secrets restricted to `chmod 600` in `/etc/coding-harness*.env`                 |

### 2. Vertex AI & LiteLLM Compatibility Gateway

Claude Code speaks the Anthropic Messages API, while inference runs on **Google Cloud Vertex AI**. To bridge the two cleanly without managing external provider keys:

1. **LiteLLM Proxy (`coding-harness-gateway.service`):** Runs inside an isolated Python virtual environment (`/opt/coding-harness-litellm`) bound strictly to `127.0.0.1:4010` using `deployment/gcp-demo/litellm.yaml`:
   ```yaml
   model_list:
     - model_name: gemini-4-hydrogen
       litellm_params:
         model: vertex_ai/gemini-4-hydrogen
         vertex_project: os.environ/VERTEXAI_PROJECT
         vertex_location: global
     - model_name: gemini-3.5-flash
       litellm_params:
         model: vertex_ai/gemini-3.5-flash
         vertex_project: os.environ/VERTEXAI_PROJECT
         vertex_location: global
   litellm_settings:
     drop_params: true
   ```
2. **Zero Static Cloud API Keys:** LiteLLM uses `google-auth` Application Default Credentials (ADC) to fetch short-lived OAuth2 tokens directly from the GCP Compute Engine metadata server (`http://metadata.google.internal`).
3. **Local Gateway Authentication:** Communication between the backend/Claude Code and LiteLLM on `127.0.0.1:4010` is authenticated via a randomly generated 24-byte `LITELLM_MASTER_KEY` created during provisioning.
4. **Model Selection & Cost Optimization:**
   - Default model: **`vertex_ai/gemini-4-hydrogen`** (`$1.50 / 1M` input, `$7.50 / 1M` output including thinking tokens, `$0.075 / 1M` cached input read, 1M context window).
   - Compared to `gemini-3.5-flash` (`$9.00 / 1M` output, `$0.15 / 1M` cached read), `gemini-4-hydrogen` reduces output cost by ~17% and cached read cost by 50%, which is critical for multi-turn agentic loops where the conversation prefix is re-sent on every turn.
   - `drop_params: true` ensures Anthropic-specific request fields that Vertex AI does not support are cleanly stripped rather than causing `400` errors.

### 3. Nginx Reverse Proxy & Cookie Access Gate

Nginx fronts the VM and routes all traffic to localhost-bound services:

- `/` -> `http://127.0.0.1:3000` (Next.js frontend)
- `/api/` and `/health` -> `http://127.0.0.1:4000` (Express backend, forwarding `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Host` for rate limiting and GitHub OAuth callback resolution)
- `/socket.io/` -> `http://127.0.0.1:4000` (HTTP/1.1 `Upgrade` / `Connection` headers with `proxy_read_timeout 3600s` for long-running live streams)

**Why a Cookie Gate Instead of HTTP Basic Auth:**
Because Coding Harness's user authentication transmits JWTs via the `Authorization: Bearer <token>` header, standard Nginx HTTP Basic Auth conflicts with the same `Authorization` header and rejects authenticated API calls with `401`. To protect the public demo URL without breaking app login, WebSockets, or GitHub OAuth redirects, Nginx validates an access cookie set on the first visit to `/?key=<access-key>` and returns `403` for unauthenticated external requests without the cookie.

### 4. Systemd Service Architecture & Provisioning

Six managed services run on the VM:

- `postgresql.service` (PostgreSQL 16 on `127.0.0.1:5432`)
- `redis-server.service` (Redis 7 on `127.0.0.1:6379`)
- `coding-harness-gateway.service` (LiteLLM proxy on `127.0.0.1:4010`, `UnsetEnvironment=DATABASE_URL`)
- `coding-harness-backend.service` (Node.js 22 Express + BullMQ + Socket.IO on `127.0.0.1:4000`, `After=postgresql redis-server coding-harness-gateway`)
- `coding-harness-frontend.service` (Next.js production server on `127.0.0.1:3000`, `After=coding-harness-backend`)
- `nginx.service` (TLS termination, cookie gate, reverse proxy)

Initial provisioning is automated via `deployment/gcp-demo/setup.sh`, which installs Node.js 22.19.0 (with SHA-256 checksum verification), PostgreSQL, Redis, Nginx, Python venv + LiteLLM, the native Claude Code binary under `/var/lib/coding-harness/.local/bin/claude`, generates random secrets (`chmod 600`), builds all workspaces, runs `npx prisma migrate deploy`, and enables all systemd units.

### 5. BigQuery Billing Export & Project Cost Telemetry

Coding Harness includes optional live GCP project cost reporting (`backend/src/services/projectCost.ts` and `deployment/gcp-demo/project-cost.sql`):

- Calls the GCP metadata server for a short-lived access token and invokes a fixed, no-argument BigQuery stored procedure (`CALL <project>.billing_dashboard.project_cost()`).
- Caches successful responses for 60 minutes (5 minutes on failure) with request coalescing (`inFlight` deduplication) and graceful fallback to `status: "unavailable"` when account-wide BigQuery billing export is not enabled.

### 6. Continuous Integration & Containerized Deployments

- **GitHub Actions CI (`.github/workflows/ci.yml`):** Runs on every push and pull request to `main`: installs dependencies with `npm ci`, checks Prettier formatting, builds `shared`, `backend`, and `frontend`, and executes the backend test suite in `AI_PROVIDER=mock` mode.
- **Docker Compose (`docker-compose.yml` & `docker-compose.prod.yml`):** Provides one-command local PostgreSQL + Redis setup as well as multi-stage Dockerfiles (`Dockerfile.backend`, `Dockerfile.frontend`) and a root `nginx.conf` for containerized deployments.

### 7. Deployment Cost & Operations Runbook

**Estimated Running Cost (`us-central1`, 24/7):**

- `e2-medium` VM: `$0.0335/hr` (~`$24.45/mo`)
- Static external IP (in use): `$0.005/hr` (~`$3.65/mo`)
- 20 GB standard disk: ~`$0.80/mo`
- **Total infrastructure:** ~~`$0.95/day` (~~`$29/mo`) while running, plus pay-as-you-go Vertex AI token usage (typically cents per task). Stopping the VM reduces compute charges to zero while retaining disk and static IP (~`$0.27/day`). Deleting the GCP project stops all billing completely.

**Redeploy Latest `main` on the VM:**

```bash
export PATH="/opt/coding-harness-node/bin:$PATH"
cd /opt/coding-harness
git fetch origin && git reset --hard origin/main
npm ci
npm run build:shared
npm run db:generate
npm run build:backend
NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_API_URL="" NEXT_PUBLIC_WS_URL="" NEXT_PUBLIC_DEMO_MODE=true npm run build:frontend
set -a && source /etc/coding-harness.env && set +a
cd /opt/coding-harness/backend && npx prisma migrate deploy
sudo systemctl restart coding-harness-gateway coding-harness-backend coding-harness-frontend
```

**Teardown Commands:**

```bash
# Pause compute charges (keeps disk and IP)
gcloud compute instances stop coding-harness-demo \
  --project=coding-harness-demo-20261119 --zone=us-central1-a

# Delete all resources and stop all billing permanently
gcloud projects delete coding-harness-demo-20261119
```

---

## Database Schema

Defined in `backend/prisma/schema.prisma` (PostgreSQL):

- **`User` (`users`):** `id` (UUID), `email` (unique), `passwordHash`, `createdAt`, `updatedAt`, relation `tasks: Task[]`.
- **`Task` (`tasks`):** `id` (UUID), `userId` (FK to `User`, `onDelete: SetNull`), `repoUrl`, `status` (`PENDING | RUNNING | COMPLETED | FAILED | CANCELLED`), `prompt` (`TEXT`), `createdAt`, `updatedAt`, relation `sessions: Session[]`.
- **`Session` (`sessions`):** `id` (UUID), `taskId` (FK to `Task`, `onDelete: Cascade`), `logs` (`TEXT`), `resultDiff` (`TEXT?`), `resultSummary` (`TEXT?`), `startedAt`, `finishedAt`.

---

## API & WebSocket Reference

### REST Endpoints

| Method | Endpoint                    | Auth                        | Description                                                                      |
| :----- | :-------------------------- | :-------------------------- | :------------------------------------------------------------------------------- |
| `GET`  | `/health`, `/api/health`    | Public                      | Backend uptime, memory usage, PostgreSQL, Redis, and Docker connectivity         |
| `GET`  | `/api/project-cost`         | Public                      | Cached BigQuery GCP project cost status                                          |
| `POST` | `/api/auth/register`        | Public                      | Register a new user account and return a JWT                                     |
| `POST` | `/api/auth/login`           | Public                      | Authenticate user credentials and return a JWT                                   |
| `GET`  | `/api/auth/me`              | JWT                         | Fetch current authenticated user profile                                         |
| `GET`  | `/api/auth/github/status`   | Optional `X-GitHub-Session` | Check server OAuth configuration and connected GitHub profile                    |
| `GET`  | `/api/auth/github/start`    | Public                      | Start GitHub OAuth 2.0 flow with signed CSRF state                               |
| `GET`  | `/api/auth/github/callback` | Public                      | Exchange OAuth code, seal token with AES-256-GCM, redirect to UI                 |
| `GET`  | `/api/auth/github/repos`    | `X-GitHub-Session`          | List the connected user's 30 most recently updated GitHub repositories           |
| `POST` | `/api/tasks`                | JWT                         | Create and enqueue a task (`repoUrl` or `.zip`, `prompt`, `branch`, `mode`)      |
| `GET`  | `/api/tasks`                | JWT                         | List authenticated user's tasks with pagination and `status` filter              |
| `GET`  | `/api/tasks/analytics`      | JWT                         | Aggregated success rate, avg runtime, lines changed, and cost estimate           |
| `GET`  | `/api/tasks/:id`            | JWT (owner)                 | Fetch task details and all execution `sessions` ordered newest first             |
| `GET`  | `/api/tasks/:id/diff`       | JWT (owner)                 | Fetch latest unified Git diff                                                    |
| `POST` | `/api/tasks/:id/cancel`     | JWT (owner)                 | Cancel queued job or terminate active process/container (`CANCELLED`)            |
| `POST` | `/api/tasks/:id/retry`      | JWT (owner)                 | Queue a new task reusing `repoUrl` with optional `prompt` and `branch` overrides |
| `POST` | `/api/tasks/:id/pr`         | JWT (owner) + GitHub        | Apply stored diff to a new branch, push to GitHub, and open a Pull Request       |

### WebSocket Events (Socket.IO)

- **Client -> Server:** `join:task` (`taskId`), `leave:task` (`taskId`)
- **Server -> Client:** `joined:task`, `task:log`, `task:status`, `task:step`, `task:diff`

---

## Local Development & Testing

### Prerequisites

- Node.js 20+ (22 recommended)
- Docker (for local PostgreSQL + Redis and optional agent sandboxing)

### Setup & Run

```bash
# 1. Start PostgreSQL and Redis
npm run docker:up

# 2. Install workspace dependencies
npm install

# 3. Build shared types and generate Prisma client
npm run build:shared
npm run db:generate
npm run db:migrate

# 4. Configure backend/.env (gitignored)
# Set AI_PROVIDER (openai | claude-code | mock), OPENAI_API_KEY (if openai),
# and optionally GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_CALLBACK_URL, FRONTEND_URL.

# 5. Start backend (:4000) and frontend (:3000) in separate terminals
npm run dev:backend
npm run dev:frontend
```

### Build & Test Commands

```bash
# Full monorepo production build (shared + backend + frontend)
npm run build

# Code formatting check
npm run format:check

# Run full backend diagnostic suite
npm run test:backend

# Run targeted test suites
npx tsx backend/tests/demo.test.ts
npx tsx backend/tests/projectCost.test.ts
npx tsx backend/tests/features.test.ts
```
