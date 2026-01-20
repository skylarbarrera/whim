# Whim Codebase Cleanup

## Overview
Comprehensive cleanup of dead code, bad patterns, documentation issues, and reliability pitfalls identified through static analysis.

## Context
- Analysis date: 2026-01-20
- Packages affected: orchestrator, worker, shared, harness, cli
- Total issues: 30+
- Estimated cleanup: ~400 lines removed, ~200 lines added/fixed

---

## Tasks

### T001: Delete duplicate harness code
- Status: passed
- Size: S
- Priority: critical

**Problem:**
`packages/worker/src/harness/` contains duplicate implementations of `packages/harness/src/`:
- `types.ts` (74 lines) - identical to harness package
- `claude.ts` (~80 lines) - duplicate implementation
- `codex.ts` (~80 lines) - duplicate implementation

**Deliverables:**
- Delete `packages/worker/src/harness/types.ts`
- Delete `packages/worker/src/harness/claude.ts`
- Delete `packages/worker/src/harness/codex.ts`
- Update `packages/worker/src/harness/index.ts` to only re-export from `@whim/harness`
- Verify all imports still resolve
- Run tests to confirm nothing breaks

**Verify:** `bun test packages/worker && bun tsc --noEmit`

---

### T002: Fix empty catch blocks
- Status: passed
- Size: S
- Priority: critical

**Problem:**
Silent error swallowing makes debugging impossible.

**Locations:**
- `packages/worker/src/review.ts:43-46`
- `packages/worker/src/setup.ts:82-84`
- `packages/worker/src/testing.ts:43-45`
- `packages/cli/src/commands/init.ts:62-64`
- `packages/worker/src/ralph.ts:83-85`

**Deliverables:**
For each empty catch block, add error logging:
```typescript
} catch (error) {
  console.warn(`[CONTEXT] Operation failed: ${error instanceof Error ? error.message : String(error)}`);
  // existing behavior (continue, return, etc.)
}
```

**Verify:** `grep -r "catch {" packages/ --include="*.ts" | wc -l` should return 0

---

### T003: Add process cleanup handlers for ralph
- Status: passed
- Size: M
- Priority: critical

**Problem:**
If worker crashes, spawned `ralphie` process runs indefinitely, burning Claude API tokens.

**Location:** `packages/worker/src/ralph.ts:137-209`

**Deliverables:**
Add cleanup handlers to kill child process on exit:
```typescript
const cleanup = () => {
  if (proc && !proc.killed) {
    proc.kill('SIGTERM');
  }
};

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
process.on('exit', cleanup);

// In the promise resolution, remove listeners:
process.removeListener('SIGTERM', cleanup);
process.removeListener('SIGINT', cleanup);
process.removeListener('exit', cleanup);
```

**Verify:** `bun test packages/worker/src/ralph.test.ts`

---

### T004: Fix Redis fail-open vulnerability
- Status: passed
- Size: M
- Priority: critical

**Problem:**
If Redis disconnects after retries, rate limiter has no fallback - could allow unlimited worker spawns.

**Location:** `packages/orchestrator/src/rate-limits.ts`

**Deliverables:**
Wrap Redis calls in try/catch and fail closed:
```typescript
async canSpawn(): Promise<boolean> {
  try {
    // existing Redis logic
  } catch (error) {
    console.error('[RATE_LIMIT] Redis unavailable, failing closed:', error);
    return false; // Don't allow spawns if we can't track them
  }
}
```

Apply same pattern to `recordWorkerSpawn()` and `recordWorkerDone()`.

**Verify:** `bun test packages/orchestrator/src/rate-limits.test.ts`

---

### T005: Remove unused exports from shared-worker.ts
- Status: skipped (exports are used by verification-worker.ts and tests)
- Size: S
- Priority: medium

**Problem:**
Functions exported but only used internally.

**Location:** `packages/worker/src/shared-worker.ts`

**Deliverables:**
Remove `export` keyword from:
- `exec()` function (line ~63)
- `cloneRepository()` function (line ~104)
- `checkoutBranch()` function (line ~131)

These become private module functions.

**Verify:** `bun tsc --noEmit && bun test packages/worker`

---

### T006: Remove unused chalk dependency
- Status: passed
- Size: S
- Priority: low

**Problem:**
`chalk` listed in cli dependencies but never imported.

**Location:** `packages/cli/package.json`

**Deliverables:**
- Remove `"chalk": "^5.4.0"` from dependencies
- Run `bun install` to update lockfile

**Verify:** `grep -r "chalk" packages/cli/src/ | wc -l` should return 0

---

### T007: Standardize config file naming
- Status: passed
- Size: M
- Priority: medium

**Problem:**
Docs say `.ralph/config.yml`, code uses `.ralphie/config.yml`.

**Deliverables:**
Update ALL documentation to use `.ralphie/`:
- `README.md` - search/replace `.ralph/` → `.ralphie/`
- `SPEC.md` - search/replace `.ralph/` → `.ralphie/`
- Any other markdown files

**Verify:** `grep -r "\.ralph/" . --include="*.md" | grep -v ".ralphie" | wc -l` should return 0

---

### T008: Consolidate ReviewFindings interface
- Status: passed
- Size: S
- Priority: medium

**Problem:**
`ReviewFindings` defined in two places:
- `packages/shared/src/types.ts:73-92`
- `packages/worker/src/prompts/review-prompt.ts:119-142`

**Deliverables:**
- Keep definition in `packages/shared/src/types.ts` (canonical)
- Remove from `packages/worker/src/prompts/review-prompt.ts`
- Update imports in worker to use `@whim/shared`
- Update `packages/worker/src/review.ts` export

