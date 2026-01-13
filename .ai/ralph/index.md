# Ralph Session Index

## Session 1 - 2025-01-12

### Task: Phase 1 - Project Scaffolding

**Commit:** 80a1e51

**Files Created/Modified:**
- `package.json` - Added packageManager field for Bun
- `turbo.json` - Turborepo configuration with build/dev/test/lint/typecheck/clean tasks
- `tsconfig.json` - Base TypeScript config with strict mode, ES2022 target
- `.gitignore` - Added Turbo and Bun entries
- `.env.example` - All environment variables from SPEC.md

**Notes:**
- Bun monorepo configured with workspaces: ["packages/*"]
- Turbo build works (0 packages currently)
- All Phase 1 tasks completed in single iteration

---

## Session 2 - 2025-01-12

### Task: Phase 2 - Shared Package

**Commit:** 6ec667d

**Files Created:**
- `packages/shared/package.json` - Package config with name @factory/shared
- `packages/shared/tsconfig.json` - Extends root config
- `packages/shared/src/types.ts` - All shared types (WorkItem, Worker, Learning, Metrics, API types)
- `packages/shared/src/index.ts` - Re-exports all types
- `bun.lock` - Lockfile from bun install

**Types Defined:**
- WorkItem, WorkItemStatus, Priority
- Worker, WorkerStatus
- Learning
- WorkerMetrics, FactoryMetrics
- API request/response types (AddWorkItemRequest, WorkerRegisterRequest, etc.)

**Notes:**
- All types are exported as interfaces/types only (no runtime code)
- Build produces proper .d.ts declaration files
- All Phase 2 tasks completed in single iteration

---

## Session 3 - 2025-01-12

### Task: Phase 3 - Database Schema

**Commit:** 7b332c2

**Files Created:**
- `migrations/001_initial.sql` - Initial PostgreSQL schema with all tables

**Tables Created:**
1. `work_items` - Stores work items (specs) with status, priority, metadata
2. `workers` - Tracks worker lifecycle and heartbeats
3. `learnings` - Persisted learnings with pgvector embeddings
4. `worker_metrics` - Per-iteration metrics (tokens, duration, tests)
5. `file_locks` - Prevents concurrent edits to same files

**Enums Created:**
- `work_item_status` (queued, assigned, in_progress, completed, failed, cancelled)
- `priority` (low, medium, high, critical)
- `worker_status` (starting, running, completed, failed, stuck, killed)

**Features:**
- pgvector extension for semantic similarity search
- HNSW index on learnings.embedding for fast vector search
- Partial indexes for queue ordering and active worker lookup
- Auto-updating `updated_at` trigger on work_items
- Proper foreign key relationships

**Notes:**
- Using 1536-dimension vectors (OpenAI ada-002 compatible)
- All column names use snake_case (PostgreSQL convention)
- All Phase 3 tasks completed in single iteration

---

## Session 4 - 2025-01-12

### Task: Phase 4.1 - Orchestrator Package Setup

**Files Created:**
- `packages/orchestrator/package.json` - Package config with name @factory/orchestrator
- `packages/orchestrator/tsconfig.json` - Extends root config with reference to shared
- `packages/orchestrator/src/index.ts` - Placeholder entry point

**Dependencies Added:**
- express ^4.21.0 - HTTP server
- pg ^8.13.0 - PostgreSQL client
- ioredis ^5.4.0 - Redis client
- dockerode ^4.0.0 - Docker SDK
- uuid ^11.0.0 - UUID generation
- Type definitions for all the above

**Notes:**
- tsconfig.json includes reference to @factory/shared package
- Build verifies successfully with `bun run build`
- Turborepo recognizes and caches both packages
- All Phase 4.1 tasks completed in single iteration

---

## Session 5 - 2025-01-12

### Task: Phase 4.2 - Database & Redis Clients

**Commit:** d6adcc9

**Files Created:**
- `packages/orchestrator/src/db.ts` - PostgreSQL client wrapper
- `packages/orchestrator/src/redis.ts` - Redis client wrapper

**db.ts Features:**
- Database class wrapping pg Pool
- Typed query methods (query, queryOne, queryOneOrFail, execute)
- Transaction support with automatic rollback on error
- Snake_case to camelCase conversion for database rows
- Entity-specific getters (getWorkItem, getWorker, getLearning, getWorkerMetrics)
- Connection management (connect/disconnect/isConnected)
- Row type interfaces matching PostgreSQL schema

