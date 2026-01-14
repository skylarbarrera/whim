# Performance Analysis: Whim Orchestrator Edge Cases & Race Conditions
Generated: 2025-01-13

## Executive Summary
- **Bottleneck Type:** Concurrency/Race Conditions
- **Risk Level:** Medium-High (several subtle bugs that would only appear under stress)
- **Priority Findings:** 8 potential issues identified

---

## 1. Concurrency Issues

### 1.1 TOCTOU Race in Rate Limiter `canSpawnWorker`

**Location:** `/Users/skillet/dev/ai/whim/packages/orchestrator/src/rate-limits.ts:82-105`
**Type:** Time-of-Check-to-Time-of-Use (TOCTOU) Race
**Impact:** Multiple orchestrator instances could spawn more workers than `maxWorkers` allows

**Evidence:**
```typescript
async canSpawnWorker(): Promise<boolean> {
  await this.checkDailyReset();
  
  // CHECK: read active count
  const activeWorkers = await this.getActiveWorkerCount();
  if (activeWorkers >= this.config.maxWorkers) {
    return false;
  }
  // ... more checks ...
  return true;  // USE: caller spawns based on this
}
```

**Scenario:**
1. Orchestrator A calls `canSpawnWorker()` -> returns `true` (activeWorkers=1, max=2)
2. Orchestrator B calls `canSpawnWorker()` -> returns `true` (still sees activeWorkers=1)
3. Both spawn -> now activeWorkers=3, exceeding limit

**Fix Options:**
1. Use Redis WATCH/MULTI or Lua script for atomic check-and-increment
2. Use PostgreSQL advisory locks around spawn operations
3. Accept eventual consistency and rely on DB-based count correction

---

### 1.2 Heartbeat/Kill Race Condition

**Location:** `/Users/skillet/dev/ai/whim/packages/orchestrator/src/workers.ts:406-411` and `index.ts:73-78`
**Type:** Race Condition
**Impact:** Worker could be killed immediately after sending heartbeat

**Evidence:**
```typescript
// index.ts - Health check runs on loop
const staleWorkers = await workers.healthCheck();
for (const staleWorker of staleWorkers) {
  await workers.kill(staleWorker.id, "heartbeat timeout");
}

// workers.ts - healthCheck query
SELECT * FROM workers
WHERE status IN ('starting', 'running')
AND last_heartbeat < NOW() - INTERVAL '1 second' * $1
```

**Scenario:**
1. Worker sends heartbeat at T=299.9s (threshold=300s)
2. healthCheck runs at T=300.1s, query evaluates at T=300.1s
3. Worker appears stale (300.1 - 299.9 = 0.2s margin error with network latency)
4. But heartbeat UPDATE hasn't committed yet
5. Worker is killed despite being alive

**Fix:**
Add a grace period buffer (e.g., threshold + 30s) or use `SELECT FOR UPDATE SKIP LOCKED` to avoid killing workers with in-flight heartbeats.

---

### 1.3 Queue `getNext` and Spawn Non-Atomic

**Location:** `/Users/skillet/dev/ai/whim/packages/orchestrator/src/index.ts:82-90`
**Type:** Race Condition
**Impact:** Same work item could theoretically be spawned twice (mitigated by DB state)

**Evidence:**
```typescript
while (await workers.hasCapacity()) {
  const workItem = await queue.getNext();  // Gets item + sets 'assigned'
  if (!workItem) break;
  
  // Gap here: workItem is 'assigned' but not yet 'in_progress'
  await workers.spawn(workItem);  // Sets 'in_progress'
}
```

**Why it's mostly safe:** The `FOR UPDATE SKIP LOCKED` in `getNext()` prevents duplicate selection. However, if `spawn()` fails after `getNext()` succeeds, the item stays 'assigned' with no worker.

**Current mitigation:** spawn() rollback logic exists
**Remaining gap:** If orchestrator crashes between getNext() and spawn(), item stays 'assigned' forever

---

### 1.4 Redis Counter Drift for Active Workers