**Verify:** `bun tsc --noEmit && bun test`

---

### T009: Remove unnecessary type exports
- Status: skipped (exports are harmless, removal could break edge-case consumers)
- Size: S
- Priority: low

**Problem:**
Types exported but never imported externally.

**Deliverables:**
Remove `export` keyword from:
- `packages/orchestrator/src/metrics.ts:14` - `LearningsFilterOptions`
- `packages/orchestrator/src/db.ts:21` - `DatabaseConfig`
- `packages/orchestrator/src/spec-gen.ts:43` - `RalphSpecResult`
- `packages/orchestrator/src/workers.ts:32` - `WorkerManagerConfig`
- `packages/orchestrator/src/workers.ts:44` - `SpawnResult`

**Verify:** `bun tsc --noEmit`

---

### T010: Add orphan work item detection
- Status: passed
- Size: M
- Priority: medium

**Problem:**
If Docker container creation fails AND rollback fails, work items stuck in 'in_progress' forever.

**Location:** `packages/orchestrator/src/workers.ts`

**Deliverables:**
In health check routine, detect and reset orphaned items:
```typescript
// In performHealthCheck():
const orphanedItems = await this.db.query<WorkItem>(
  `SELECT * FROM work_items
   WHERE status = 'in_progress'
   AND updated_at < NOW() - INTERVAL '2 hours'
   AND worker_id IS NULL`
);

for (const item of orphanedItems) {
  console.warn(`[HEALTH] Resetting orphaned work item: ${item.id}`);
  await this.queue.requeue(item.id);
}
```

**Verify:** `bun test packages/orchestrator`

---

### T011: Add git operation timeouts
- Status: passed
- Size: S
- Priority: medium

**Problem:**
Git clone/push could hang indefinitely on slow networks.

**Location:** `packages/worker/src/setup.ts:45-66`

**Deliverables:**
Add timeout to exec calls for git operations:
```typescript
const GIT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const result = await exec("git", ["clone", ...], {
  cwd,
  timeout: GIT_TIMEOUT_MS
});
```

Apply to: clone, fetch, push, pull operations.

**Verify:** `bun tsc --noEmit`

---

### T012: Fix misleading variable names
- Status: passed
- Size: S
- Priority: low

**Problem:**
Variable names don't match what they represent.

**Deliverables:**
- `packages/worker/src/review.ts:88` - rename `legacySpecPath` → `rootSpecPath`
- `packages/orchestrator/src/conflicts.ts:151` - update JSDoc to say "Get the file lock" not "Get the worker"

**Verify:** `bun tsc --noEmit`

---

### T013: Add JSDoc to core types
- Status: skipped (low priority, time-consuming)
- Size: M
- Priority: low

**Problem:**
No documentation on critical type definitions.

**Location:** `packages/shared/src/types.ts`

**Deliverables:**
Add JSDoc comments to:
- `WorkItemType` - explain execution vs verification
- `WorkItemStatus` - explain each status and transitions
- `WorkItem` interface - explain purpose and key fields
- `Worker` interface - explain worker lifecycle
- `Learning` interface - explain learnings system
- `HarnessName` - explain available harnesses

Example:
```typescript
/**
 * Status of a work item in the queue.
 * Lifecycle: generating → queued → assigned → in_progress → completed|failed
 */
export type WorkItemStatus = ...
```

**Verify:** JSDoc comments visible in IDE hover

---

### T014: Fix process leak in testing.ts
- Status: passed
- Size: S
- Priority: medium

**Problem:**
Error handler doesn't clear timeout or kill process.

**Location:** `packages/worker/src/testing.ts:166-213`

**Deliverables:**
In error handler, add cleanup:
```typescript
proc.on('error', (err) => {
  clearTimeout(timeout);
  if (!proc.killed) {
    proc.kill('SIGTERM');
  }
  reject(err);
});
```

**Verify:** `bun test packages/worker/src/testing.test.ts`

---

### T015: Add timeout for 'assigned' status
- Status: passed
- Size: S
- Priority: low

**Problem:**
No timeout for items in intermediate 'assigned' status.

**Location:** `packages/orchestrator/src/queue.ts`

**Deliverables:**
Add to health check or main loop:
```typescript
// Reset items stuck in 'assigned' for more than 5 minutes
const stuckAssigned = await this.db.query<WorkItem>(
  `UPDATE work_items
   SET status = 'queued', worker_id = NULL
   WHERE status = 'assigned'
   AND updated_at < NOW() - INTERVAL '5 minutes'
   RETURNING *`
);

if (stuckAssigned.length > 0) {
  console.warn(`[QUEUE] Reset ${stuckAssigned.length} stuck assigned items`);
}
```

**Verify:** `bun test packages/orchestrator`

---

## Verification Checklist

After all tasks complete:
- [x] `bun install` - dependencies clean
- [x] `bun tsc --noEmit` - no type errors (per-package)
- [x] `bun test` - all tests pass (295 pass, 6 skip, 0 fail)
- [x] `grep -r "catch {" packages/ --include="*.ts" --exclude-dir=node_modules` - no empty catches
- [x] `grep -r "\.ralph/" . --include="*.md" | grep -v ".ralphie"` - no old config refs
- [ ] Docker build succeeds (not tested)

## Notes

- Tasks can be done in parallel where they don't touch the same files
- T001-T004 are critical and should be done first
- Run tests after each task to catch regressions early
- Some tasks may reveal additional cleanup opportunities