**redis.ts Features:**
- RedisClient class wrapping ioredis
- Key prefix support for namespacing (factory:)
- String operations (get, set, del, exists)
- Numeric operations (incr, incrBy, decr, decrBy)
- Expiration operations (expire, expireAt, ttl, persist)
- Hash operations (hset, hmset, hget, hgetall, hdel, hincrby)
- Set operations (sadd, srem, sismember, smembers, scard)
- List operations (lpush, rpush, lpop, rpop, lrange, llen)
- JSON helpers (getJson, setJson)
- Pub/Sub support (publish)
- Connection management with retry strategy

**Notes:**
- Both clients create instances from environment variables (DATABASE_URL, REDIS_URL)
- Types align with @factory/shared package
- Build and type checks pass successfully
- All Phase 4.2 tasks completed in single iteration

---

## Session 6 - 2025-01-12

### Task: Phase 4.3 - QueueManager (Core Components)

**Commit:** ed4d7fa

**Files Created:**
- `packages/orchestrator/src/queue.ts` - QueueManager class

**QueueManager Methods:**
1. `add(input)` - Add work item to queue with priority/metadata
2. `get(id)` - Get work item by ID
3. `getNext()` - Get highest priority queued item (FOR UPDATE SKIP LOCKED)
4. `cancel(id)` - Cancel work item (only if queued/assigned)
5. `list()` - List active work items ordered by priority
6. `getStats()` - Get queue statistics by status and priority

**Features:**
- Priority ordering: critical > high > medium > low, then FIFO by created_at
- Row locking with SKIP LOCKED for safe concurrent access
- Transaction support for atomic getNext operation
- Status transitions: queued → assigned (via getNext), queued/assigned → cancelled (via cancel)

**Notes:**
- Uses Database.transaction() for getNext to ensure atomicity
- QueueStatsResponse matches @factory/shared types
- First of 5 core components in Phase 4.3

---

## Session 7 - 2025-01-12

### Task: Phase 4.3 - RateLimiter (Core Components)

**Commit:** 276d246

**Files Created:**
- `packages/orchestrator/src/rate-limits.ts` - RateLimiter class
- `packages/orchestrator/src/rate-limits.test.ts` - Unit tests

**RateLimiter Methods:**
1. `canSpawnWorker()` - Check if spawn allowed (capacity, cooldown, budget)
2. `recordSpawn()` - Record worker spawn
3. `recordWorkerDone()` - Record worker completion
4. `recordIteration()` - Record iteration for daily budget
5. `checkDailyReset()` - Reset daily limits at midnight
6. `getStatus()` - Get current rate limit status

**Features:**
- Redis-backed state for distributed operation
- Configurable max workers, daily budget, cooldown
- Auto-resets daily iteration count at midnight
- Environment variable configuration

---

## Session 8 - 2025-01-12

### Task: Phase 4.3 - ConflictDetector (Core Components)

**Commit:** d16b10c

**Files Created:**
- `packages/orchestrator/src/conflicts.ts` - ConflictDetector class
- `packages/orchestrator/src/conflicts.test.ts` - Unit tests

**ConflictDetector Methods:**
1. `acquireLocks(workerId, files)` - Acquire file locks (atomic)
2. `releaseLocks(workerId, files)` - Release specific locks
3. `releaseAllLocks(workerId)` - Release all locks for worker
4. `getLocksForWorker(workerId)` - Get all locks held by worker
5. `getLockHolder(filePath)` - Get worker holding a lock

**Features:**
- PostgreSQL-backed with UNIQUE constraint for exclusivity
- Idempotent lock acquisition (re-acquiring own lock succeeds)
- Partial success on multi-file locks (returns acquired/blocked)
- Handles race conditions gracefully via unique constraint violation

---

## Session 9 - 2025-01-12

### Task: Phase 4.3 - WorkerManager (Core Components)

**Commit:** 5959d3b

**Files Created:**
- `packages/orchestrator/src/workers.ts` - WorkerManager class
- `packages/orchestrator/src/workers.test.ts` - Unit tests (26 tests)