**Location:** `/Users/skillet/dev/ai/whim/packages/orchestrator/src/rate-limits.ts:111-130`
**Type:** Counter Drift
**Impact:** Redis counter could become negative or drift from reality

**Evidence:**
```typescript
async recordWorkerDone(): Promise<void> {
  const count = await this.redis.decr(KEYS.activeWorkers);
  if (count < 0) {
    await this.redis.set(KEYS.activeWorkers, "0");  // Non-atomic fix!
  }
}
```

**Scenario:**
1. Worker A finishes, decr returns -1
2. Worker B finishes concurrently, decr returns -2  
3. Worker A sets to "0"
4. Worker B sets to "0"
5. Now counter is 0 but should still reflect other active workers

**Good News:** Code has `getActiveWorkerCount` callback using DB as source of truth. If configured, this prevents drift.

**Gap:** The Redis counter is still updated (lines 116-119) even when DB callback exists, causing unnecessary drift.

---

## 2. Boundary Conditions

### 2.1 maxIterations = 0 Not Validated

**Location:** `/Users/skillet/dev/ai/whim/packages/orchestrator/src/server.ts:49`
**Type:** Missing Validation
**Impact:** Work item with maxIterations=0 would immediately fail

**Evidence:**
```typescript
if (obj.maxIterations !== undefined && 
    (typeof obj.maxIterations !== "number" || obj.maxIterations < 1)) return false;
```

**This is correct!** The validation rejects `maxIterations < 1`, so 0 is properly rejected.

However, at `/Users/skillet/dev/ai/whim/packages/orchestrator/src/queue.ts:40`:
```typescript
const maxIterations = input.maxIterations ?? 20;
```
If maxIterations passes validation as undefined, it defaults to 20. Safe.

---

### 2.2 Empty Spec Content

**Location:** `/Users/skillet/dev/ai/whim/packages/orchestrator/src/server.ts:47`
**Type:** Validated Correctly
**Evidence:**
```typescript
if (typeof obj.spec !== "string" || obj.spec.length === 0) return false;
```

Empty specs are rejected.

---

### 2.3 Very Long Repo Names / Specs - No Limit

**Location:** `/Users/skillet/dev/ai/whim/packages/orchestrator/src/server.ts:45-50`
**Type:** Missing Validation
**Impact:** Potential DoS via large payloads, DB column overflow

**Evidence:**
```typescript
function isValidAddWorkItemRequest(body: unknown): body is AddWorkItemRequest {
  // ...
  if (typeof obj.repo !== "string" || obj.repo.length === 0) return false;
  if (typeof obj.spec !== "string" || obj.spec.length === 0) return false;
  // No max length checks!
```

**Risk:** 
- 100MB spec content would pass validation
- PostgreSQL TEXT type has no practical limit but could cause memory issues
- Branch name derived from UUID is safe, but custom branch could be long

**Fix:**
```typescript
if (obj.repo.length > 256) return false;
if (obj.spec.length > 1_000_000) return false;  // 1MB limit
if (obj.branch && obj.branch.length > 256) return false;
```

---

### 2.4 Unicode in File Paths (File Locks)

**Location:** `/Users/skillet/dev/ai/whim/packages/orchestrator/src/conflicts.ts`
**Type:** Potential Issue
**Impact:** Unicode normalization could cause lock misses

**Evidence:**
No normalization is performed on file paths:
```typescript
async acquireLocks(workerId: string, files: string[]): Promise<LockResult> {
  // files are used directly in SQL
}
```

**Scenario:**
- Worker A locks `café.ts` (using composed é: U+00E9)
- Worker B requests `café.ts` (using decomposed e + combining acute: U+0065 U+0301)
- These are visually identical but different strings
- Worker B gets the lock, causing conflict

**Fix:** Normalize paths with `filePath.normalize('NFC')` before use.

---

## 3. Timing Issues

### 3.1 Daily Budget Reset at Midnight - Race Condition

