# Plan: RateLimiter Class

## Goal
Create `packages/orchestrator/src/rate-limits.ts` with RateLimiter class that manages worker spawn rate limiting and daily iteration budgets.

## Methods Required (from SPEC.md)
- `canSpawnWorker()` - check if spawn allowed (based on cooldown and max workers)
- `recordSpawn()` - record worker spawn timestamp
- `recordWorkerDone()` - record worker completion (decrement active count)
- `recordIteration()` - record iteration for daily budget tracking
- `checkDailyReset()` - reset daily limits at midnight
- `getStatus()` - get current rate limit status

## Implementation Details

### Redis Keys (with factory: prefix)
- `rate:active_workers` - current count of active workers
- `rate:last_spawn` - timestamp of last spawn
- `rate:daily_iterations` - iteration count for today
- `rate:daily_reset_date` - date string for tracking daily reset

### Configuration
- MAX_WORKERS (env, default: 2)
- DAILY_BUDGET (env, default: 200)
- COOLDOWN_SECONDS (env, default: 60)

### Status Response (matches StatusResponse.rateLimits)
```typescript
{
  iterationsToday: number;
  dailyBudget: number;
  lastSpawn: Date | null;
  cooldownSeconds: number;
}
```

## Files to Create/Modify
- CREATE: `packages/orchestrator/src/rate-limits.ts`
- CREATE: `packages/orchestrator/src/rate-limits.test.ts`

## Tests
1. canSpawnWorker returns true when under limits
2. canSpawnWorker returns false during cooldown
3. canSpawnWorker returns false when at max workers
4. canSpawnWorker returns false when daily budget exhausted
5. recordSpawn increments active workers and sets timestamp
6. recordWorkerDone decrements active workers
7. recordIteration increments daily count
8. checkDailyReset resets counters on new day
9. getStatus returns correct values

## Exit Criteria
- TypeScript compiles without errors
- All tests pass
- Integrates with existing RedisClient pattern
