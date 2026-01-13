# AI Software Factory - Implementation Spec

## Overview

An autonomous AI development system that takes GitHub issues, converts them to specs, and produces PRs through iterative Claude Code execution.

**Core Philosophy:**
- Fresh context per iteration (state lives in files, not memory)
- Learnings persist across tasks and workers
- Single system handles any task size (1 commit or 50)
- Local-first, Docker-based, scales horizontally

---

## Phase 1: Project Scaffolding

- [x] Initialize Bun monorepo with `package.json` (workspaces config)
- [x] Configure Turborepo with `turbo.json`
- [x] Create root `tsconfig.json` with base TypeScript config
- [x] Create `.gitignore` for Node.js/TypeScript project
- [x] Create `.env.example` with all required environment variables

---

## Phase 2: Shared Package (`packages/shared`)

- [x] Create `packages/shared/package.json` with name `@factory/shared`
- [x] Create `packages/shared/tsconfig.json` extending root config
- [x] Create `packages/shared/src/types.ts` with all shared types:
  - WorkItem, WorkItemStatus, Priority
  - Worker, WorkerStatus
  - Learning
  - WorkerMetrics, FactoryMetrics
  - API request/response types (WorkerRegisterRequest, WorkerHeartbeatRequest, etc.)
- [x] Create `packages/shared/src/index.ts` exporting all types

---

## Phase 3: Database Schema

- [x] Create `migrations/` directory
- [x] Create `migrations/001_initial.sql` with:
  - pgvector extension
  - `work_items` table with all columns and constraints
  - `workers` table with all columns and constraints
  - `learnings` table with vector column and indexes
  - `worker_metrics` table
  - `file_locks` table
  - All necessary indexes

---

## Phase 4: Orchestrator Package (`packages/orchestrator`)

### 4.1 Setup
- [x] Create `packages/orchestrator/package.json` with name `@factory/orchestrator`
- [x] Create `packages/orchestrator/tsconfig.json`
- [x] Add dependencies: express, pg, ioredis, dockerode, uuid

### 4.2 Database & Redis Clients
- [x] Create `packages/orchestrator/src/db.ts` - PostgreSQL client wrapper
- [x] Create `packages/orchestrator/src/redis.ts` - Redis client wrapper

### 4.3 Core Components
- [x] Create `packages/orchestrator/src/queue.ts` - QueueManager class:
  - `add(input)` - add work item to queue
  - `get(id)` - get work item by ID
  - `getNext()` - get highest priority queued item (with row locking)
  - `cancel(id)` - cancel work item
  - `list()` - list active work items
  - `getStats()` - get queue statistics

- [x] Create `packages/orchestrator/src/rate-limits.ts` - RateLimiter class:
  - `canSpawnWorker()` - check if spawn allowed
  - `recordSpawn()` - record worker spawn
  - `recordWorkerDone()` - record worker completion
  - `recordIteration()` - record iteration for daily budget
  - `checkDailyReset()` - reset daily limits at midnight
  - `getStatus()` - get current rate limit status

- [x] Create `packages/orchestrator/src/conflicts.ts` - ConflictDetector class:
  - `acquireLocks(workerId, files)` - acquire file locks
  - `releaseLocks(workerId, files)` - release specific locks
  - `releaseAllLocks(workerId)` - release all locks for worker

- [x] Create `packages/orchestrator/src/workers.ts` - WorkerManager class:
  - `hasCapacity()` - check if can spawn
  - `spawn(workItem)` - spawn Docker container
  - `register(workItemId)` - worker self-registration
  - `heartbeat(workerId, data)` - update heartbeat
  - `complete(workerId, data)` - handle completion
  - `fail(workerId, error, iteration)` - handle failure
  - `stuck(workerId, reason, attempts)` - handle stuck state
  - `healthCheck()` - check for stale workers
  - `kill(workerId, reason)` - kill worker container
  - `list()` - list all workers
  - `getStats()` - get worker statistics

- [ ] Create `packages/orchestrator/src/metrics.ts` - MetricsCollector class:
  - `getSummary()` - get factory metrics summary
  - `getAll()` - get all metrics
  - `getLearnings(options)` - get learnings with optional filters