**WorkerManager Methods:**
1. `hasCapacity()` - Check if can spawn (delegates to RateLimiter)
2. `spawn(workItem)` - Spawn Docker container, create worker record
3. `register(workItemId)` - Worker self-registration, returns worker/workItem
4. `heartbeat(workerId, data)` - Update heartbeat timestamp and iteration
5. `complete(workerId, data)` - Handle completion, release locks, record metrics
6. `fail(workerId, error, iteration)` - Handle failure, release locks
7. `stuck(workerId, reason, attempts)` - Handle stuck state
8. `healthCheck()` - Find stale workers (no heartbeat in N seconds)
9. `kill(workerId, reason)` - Kill worker container, cleanup
10. `list()` - List all workers ordered by started_at
11. `getStats()` - Get statistics by status, avg iterations/duration

**Features:**
- Integrates with Database, RateLimiter, ConflictDetector, Docker
- Configurable stale threshold (default 60s)
- Proper cleanup on completion/failure/kill (lock release, rate limiter update)
- Graceful handling of missing containers

**Notes:**
- Fourth of 5 core components in Phase 4.3
- Next: MetricsCollector

---

## Session 10 - 2025-01-12

### Task: Phase 4.3 - MetricsCollector (Core Components)

**Commit:** 8fbae5e

**Files Created:**
- `packages/orchestrator/src/metrics.ts` - MetricsCollector class
- `packages/orchestrator/src/metrics.test.ts` - Unit tests (13 tests)

**MetricsCollector Methods:**
1. `getSummary()` - Get factory metrics summary (FactoryMetrics)
   - activeWorkers, queuedItems, completedToday, failedToday
   - iterationsToday, dailyBudget, avgCompletionTime, successRate
2. `getAll()` - Get all worker metrics ordered by timestamp
3. `getLearnings(options?)` - Get learnings with optional filters
   - Filter by repo, spec (partial match via ILIKE), limit

**Features:**
- Aggregates metrics from work_items, workers, worker_metrics, learnings
- Success rate calculated as completed / (completed + failed)
- Daily budget configurable via environment/constructor
- SQL injection safe with parameterized queries

**Notes:**
- Fifth and final core component in Phase 4.3
- Phase 4.3 complete, next: Phase 4.4 API Server

---

## Session 11 - 2025-01-12

### Task: Phase 4.4 - API Server

**Commit:** f82cc21

**Files Created:**
- `packages/orchestrator/src/server.ts` - Express API server
- `packages/orchestrator/src/server.test.ts` - Unit tests (24 tests)

**API Endpoints Implemented (16 total):**

Work Item Routes:
1. POST `/api/work` - Add work item to queue
2. GET `/api/work/:id` - Get work item by ID
3. POST `/api/work/:id/cancel` - Cancel work item

Worker Routes:
4. POST `/api/worker/register` - Worker self-registration
5. POST `/api/worker/:id/heartbeat` - Worker heartbeat
6. POST `/api/worker/:id/lock` - Request file locks
7. POST `/api/worker/:id/unlock` - Release file locks
8. POST `/api/worker/:id/complete` - Worker completed
9. POST `/api/worker/:id/fail` - Worker failed
10. POST `/api/worker/:id/stuck` - Worker stuck

Management Routes:
11. GET `/api/status` - Overall factory status
12. GET `/api/workers` - List all workers
13. POST `/api/workers/:id/kill` - Kill worker
14. GET `/api/queue` - Queue contents and stats
15. GET `/api/metrics` - Factory metrics summary
16. GET `/api/learnings` - Learnings with optional filters

**Features:**
- Dependency injection via createServer(deps) for testability
- Type guards for request body validation
- Async error handling wrapper
- Consistent error response format using ErrorResponse type
- 404 handler for unknown routes
- 500 handler for internal errors

**Dependencies Added:**
- supertest (dev) - HTTP testing
- @types/supertest (dev)

**Notes:**
- All 24 tests pass
- Phase 4.4 complete, next: Phase 4.5 Entry Point

---

## Session 12 - 2025-01-12

### Task: Phase 4.5 - Entry Point and Dockerfile

**Commit:** e004429

**Files Created/Modified:**
- `packages/orchestrator/src/index.ts` - Main entry point
- `packages/orchestrator/Dockerfile` - Container build