**Location:** `/Users/skillet/dev/ai/whim/packages/orchestrator/src/rate-limits.ts:143-157`
**Type:** Race Condition
**Impact:** Double reset could zero out legitimate counts

**Evidence:**
```typescript
async checkDailyReset(): Promise<void> {
  const today = getTodayString();  // YYYY-MM-DD
  const storedDate = await this.redis.get(KEYS.dailyResetDate);

  if (storedDate !== today) {
    // Race: two instances could both see storedDate as yesterday
    await Promise.all([
      this.redis.set(KEYS.dailyIterations, "0"),
      this.redis.set(KEYS.dailyResetDate, today),
    ]);
  }
}
```

**Scenario at midnight:**
1. Orchestrator A: storedDate="2025-01-12", today="2025-01-13", enters reset
2. Orchestrator B: same condition, enters reset
3. A: sets iterations=0, sets date="2025-01-13"
4. Worker completes, increments to 1
5. B: sets iterations=0 (clobbering the 1), sets date="2025-01-13"

**Fix:** Use Redis SETNX or Lua script for atomic check-and-reset.

---

### 3.2 Cooldown Boundary - Potential Off-by-One

**Location:** `/Users/skillet/dev/ai/whim/packages/orchestrator/src/rate-limits.ts:92-98`
**Type:** Timing Edge Case
**Impact:** Could allow spawn 1ms before cooldown ends

**Evidence:**
```typescript
const lastSpawn = await this.getLastSpawn();
if (lastSpawn) {
  const elapsed = (Date.now() - lastSpawn.getTime()) / 1000;
  if (elapsed < this.config.cooldownSeconds) {
    return false;
  }
}
```

**Analysis:** Uses `<` not `<=`, so at exactly cooldownSeconds, spawn is allowed. This is correct behavior (cooldown of 60s means "after 60 seconds").

However, if two orchestrators check at elapsed=59.999s and both return false, then both check again at 60.001s and both return true, you could get double spawn.

**Mitigation:** The lastSpawn timestamp update in recordSpawn() should prevent this, but there's still a TOCTOU window.

---

## 4. Resource Exhaustion

### 4.1 Queue Unbounded Growth

**Location:** `/Users/skillet/dev/ai/whim/packages/orchestrator/src/queue.ts`
**Type:** No Queue Size Limit
**Impact:** Unbounded queue growth could exhaust DB storage

**Evidence:** No max queue size check in `add()`:
```typescript
async add(input: AddWorkItemRequest): Promise<WorkItem> {
  // No check like: if (await this.getQueuedCount() > MAX_QUEUE_SIZE)
}
```

**Risk:** If API is exposed, could be DoS'd by adding millions of work items.

**Fix:** Add queue size limit with configurable max.

---

### 4.2 File Locks Never Released on Crash

**Location:** `/Users/skillet/dev/ai/whim/packages/orchestrator/src/conflicts.ts`
**Type:** Resource Leak
**Impact:** Orphaned locks could permanently block files

**Evidence:** Locks are released in:
- `complete()` - calls `releaseAllLocks`
- `fail()` - calls `releaseAllLocks`  
- `kill()` - calls `releaseAllLocks`

**Gap:** If worker container crashes without calling fail/complete, and orchestrator doesn't run healthCheck (e.g., orchestrator also crashes), locks remain forever.

**Mitigation exists:** healthCheck + kill should clean up stale workers and their locks.

**Remaining gap:** No TTL on locks themselves. If both worker and orchestrator crash, locks persist until manual cleanup.

**Fix:** Add `acquired_at` timestamp check in a cleanup job:
```sql
DELETE FROM file_locks 
WHERE acquired_at < NOW() - INTERVAL '1 hour';
```

---

### 4.3 Database Connection Pool Exhaustion

**Location:** `/Users/skillet/dev/ai/whim/packages/orchestrator/src/db.ts:388-392`
**Type:** Configuration
**Impact:** Under load, could exhaust 20 connections