### 4.4 API Server
- [ ] Create `packages/orchestrator/src/server.ts` with Express app:
  - POST `/api/work` - add work item
  - GET `/api/work/:id` - get work item
  - POST `/api/work/:id/cancel` - cancel work item
  - POST `/api/worker/register` - worker registration
  - POST `/api/worker/:id/heartbeat` - worker heartbeat
  - POST `/api/worker/:id/lock` - request file locks
  - POST `/api/worker/:id/unlock` - release file locks
  - POST `/api/worker/:id/complete` - worker completed
  - POST `/api/worker/:id/fail` - worker failed
  - POST `/api/worker/:id/stuck` - worker stuck
  - GET `/api/status` - overall status
  - GET `/api/workers` - list workers
  - POST `/api/workers/:id/kill` - kill worker
  - GET `/api/queue` - queue contents
  - GET `/api/metrics` - metrics
  - GET `/api/learnings` - learnings

### 4.5 Entry Point
- [ ] Create `packages/orchestrator/src/index.ts`:
  - Initialize DB and Redis connections
  - Initialize all components
  - Start Express server
  - Run main loop (check capacity, spawn workers, health checks)

### 4.6 Dockerfile
- [ ] Create `packages/orchestrator/Dockerfile`

---

## Phase 5: Worker Package (`packages/worker`)

### 5.1 Setup
- [ ] Create `packages/worker/package.json` with name `@factory/worker`
- [ ] Create `packages/worker/tsconfig.json`

### 5.2 Orchestrator Client
- [ ] Create `packages/worker/src/client.ts` - OrchestratorClient class:
  - `heartbeat(data)` - send heartbeat
  - `lockFile(file)` - request file lock
  - `complete(data)` - report completion
  - `fail(data)` - report failure
  - `stuck(reason, attempts)` - report stuck
  - `getLearnings(repo, spec)` - get relevant learnings

### 5.3 Workspace Setup
- [ ] Create `packages/worker/src/setup.ts`:
  - `setupWorkspace(workItem)` - clone repo, create branch, write SPEC.md, copy Claude config

### 5.4 Learnings
- [ ] Create `packages/worker/src/learnings.ts`:
  - `loadLearnings(client, workItem)` - fetch and write learnings to `.ai/learnings.md`
  - `saveLearnings(workspace)` - parse `.ai/new-learnings.md` and return learnings

### 5.5 Ralph Event Parser
- [ ] Create `packages/worker/src/ralph.ts`:
  - `runRalph(workspace, workItem, client)` - spawn Ralph process
  - Parse `[RALPH:*]` events from stdout (see SPEC-ralph.md for event contract)
  - On `ITERATION` event → send heartbeat to orchestrator
  - On `FILE_EDIT` event → request file lock from orchestrator
  - On `STUCK` event → report stuck to orchestrator
  - On `COMPLETE` event → extract metrics for completion report
  - On `FAILED` event → report failure to orchestrator

### 5.6 Entry Point
- [ ] Create `packages/worker/src/index.ts`:
  - Parse environment variables (WORKER_ID, WORK_ITEM, ORCHESTRATOR_URL)
  - Setup workspace
  - Load learnings
  - Run Ralph
  - Extract new learnings
  - Create PR via `gh pr create`
  - Report completion

### 5.7 Claude Config
- [ ] Create `packages/worker/.claude/CLAUDE.md` with worker instructions
- [ ] Create `packages/worker/.claude/mcp.json` with MCP server config (playwright, context7)
- [ ] Create `packages/worker/.claude/settings.json` if needed

### 5.8 Dockerfile
- [ ] Create `packages/worker/Dockerfile`:
  - Install git, curl, gh CLI
  - Install Claude Code
  - Copy and build worker package
  - Copy Claude config

---

## Phase 6: Intake Package (`packages/intake`)

### 6.1 Setup
- [ ] Create `packages/intake/package.json` with name `@factory/intake`
- [ ] Create `packages/intake/tsconfig.json`
- [ ] Add dependencies: @octokit/rest, @anthropic-ai/sdk

