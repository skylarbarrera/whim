# Debug Report: Worker Lifecycle Reliability Analysis
Generated: 2026-01-13

## Symptom
Audit of worker lifecycle to assess success rate and identify reliability gaps.

## Erotetic Framework
- X = Worker lifecycle from queue -> PR creation
- Q = [What are the failure modes? Are retries correct? Are locks released? Is observability sufficient?]

## Hypotheses Tested

| # | Hypothesis | Result | Evidence |
|---|------------|--------|----------|
| 1 | Happy path is complete | CONFIRMED | Full state machine from queued -> completed with PR |
| 2 | Failure scenarios handled | PARTIAL | Some gaps in crash recovery |
| 3 | Retry/backoff correct | CONFIRMED | Exponential backoff 1/5/30 min, max 3 retries |
| 4 | Locks released in all paths | CONFIRMED | `releaseAllLocks` in complete/fail/stuck/kill |
| 5 | Observability adequate | PARTIAL | Logs present but no structured metrics export |

## Investigation Trail

| Step | Action | Finding |
|------|--------|---------|
| 1 | Traced queue -> spawn flow | `QueueManager.getNext()` uses `FOR UPDATE SKIP LOCKED` for safe concurrent access |
| 2 | Traced worker lifecycle | Complete state machine: starting -> running -> completed/failed/stuck/killed |
| 3 | Checked failure reporting | Worker calls `client.fail()` or `client.stuck()` on errors |
| 4 | Checked retry mechanism | Killed workers get exponential backoff (1/5/30 min), max 3 retries |
| 5 | Checked lock release | `releaseAllLocks()` called in all terminal states |
| 6 | Checked heartbeat | Sent on every tool call, not just iterations |
| 7 | Checked stale detection | `healthCheck()` finds workers with heartbeat > threshold |

---

## Happy Path Analysis

### State Transitions (VERIFIED)
```
queued -> assigned -> in_progress -> completed
         (getNext)   (spawn)        (complete)
```

1. **Queue Selection** (`packages/orchestrator/src/queue.ts:77-101`)
   - Uses `FOR UPDATE SKIP LOCKED` - no race conditions
   - Respects priority ordering and retry backoff
   - Atomically marks as "assigned" within transaction

2. **Worker Spawn** (`packages/orchestrator/src/workers.ts:66-160`)
   - Creates DB record first, then Docker container
   - Rollback on container failure: deletes worker, resets work item to queued
   - Resource limits: 4GB RAM, 2 CPU, 256 PIDs

3. **Ralph Execution** (`packages/worker/src/index.ts`, `packages/worker/src/ralph.ts`)
   - Git auth verified BEFORE work starts
   - Heartbeat on EVERY tool call (not just iterations)
   - Incremental push after each commit
   - Test validation after Ralph completes

4. **Completion** (`packages/orchestrator/src/workers.ts:261-319`)
   - Updates worker & work item status
   - Records metrics
   - Releases file locks
   - Signals rate limiter

### Metrics Captured (VERIFIED)
- `tokensIn`, `tokensOut` - API usage
- `duration` - total time
- `filesModified` - scope of changes
- `testsRun`, `testsPassed`, `testsFailed` - validation
- `testStatus` - passed/failed/timeout/skipped/error

---

## Failure Scenario Analysis

### 1. Container Fails to Start
**Location:** `packages/orchestrator/src/workers.ts:110-150`

**Handling:** GOOD
- Docker `createContainer`/`start` wrapped in try/catch
- On failure: deletes worker record, resets work item to queued
- Rollback errors logged but don't hide original error

**Gap:** None - properly handled.

### 2. Worker Registers but Ralph Hangs
**Location:** `packages/orchestrator/src/workers.ts:401-444` (healthCheck/kill)

**Handling:** GOOD
- `healthCheck()` runs every loop iteration (default 5s)
- Finds workers with `last_heartbeat < NOW() - threshold` (default 300s)
- Stale workers are killed via `kill()` method
- Work item gets retry with exponential backoff

**Gap:** 5-minute stale threshold may be too long for fast-fail scenarios.

### 3. Ralph Fails Repeatedly
**Location:** `packages/worker/src/ralph.ts:210-225`

**Handling:** GOOD
- Ralph exit codes mapped: 0=complete, 1=stuck, 2=max iterations, 3+=error
- Worker calls `client.fail()` with error and iteration count
- Error stored in both `workers.error` and `work_items.error`

**Gap:** No circuit breaker - same work item will retry until max retries.

### 4. PR Creation Fails After Successful Work
**Location:** `packages/worker/src/index.ts:97-134`

**Handling:** GOOD
- PR creation wrapped in try/catch
- On failure: logs error, reports completion WITH metrics but WITHOUT prUrl
- "Partial success" - work is done, just PR failed

**Gap:** 
- PR failure not retried automatically
- No separate "pr_failed" status - looks like success without PR

### 5. Network Partition During Heartbeat
**Location:** `packages/worker/src/client.ts:28-47`

**Handling:** PARTIAL
- Client throws on HTTP errors
- BUT: No retry logic in the client itself
- Caller (`ralph.ts:161`) catches and logs but doesn't retry heartbeat

**Gap:** 
- Single heartbeat failure could cascade to worker death
- No reconnection logic in client

### 6. Container OOM Mid-Work
**Location:** `packages/orchestrator/src/workers.ts:401-444`

**Handling:** PARTIAL
- Container has 4GB limit, no swap
- If OOM killed: container exits, no more heartbeats
- Eventually detected by `healthCheck()` as stale
- Work item retried with backoff

