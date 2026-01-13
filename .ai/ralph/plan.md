# Plan: Phase 4.5 - Orchestrator Entry Point and Dockerfile

## Goal

Complete the orchestrator package by implementing:
1. `src/index.ts` - Entry point that initializes all components and runs the main loop
2. `Dockerfile` - Container build for the orchestrator service

## Files to Create/Modify

### src/index.ts - Entry Point

**Responsibilities:**
- Initialize Database and Redis clients
- Create all component instances (QueueManager, RateLimiter, ConflictDetector, WorkerManager, MetricsCollector)
- Create and start the Express server
- Run main loop with:
  - Check for worker capacity
  - Get next queued work item
  - Spawn workers for available items
  - Run health checks on existing workers
  - Sleep between iterations

**Structure:**
```typescript
// Configuration from environment
const config = {
  port: process.env.PORT ?? 3000,
  loopIntervalMs: parseInt(process.env.LOOP_INTERVAL_MS ?? "5000", 10),
};

// Initialize clients
const db = createDatabase();
const redis = createRedisClient();

// Initialize components
const queue = new QueueManager(db);
const rateLimiter = new RateLimiter(redis);
const conflicts = new ConflictDetector(db);
const docker = new Docker();
const workers = new WorkerManager(db, rateLimiter, conflicts, docker);
const metrics = new MetricsCollector(db);

// Create server
const app = createServer({ queue, workers, conflicts, rateLimiter, metrics });

// Main loop
async function runMainLoop() {
  while (true) {
    // 1. Check for stale workers
    const stale = await workers.healthCheck();
    for (const w of stale) await workers.kill(w.id, "heartbeat timeout");

    // 2. Check capacity and spawn workers for queued items
    while (await workers.hasCapacity()) {
      const workItem = await queue.getNext();
      if (!workItem) break;
      await workers.spawn(workItem);
    }

    // 3. Sleep
    await sleep(config.loopIntervalMs);
  }
}

// Start
async function main() {
  await db.connect();
  await redis.connect();
  app.listen(config.port, () => console.log(`Orchestrator listening on :${config.port}`));
  runMainLoop().catch(console.error);
}

main().catch(console.error);
```

### Dockerfile

Based on Bun runtime for consistency with monorepo:
```dockerfile
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared ./packages/shared
COPY packages/orchestrator ./packages/orchestrator
RUN bun install --frozen-lockfile
RUN bun run build --filter=@factory/orchestrator

FROM oven/bun:1
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/orchestrator/dist ./packages/orchestrator/dist
COPY --from=builder /app/packages/orchestrator/package.json ./packages/orchestrator/
WORKDIR /app/packages/orchestrator
CMD ["bun", "run", "start"]
```

## Tests

No new tests needed for index.ts (integration-level, tested via docker-compose in Phase 10).

## Exit Criteria

- [ ] `src/index.ts` initializes DB, Redis, all components, starts server, runs main loop
- [ ] `Dockerfile` builds and runs the orchestrator
- [ ] `bun run build` succeeds
- [ ] `bun run typecheck` succeeds
- [ ] Existing tests still pass