### 6.2 GitHub Adapter
- [ ] Create `packages/intake/src/github.ts` - GitHubAdapter class:
  - `poll()` - poll repos for issues with intake label
  - `addLabel(issue, label)` - add label to issue
  - `removeLabel(issue, label)` - remove label from issue

### 6.3 Spec Generator
- [ ] Create `packages/intake/src/spec-gen.ts` - SpecGenerator class:
  - `generate(issue)` - convert GitHub issue to SPEC.md using Claude

### 6.4 Entry Point
- [ ] Create `packages/intake/src/index.ts`:
  - Poll GitHub for labeled issues
  - Generate spec from issue
  - Submit to orchestrator
  - Update issue labels

### 6.5 Dockerfile
- [ ] Create `packages/intake/Dockerfile`

---

## Phase 7: Docker Infrastructure

- [ ] Create `docker/` directory
- [ ] Create `docker/docker-compose.yml` with:
  - postgres (pgvector/pgvector:pg16)
  - redis (redis:7-alpine)
  - orchestrator service
  - intake service
  - dashboard service (placeholder)
  - Volumes for postgres_data and redis_data

---

## Phase 8: Scripts

- [ ] Create `scripts/` directory
- [ ] Create `scripts/setup.sh`:
  - Check prerequisites (docker, bun)
  - Create .env if not exists
  - Install dependencies
  - Build worker image
  - Start postgres and redis
  - Run migrations
- [ ] Create `scripts/migrate.sh` - run SQL migrations
- [ ] Create `scripts/dev.sh` - start dev environment
- [ ] Make all scripts executable

---

## Phase 9: Dashboard MVP (`packages/dashboard`)

### 9.1 Setup
- [ ] Create `packages/dashboard/package.json` with name `@factory/dashboard`
- [ ] Initialize Next.js 14+ app with App Router
- [ ] Configure for API proxy to orchestrator

### 9.2 Pages
- [ ] Create overview page (`app/page.tsx`) - factory status summary
- [ ] Create workers page (`app/workers/page.tsx`) - list workers, kill button
- [ ] Create queue page (`app/queue/page.tsx`) - list queue, cancel button
- [ ] Create learnings page (`app/learnings/page.tsx`) - browse learnings
- [ ] Create metrics page (`app/metrics/page.tsx`) - basic charts

### 9.3 Components
- [ ] Create status card component
- [ ] Create data table component
- [ ] Create navigation component

### 9.4 Dockerfile
- [ ] Create `packages/dashboard/Dockerfile`

---

## Phase 10: Integration & Testing

- [ ] Verify all packages build with `bun build`
- [ ] Test docker-compose up brings all services online
- [ ] Test end-to-end flow:
  - Create work item via API
  - Verify worker spawns
  - Verify heartbeats received
  - Verify completion/PR creation
- [ ] Document any issues in `.ai/new-learnings.md`

---

## Environment Variables Reference

```bash
# Required
GITHUB_TOKEN=           # GitHub PAT with repo permissions
REPOS=                  # Comma-separated: owner/repo1,owner/repo2

# Optional (with defaults)
DATABASE_URL=postgres://factory:factory@localhost:5432/factory
REDIS_URL=redis://localhost:6379
MAX_WORKERS=2           # Max concurrent workers
DAILY_BUDGET=200        # Max iterations per day
COOLDOWN_SECONDS=60     # Seconds between worker spawns
INTAKE_LABEL=ai-factory # GitHub label to watch
POLL_INTERVAL=60000     # GitHub poll interval (ms)
```

---

## Implementation Notes

1. **Ralph Integration**: Ralph must implement the event contract in SPEC-ralph.md. The worker parses `[RALPH:*]` events from stdout.

2. **Spec Generation**: User has existing spec generation. The intake spec-gen is a placeholder - integrate with existing system.

3. **Rate Limits**: Start conservative (2 workers, 200 iterations/day). Adjust based on Claude Max limits.

4. **Learnings**: Phase 1 uses basic text matching. Vector search (pgvector) is an enhancement.

5. **Error Handling**: Add proper try/catch and error responses throughout - the spec shows happy path.

---

## Related Specs

- **SPEC-ralph.md** - Ralph CLI implementation (autonomous Claude Code loop)