**Entry Point Features:**
1. `loadConfig()` - Load configuration from environment variables
2. `log()` - Timestamped logging utility
3. `runMainLoop()` - Main orchestrator loop:
   - Health check for stale workers (kill if no heartbeat)
   - Spawn workers for queued items when capacity available
   - Configurable loop interval (default 5s)
4. `setupGracefulShutdown()` - Handle SIGTERM/SIGINT signals
5. `main()` - Initialize all components and start server

**Component Initialization Order:**
1. Database (PostgreSQL via pg pool)
2. Redis (ioredis client)
3. Docker (dockerode)
4. QueueManager (db)
5. RateLimiter (redis)
6. ConflictDetector (db)
7. WorkerManager (db, rateLimiter, conflicts, docker)
8. MetricsCollector (db)
9. Express server (with all deps injected)

**Dockerfile Features:**
- Multi-stage build (builder + slim production)
- Bun runtime for consistency with monorepo
- Health check at /health endpoint
- Default environment variables for database and Redis

**Notes:**
- All existing tests still pass (160 tests)
- Phase 4 (Orchestrator Package) now complete
- Next: Phase 5 Worker Package

---

## Session 13 - 2025-01-12

### Task: Phase 5.1 - Worker Package Core

**Files Created:**
- `packages/worker/package.json` - Package config with name @factory/worker
- `packages/worker/tsconfig.json` - Extends root config
- `packages/worker/src/client.ts` - OrchestratorClient class
- `packages/worker/src/setup.ts` - Workspace setup functions
- `packages/worker/src/learnings.ts` - Learning management functions
- `packages/worker/src/ralph.ts` - Ralph execution and event parsing
- `packages/worker/src/index.ts` - Main entry point
- `packages/worker/src/client.test.ts` - Client tests (11 tests)
- `packages/worker/src/learnings.test.ts` - Learnings tests (9 tests)
- `packages/worker/src/ralph.test.ts` - Ralph event parsing tests (9 tests)

**OrchestratorClient Methods:**
1. `heartbeat(iteration, status?, tokens?)` - POST /api/worker/:id/heartbeat
2. `lockFile(files)` - POST /api/worker/:id/lock
3. `unlockFile(files)` - POST /api/worker/:id/unlock
4. `complete(prUrl?, metrics?, learnings?)` - POST /api/worker/:id/complete
5. `fail(error, iteration)` - POST /api/worker/:id/fail
6. `stuck(reason, attempts)` - POST /api/worker/:id/stuck
7. `getLearnings(repo)` - GET /api/learnings?repo=

**setupWorkspace Features:**
- Clone repo with depth 1
- Create branch from spec
- Write SPEC.md to repo
- Copy Claude config files
- Configure git user

**createPullRequest Features:**
- Stage and commit changes
- Push to remote
- Create PR via gh CLI

**runRalph Features:**
- Spawn claude process with --dangerously-skip-permissions
- Parse [RALPH:*] events from stdout
- Event types: ITERATION, FILE_EDIT, STUCK, COMPLETE, FAILED
- Automatic heartbeat on iteration events
- File locking on edit events
- Stuck/fail reporting

**Notes:**
- 29 tests pass
- Build and type checks pass
- First of 2 tasks in Phase 5 complete
- Next: Phase 5.2 Worker Config and Dockerfile

---

## Session 14 - 2025-01-13

### Task: Phase 5.2 - Worker Config and Dockerfile

**Commit:** 39a4ae9

**Files Created:**
- `packages/worker/.claude/CLAUDE.md` - Worker instructions for Ralph
- `packages/worker/.claude/mcp.json` - MCP server configuration
- `packages/worker/.claude/settings.json` - Claude Code settings
- `packages/worker/Dockerfile` - Worker container build

**CLAUDE.md Contents:**
- Ralph identity and mission
- Event protocol documentation (ITERATION, FILE_EDIT, COMPLETE, STUCK, FAILED)
- Workflow instructions for working through SPEC.md
- Guidelines for autonomous operation
- Reference to learnings system

**mcp.json Configuration:**
- playwright: @anthropic-ai/mcp-server-playwright for browser automation
- context7: @anthropic-ai/context7-mcp for documentation lookup

**settings.json Configuration:**
- Full permissions for autonomous operation (Bash, Read, Write, Edit, Glob, Grep)
- MCP server permissions enabled