**Gap:**
- No immediate detection of OOM - waits for stale threshold
- Container logs not captured for diagnosis
- OOM not distinguished from other crashes in error message

---

## Recovery Mechanisms

### Retry Trigger
**Location:** `packages/orchestrator/src/workers.ts:461-492`

Retry happens when:
1. Worker killed (by `healthCheck` or manual)
2. `retryCount < maxRetries` (3)
3. `iteration < maxIterations`

### Backoff Calculation
```typescript
const backoffMinutes = [1, 5, 30][Math.min(newRetryCount - 1, 2)] ?? 30;
```
- Retry 1: 1 minute
- Retry 2: 5 minutes
- Retry 3: 30 minutes

### Permanent Failure
Gives up when:
1. `retryCount > maxRetries` (3 killed attempts)
2. `iteration >= maxIterations` (worker reached limit before crash)

### Lock Release (VERIFIED in all paths)
| Path | Location | Method |
|------|----------|--------|
| Complete | `workers.ts:308` | `releaseAllLocks(workerId)` |
| Fail | `workers.ts:346` | `releaseAllLocks(workerId)` |
| Stuck | `workers.ts:378` | `releaseAllLocks(workerId)` |
| Kill | `workers.ts:494` | `releaseAllLocks(workerId)` |

---

## Observability Assessment

### What's Logged (GOOD)
- Worker lifecycle events (spawn, complete, fail)
- PR creation steps with detailed command output
- Retry attempts with error context
- Git operations (push, commit)
- AI review progress

### What's Missing (GAPS)
| Gap | Impact | Severity |
|-----|--------|----------|
| No structured logging (JSON) | Hard to parse in log aggregators | Medium |
| No metrics export (Prometheus) | Can't build dashboards | Medium |
| Container logs not captured on exit | OOM/crash diagnosis difficult | High |
| No distributed tracing | Hard to correlate across services | Low |
| No health check endpoint for workers | Can't probe worker health externally | Low |

### Debugging a Stuck Work Item
Current capability: PARTIAL

To debug:
1. Query `workers` table for status/error
2. Query `work_items` table for retry count/error
3. Check orchestrator logs for kill reason
4. **Missing:** Container logs from Docker

---

## Confidence Assessment

### Expected Success Rate

| Scenario | Probability | Notes |
|----------|-------------|-------|
| Happy path (Ralph succeeds, PR created) | ~70% | Depends on task complexity |
| Ralph succeeds, PR fails | ~5% | Network transients, scope issues |
| Ralph stuck (no progress) | ~15% | Task too hard, wrong approach |
| Infrastructure failure (OOM, network) | ~5% | Container limits, transients |
| Permanent failure after retries | ~5% | 3 retries usually sufficient |

**Overall estimated success rate: 70-75%**

### Critical Paths
1. **Git auth** - Verified BEFORE work starts (good)
2. **Heartbeat** - Every tool call prevents stale detection (good)
3. **Incremental push** - Work not lost on crash (good)
4. **Lock release** - Consistent in all exit paths (good)

---

## Gaps and Recommendations

### High Priority

| Gap | Risk | Fix |
|-----|------|-----|
| Container logs not captured on crash | Can't diagnose OOM/segfault | Add `container.logs()` in `kill()` before stopping |
| Heartbeat client has no retry | Single network blip kills worker | Add 3-retry with backoff in `client.ts` |
| PR failure not distinguished | Metrics misleading | Add `pr_status` field or `completed_without_pr` status |

### Medium Priority

| Gap | Risk | Fix |
|-----|------|-----|
| 5-min stale threshold | Slow failure detection | Make configurable, consider 2-min default |
| No Prometheus metrics | Can't build SLO dashboards | Add `/metrics` endpoint |
| No circuit breaker for bad repos | Same repo fails repeatedly | Track per-repo failure rate, pause if > threshold |

### Low Priority

| Gap | Risk | Fix |
|-----|------|-----|
| No distributed tracing | Hard to debug complex issues | Add trace ID propagation |
| No worker health probe | External monitoring limited | Add `/health` in worker container |

---

## Files to Modify for High-Priority Fixes

### 1. Add heartbeat retry (`packages/worker/src/client.ts:28-47`)
```typescript
async heartbeat(iteration: number, status?: string, tokens?: { in: number; out: number }): Promise<void> {
  // Add retry with exponential backoff
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await this.request<void>("POST", `/api/worker/${this.workerId}/heartbeat`, { iteration, status, ... });
      return;
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
}
```

### 2. Capture container logs on kill (`packages/orchestrator/src/workers.ts:445-455`)
```typescript
if (worker.containerId) {
  try {
    const container = this.docker.getContainer(worker.containerId);
    // Capture last 100 lines before stopping
    const logs = await container.logs({ stdout: true, stderr: true, tail: 100 });
    console.log(`Container ${worker.containerId} logs:\n${logs.toString()}`);
    await container.stop({ t: 10 });
  } catch (err) { ... }
}
```

### 3. Track PR creation status separately (`packages/shared/src/types.ts`)
```typescript
export interface WorkItem {
  // ... existing fields
  prStatus: "pending" | "created" | "failed" | null;  // Add this
}
```

---

## Summary

The worker lifecycle is **well-designed** with proper state management, retry logic, and lock handling. The main gaps are:

1. **Observability** - Container crash logs not captured, no structured metrics
2. **Resilience** - Heartbeat client lacks retry, single failure cascades
3. **Granularity** - PR failure conflated with overall success

**Confidence:** High that the core logic is correct. Medium confidence in edge case handling (network partitions, OOM).

**Estimated reliability: 95%** for infrastructure, **70-75%** for end-to-end success including Ralph task completion.
