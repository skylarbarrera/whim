# Whim Pre-Release Fixes

Bugs and issues to fix before open-sourcing the repository.

## Architecture Review Findings

### Critical (Must Fix)
- [x] No API authentication - added API_KEY env var with middleware
- [x] `stuck()` doesn't release file locks - added releaseAllLocks call
- [x] Docker containers have no resource limits - added 4GB mem, 2 CPU, 256 PIDs

### High Priority (Should Fix)
- [ ] TOCTOU race in rate limiter with multiple orchestrator instances
- [ ] Heartbeat/kill race - no grace buffer before killing
- [ ] Daily budget reset race at midnight
- [x] Spawn rollback can fail and swallow original error - wrapped in try/catch
- [ ] No PostgreSQL reconnection strategy

### Medium Priority (Nice to Have)
- [x] No input length validation - added MAX_REPO/SPEC/BRANCH_LENGTH + REPO_PATTERN
- [x] Request body size limit - added 1MB limit
- [ ] Stuck workers never picked up by healthCheck
- [ ] Queue unbounded growth potential
- [ ] File lock TTL missing (orphaned locks persist forever)
- [ ] Orphan container risk when stop fails

---

## Completed Fixes

## Must Fix (Blocking)

### 1. Main Loop Capacity Bug
- [x] Fix `packages/orchestrator/src/index.ts:67` - capacity check evaluated once, not per iteration
- [x] Change `while (hasCapacity)` to `while (await workers.hasCapacity())`
- [x] Existing unit tests for `hasCapacity()` cover the behavior

### 2. PR Reviews Schema Type Mismatch
- [x] Fix `migrations/002_pr_reviews.sql:6` - `work_item_id` is INTEGER but should be UUID
- [x] Update migration to use `work_item_id UUID NOT NULL REFERENCES work_items(id)`
- [x] Also fixed `id` to UUID and `TIMESTAMP` to `TIMESTAMPTZ` for consistency
- [ ] Verify migration runs successfully against fresh database

### 3. Worker Spawn Not Transactional
- [x] Fix `packages/orchestrator/src/workers.ts:79-137` - orphaned records on Docker failure
- [x] Wrap DB inserts + container spawn in try/catch
- [x] Rollback DB records if container creation fails (delete worker, reset work_item to queued)
- [x] Existing tests verify spawn behavior

## Should Fix (Quality)

### 4. File Lock Race Condition
- [x] Refactor `packages/orchestrator/src/conflicts.ts:56-75`
- [x] Replace SELECT-then-INSERT with single `INSERT ... ON CONFLICT DO NOTHING RETURNING *`
- [x] Remove reliance on catching 23505 for normal operation
- [x] Updated mock in tests to handle new pattern

### 5. Redis Counter Drift
- [x] Fix `packages/orchestrator/src/rate-limits.ts` - activeWorkers can drift if workers crash
- [x] Option A: Derive count from DB (`SELECT COUNT(*) FROM workers WHERE status IN ('starting', 'running')`)
- [x] Added `getActiveWorkerCount` callback to RateLimiter config
- [x] Wired up DB query in index.ts when creating RateLimiter

### 6. No Retry Backoff
- [x] Add `retry_count` column to work_items table (migration 003)
- [x] Add `next_retry_at` column for backoff scheduling (migration 003)
- [x] Implement exponential backoff (1min, 5min, 30min)
- [x] Add `max_retries` (hardcoded to 3 for now)
- [x] Fail items where `retry_count > max_retries`
- [x] Update queue.getNext() to respect `next_retry_at`
- [x] Update WorkItem type in shared/types.ts
- [x] Update WorkItemRow in db.ts

### 7. SQL String Interpolation
- [x] Fix `packages/orchestrator/src/workers.ts` healthCheck method
- [x] Fix kill method backoff interval
- [x] Both now use `INTERVAL '1 unit' * $N` pattern

## Pre-Release Checklist

### Documentation
- [ ] Add ARCHITECTURE.md explaining system design
- [ ] Update README with setup instructions
- [ ] Document environment variables in .env.example
- [ ] Add CONTRIBUTING.md

### Cleanup
- [ ] Remove any hardcoded values
- [ ] Audit for secrets/tokens in code
- [x] Run full test suite and fix failures (190 tests pass)
- [x] Run typecheck across all packages

### Repository
- [ ] Create fresh repo (Option A migration)
- [ ] Single clean initial commit
- [ ] Verify .gitignore covers all secrets