**Dockerfile Features:**
- Multi-stage build (builder + runtime)
- Builder: oven/bun for compiling TypeScript
- Runtime: debian:bookworm-slim
- Installs: git, curl, gh CLI, Claude Code CLI, Bun
- Copies Claude config to /root/.claude
- Entry point: node dist/index.js

**Notes:**
- All 58 tests pass (29 in src/, 29 in dist/)
- Type checks pass
- Phase 5 (Worker Package) now complete
- Next: Phase 6 Intake Package

---

## Session 15 - 2025-01-13

### Task: Phase 6 - Intake Package

**Commit:** 0699908

**Files Created:**
- `packages/intake/package.json` - Package config with name @factory/intake
- `packages/intake/tsconfig.json` - Extends root config
- `packages/intake/src/github.ts` - GitHubAdapter class
- `packages/intake/src/spec-gen.ts` - SpecGenerator class
- `packages/intake/src/index.ts` - Main entry point
- `packages/intake/Dockerfile` - Container build
- `packages/intake/src/github.test.ts` - GitHubAdapter tests (14 tests)
- `packages/intake/src/spec-gen.test.ts` - SpecGenerator tests (10 tests)

**GitHubAdapter Methods:**
1. `poll()` - Poll repos for issues with intake label
2. `addLabel(owner, repo, issueNumber, label)` - Add label to issue
3. `removeLabel(owner, repo, issueNumber, label)` - Remove label from issue
4. `markProcessing(issue)` - Add processing label
5. `markCompleted(issue)` - Remove intake/processing, add completed
6. `markFailed(issue)` - Remove processing label for retry
7. `getLabels()` - Get configured label names

**GitHubAdapter Features:**
- Filters out pull requests (appear as issues in API)
- Filters out already-processing issues
- Handles multiple repos
- Graceful 404 handling on label removal
- Configurable intake/processing/completed labels

**SpecGenerator Methods:**
1. `generate(issue)` - Generate spec from GitHub issue

**SpecGenerator Features:**
- Uses Claude claude-sonnet-4-20250514 model for spec generation
- Branch name from issue title (sanitized, truncated to 50 chars)
- Configurable model and max tokens
- Returns title, spec, branch, metadata

**Entry Point Features:**
- Environment variable configuration (GITHUB_TOKEN, ANTHROPIC_API_KEY, REPOS, etc.)
- Poll loop with configurable interval
- Processing pipeline: mark processing → generate spec → submit to orchestrator
- Graceful error handling with retry on failure

**Dockerfile Features:**
- Multi-stage build (builder + slim production)
- Bun runtime for consistency
- No secrets in image (env vars required at runtime)

**Notes:**
- 24 tests pass
- Type checks pass
- Phase 6 (Intake Package) now complete
- Next: Phase 7 Docker Infrastructure

---

## Session 16 - 2025-01-13

### Task: Phase 7 - Docker Infrastructure

**Files Created:**
- `docker/docker-compose.yml` - Complete Docker Compose configuration

**Services Configured:**

1. **postgres** (pgvector/pgvector:pg16)
   - Persistent volume (postgres_data)
   - Health check with pg_isready
   - Mounts migrations for auto-initialization

2. **redis** (redis:7-alpine)
   - Persistent volume (redis_data)
   - Append-only mode enabled
   - Health check with redis-cli ping

3. **orchestrator**
   - Builds from packages/orchestrator/Dockerfile
   - Depends on healthy postgres + redis
   - Docker socket mounted for container management
   - Health check on /health endpoint

4. **intake**
   - Builds from packages/intake/Dockerfile
   - Depends on healthy orchestrator
   - Environment: GITHUB_TOKEN, ANTHROPIC_API_KEY, REPOS

5. **dashboard** (placeholder)
   - Builds from packages/dashboard/Dockerfile (not yet implemented)
   - Profile: with-dashboard (disabled by default)
   - Depends on healthy orchestrator

**Features:**
- Named volumes for data persistence
- Health checks on all services for dependency ordering
- Environment variable substitution with defaults
- Custom network (factory-network) for inter-service communication
- Dashboard in profile (won't start by default until implemented)

**Notes:**
- No tests for docker-compose (infrastructure only)
- All build and type checks pass
- Phase 7 (Docker Infrastructure) now complete
- Next: Phase 8 Scripts
