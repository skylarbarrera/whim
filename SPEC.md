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

- [x] Setup package (package.json, tsconfig.json, dependencies: express, pg, ioredis, dockerode, uuid)

- [x] Create database and Redis clients
  - `src/db.ts` - PostgreSQL client wrapper
  - `src/redis.ts` - Redis client wrapper

- [x] Implement core components
  - `src/queue.ts` - QueueManager class (add, get, getNext, cancel, list, getStats)
  - `src/rate-limits.ts` - RateLimiter class (canSpawnWorker, recordSpawn, recordWorkerDone, recordIteration, checkDailyReset, getStatus)
  - `src/conflicts.ts` - ConflictDetector class (acquireLocks, releaseLocks, releaseAllLocks)
  - `src/workers.ts` - WorkerManager class (hasCapacity, spawn, register, heartbeat, complete, fail, stuck, healthCheck, kill, list, getStats)
  - `src/metrics.ts` - MetricsCollector class (getSummary, getAll, getLearnings)

- [x] Create API server (`src/server.ts`) with all endpoints:
  - Work items: POST /api/work, GET /api/work/:id, POST /api/work/:id/cancel
  - Worker lifecycle: POST /api/worker/register, POST /api/worker/:id/heartbeat, POST /api/worker/:id/complete, POST /api/worker/:id/fail, POST /api/worker/:id/stuck
  - File locks: POST /api/worker/:id/lock, POST /api/worker/:id/unlock
  - Admin: GET /api/status, GET /api/workers, POST /api/workers/:id/kill, GET /api/queue, GET /api/metrics, GET /api/learnings

- [x] Complete orchestrator package (entry point and Dockerfile)
  - `src/index.ts` - Initialize DB/Redis, init components, start server, run main loop (check capacity, spawn workers, health checks)
  - `Dockerfile` - Build and run orchestrator

---

## Phase 5: Worker Package (`packages/worker`)

- [x] Implement worker package core
  - `package.json` with name `@factory/worker`
  - `tsconfig.json`
  - `src/client.ts` - OrchestratorClient class (heartbeat, lockFile, complete, fail, stuck, getLearnings)
  - `src/setup.ts` - setupWorkspace(workItem): clone repo, create branch, write SPEC.md, copy Claude config
  - `src/learnings.ts` - loadLearnings (fetch → `.ai/learnings.md`), saveLearnings (parse `.ai/new-learnings.md`)
  - `src/ralph.ts` - runRalph spawns Ralph, parses events (ITERATION→heartbeat, FILE_EDIT→lock, STUCK→report, COMPLETE→metrics, FAILED→report)
  - `src/index.ts` - Parse env vars, setup workspace, load learnings, run Ralph, extract learnings, create PR, report completion

- [x] Worker package config and Dockerfile
  - `.claude/CLAUDE.md` - Worker instructions
  - `.claude/mcp.json` - MCP server config (playwright, context7)
  - `.claude/settings.json` - If needed
  - `Dockerfile` - Install git, curl, gh CLI, Claude Code; copy and build worker; copy Claude config

---

## Phase 6: Intake Package (`packages/intake`)

- [x] Implement intake package
  - `package.json` with name `@factory/intake`
  - `tsconfig.json`
  - Dependencies: @octokit/rest, @anthropic-ai/sdk
  - `src/github.ts` - GitHubAdapter class (poll, addLabel, removeLabel)
  - `src/spec-gen.ts` - SpecGenerator class (generate: issue → SPEC.md using Claude)
  - `src/index.ts` - Poll GitHub, generate spec, submit to orchestrator, update labels
  - `Dockerfile`

---

## Phase 7: Docker Infrastructure

- [x] Create Docker infrastructure
  - `docker/` directory
  - `docker/docker-compose.yml` with:
    - postgres (pgvector/pgvector:pg16)
    - redis (redis:7-alpine)
    - orchestrator service
    - intake service
    - dashboard service (placeholder)
    - Volumes for postgres_data and redis_data

---

## Phase 8: Scripts

- [x] Create setup and dev scripts
  - `scripts/setup.sh` - Check prerequisites (docker, bun), create .env, install deps, build worker image, start postgres/redis, run migrations
  - `scripts/migrate.sh` - Run SQL migrations
  - `scripts/dev.sh` - Start dev environment
  - Make all scripts executable

---

## Phase 9: Dashboard MVP (`packages/dashboard`)

- [x] Setup dashboard package
  - `package.json` with name `@factory/dashboard`
  - Initialize Next.js 14+ with App Router
  - Configure API proxy to orchestrator
  - `Dockerfile`

- [x] Implement dashboard pages and components
  - `app/page.tsx` - Overview/factory status summary
  - `app/workers/page.tsx` - List workers, kill button
  - `app/queue/page.tsx` - List queue, cancel button
  - `app/learnings/page.tsx` - Browse learnings
  - `app/metrics/page.tsx` - Basic charts
  - Shared components: status card, data table, navigation

---

## Phase 10: Integration & Testing

- [ ] Integration testing and validation
  - Verify all packages build with `bun build`
  - Test docker-compose up brings all services online
  - Test end-to-end: create work item → worker spawns → heartbeats → PR created
  - Document issues in `.ai/new-learnings.md`

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
