# WorkerManager Implementation Plan

## Goal
Implement `packages/orchestrator/src/workers.ts` - WorkerManager class that handles worker lifecycle management including spawning Docker containers, registration, heartbeats, completion, failure, and health checks.

## Files to Create/Modify
- `packages/orchestrator/src/workers.ts` - New file with WorkerManager class
- `packages/orchestrator/src/workers.test.ts` - Tests for WorkerManager

## Methods to Implement

Per SPEC.md Phase 4.3:
- `hasCapacity()` - Check if can spawn based on rate limiter
- `spawn(workItem)` - Spawn Docker container for a work item
- `register(workItemId)` - Worker self-registration, creates worker record
- `heartbeat(workerId, data)` - Update heartbeat timestamp and iteration
- `complete(workerId, data)` - Handle completion (update status, release locks, record metrics)
- `fail(workerId, error, iteration)` - Handle failure (update status, release locks)
- `stuck(workerId, reason, attempts)` - Handle stuck state
- `healthCheck()` - Check for stale workers (no heartbeat in N seconds)
- `kill(workerId, reason)` - Kill worker container
- `list()` - List all workers
- `getStats()` - Get worker statistics

## Dependencies
- Database (from `./db.ts`) - For worker table operations
- RateLimiter (from `./rate-limits.ts`) - For spawn capacity checks
- ConflictDetector (from `./conflicts.ts`) - For releasing file locks
- Dockerode - For container management

## Design Decisions
1. Constructor accepts db, rateLimiter, conflictDetector, and Docker client
2. Worker IDs are UUIDs generated on registration
3. Container IDs are stored for kill operations
4. Health check threshold is configurable (default 60s)
5. Follow patterns from existing files (queue.ts, conflicts.ts)

## Tests
- `hasCapacity()` - Delegates to rateLimiter.canSpawnWorker()
- `register()` - Creates worker record, returns worker ID
- `heartbeat()` - Updates heartbeat timestamp and iteration
- `complete()` - Updates status, releases locks, updates work item
- `fail()` - Updates status, releases locks, updates work item
- `stuck()` - Updates status to stuck
- `healthCheck()` - Returns stale workers
- `list()` - Returns all workers
- `getStats()` - Returns statistics by status

## Exit Criteria
- [ ] WorkerManager class implemented with all methods
- [ ] Tests pass for all methods
- [ ] Type checks pass (`bun run typecheck`)
- [ ] Code follows existing patterns in the codebase