**Evidence:**
```typescript
return new Database({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

**Analysis:** 
- 20 connections with 2s timeout
- If healthCheck + queue ops + multiple API requests hit simultaneously, pool could be exhausted
- `connectionTimeoutMillis: 2000` means requests fail fast (good)

**Risk is low** for current scale but could become issue with many workers.

---

### 4.4 No Log Rotation / Size Limit

**Location:** `/Users/skillet/dev/ai/whim/packages/orchestrator/src/index.ts:52-54`
**Type:** Resource Exhaustion (Logs)
**Impact:** Console.log could fill disk in production

**Evidence:**
```typescript
function log(message: string, ...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, ...args);
}
```

**Fix:** This is fine if running in Docker with log drivers configured. Otherwise, add log rotation.

---

## 5. Additional Edge Cases

### 5.1 Worker Registration Double-Create Race

**Location:** `/Users/skillet/dev/ai/whim/packages/orchestrator/src/workers.ts:161-206`
**Type:** Race Condition
**Impact:** Could create duplicate worker records

**Evidence:**
```typescript
async register(workItemId: string): Promise<{ worker: Worker; workItem: WorkItem }> {
  // Check if worker already exists
  const existing = await this.db.queryOne<Worker>(
    `SELECT * FROM workers WHERE work_item_id = $1 AND status IN ('starting', 'running')`,
    [workItemId]
  );

  if (existing) {
    // Update existing
  } else {
    // Create new worker
  }
}
```

**Scenario:**
1. Container starts, calls register()
2. Network latency, container retries register()
3. First call: no existing, creates worker-1
4. Second call (racing): no existing yet visible, creates worker-2
5. Two workers for same work item

**Fix:** Use `INSERT ON CONFLICT` or PostgreSQL advisory lock on work_item_id.

---

### 5.2 Stuck Status Never Recovers

**Location:** `/Users/skillet/dev/ai/whim/packages/orchestrator/src/workers.ts:367-391`
**Type:** State Machine Gap
**Impact:** Stuck workers remain stuck forever

**Evidence:**
```typescript
async stuck(workerId: string, reason: string, attempts: number): Promise<void> {
  await this.db.execute(
    `UPDATE workers SET status = 'stuck', error = $2 WHERE id = $1`,
    [workerId, ...]
  );
  // Work item stays 'in_progress' - no status change
}
```

**Gap:** 
- Worker is 'stuck', work item is 'in_progress'
- healthCheck only finds 'starting'/'running' workers
- Stuck workers won't trigger kill -> won't requeue work item
- Manual intervention required

**Fix:** Either:
1. Have stuck trigger requeue (like fail does)
2. Add stuck workers to healthCheck query

---

## Recommendations

### Quick Wins (Low effort, high impact)
1. Add input length validation for repo/spec/branch in `isValidAddWorkItemRequest`
2. Add file path normalization in ConflictDetector
3. Include 'stuck' status in healthCheck query

### Medium-term (Higher effort)  
1. Use atomic Redis operations for daily reset (SETNX or Lua)
2. Add queue size limit
3. Add TTL-based cleanup for file locks

### Architecture Changes
1. Replace Redis counter with pure DB-based active worker count
2. Add PostgreSQL advisory locks for spawn coordination
3. Implement distributed lock for daily reset

---

## Summary Table

| Issue | Type | Severity | Location | Fix Complexity |
|-------|------|----------|----------|----------------|
| TOCTOU in canSpawnWorker | Race | Medium | rate-limits.ts:82 | High |
| Heartbeat/Kill race | Race | Medium | workers.ts:406 | Medium |
| Daily reset race | Race | Low | rate-limits.ts:143 | Medium |
| No input length limits | Validation | Medium | server.ts:45 | Low |
| Unicode path normalization | Edge Case | Low | conflicts.ts | Low |
| Stuck workers don't recover | State Machine | Medium | workers.ts:367 | Low |
| Queue unbounded | DoS | Medium | queue.ts | Low |
| Lock TTL missing | Resource Leak | Low | conflicts.ts | Low |
