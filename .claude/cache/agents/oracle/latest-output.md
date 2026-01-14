# Research Report: Job Queue and Orchestration Libraries for Node.js/TypeScript

Generated: 2026-01-13

## Summary

BullMQ is the strongest candidate for whim's needs - it provides built-in rate limiting, priority queues, stalled job detection, and is actively maintained. However, whim's current custom implementation already handles Docker container workers well, and BullMQ's workers model assumes long-running Node processes, not single-use containers. A hybrid approach using BullMQ for queue management while keeping custom Docker orchestration may be optimal.

## Questions Answered

### Q1: How does BullMQ handle worker pools?
**Answer:** BullMQ supports two concurrency models: (1) Local concurrency via a `concurrency` option on workers (e.g., `{ concurrency: 50 }`), and (2) Multiple workers across Node processes. Workers are assumed to be persistent Node.js processes, not single-use containers.
**Source:** https://docs.bullmq.io/guide/workers/concurrency
**Confidence:** High

### Q2: Does BullMQ support rate limiting (max concurrent, cooldowns)?
**Answer:** Yes. BullMQ has built-in global rate limiting: `{ limiter: { max: 10, duration: 1000 } }` limits to 10 jobs per second across all workers. Rate-limited jobs stay in "waiting" state. Group-based rate limiting was removed in v3.0.
**Source:** https://docs.bullmq.io/guide/rate-limiting
**Confidence:** High

### Q3: Priority queues?
**Answer:** Yes. Jobs can have priorities 1-2,097,152 (lower = higher priority). Jobs without priority are processed first. Adding prioritized jobs is O(log n).
**Source:** https://docs.bullmq.io/guide/jobs/prioritized
**Confidence:** High

### Q4: Can workers be Docker containers?
**Answer:** Not natively. BullMQ assumes workers are persistent Node processes. Sandboxed processors run in separate processes but still via Node's child_process. For Docker containers, you would need custom orchestration to spawn containers that connect back to the queue.
**Source:** https://docs.bullmq.io/guide/workers/sandboxed-processors
**Confidence:** High

### Q5: What does "stalled job detection" look like?
**Answer:** Workers periodically renew locks on jobs. If a worker fails to renew within `stalledInterval` (configurable), the job is marked "stalled" and moved back to waiting (or failed if max stalls exceeded). This happens automatically when CPU-bound work blocks the event loop.
**Source:** https://docs.bullmq.io/guide/workers/stalled-jobs
**Confidence:** High

### Q6: Is Temporal.io overkill for simple job queues?
**Answer:** Yes for whim's use case. Temporal is a distributed workflow engine designed for complex, long-running workflows with retries, timeouts, and saga patterns. It requires running Temporal Server (Go-based), history service, and workers. Operational overhead is significant.
**Source:** https://docs.temporal.io/develop/typescript/core-application
**Confidence:** High

## Detailed Findings

### Finding 1: BullMQ Feature Overview

**Source:** https://github.com/taskforcesh/bullmq (8,235 stars)

**Key Points:**
- Redis-based (or Dragonfly-compatible)
- Actively maintained (updated 2026-01-14)
- Used by Microsoft, NestJS, Novu, Infisical
- TypeScript native with full types
- Supports: rate limiting, priorities, delayed jobs, retries, sandboxed processors
- Has Python and Elixir SDKs for polyglot environments

**Code Example - Rate Limited Worker:**
```typescript
import { Queue, Worker } from 'bullmq';

const queue = new Queue('tasks', { connection: redisConfig });

// Add prioritized job
await queue.add('process', { data: 'value' }, { priority: 5 });

// Worker with rate limiting
const worker = new Worker('tasks', async (job) => {
  await processJob(job.data);
}, {
  connection: redisConfig,
  concurrency: 5,
  limiter: {
    max: 10,       // 10 jobs max
    duration: 1000 // per second
  }
});

// Listen for stalled jobs
worker.on('stalled', (jobId) => {
  console.log(`Job ${jobId} stalled`);
});
```

### Finding 2: pg-boss (PostgreSQL-Based Alternative)

**Source:** https://github.com/timgit/pg-boss (3,089 stars)

**Key Points:**
- PostgreSQL-native using SKIP LOCKED
- Exactly-once delivery
- Jobs can be created within existing database transactions
- Supports: priorities, dead letter queues, cron scheduling, retries
- No Redis dependency
- Multi-master compatible (K8s ReplicaSet friendly)

**Advantages for whim:**
- Already using PostgreSQL
- Jobs can share transaction context with work items
- Simpler infra (no Redis needed for queue)

**Code Example:**
```typescript
const { PgBoss } = require('pg-boss');
const boss = new PgBoss('postgres://user:pass@host/database');

await boss.start();
await boss.createQueue('worker-tasks');

// Add job with priority
await boss.send('worker-tasks', { workItemId: 'abc' }, {
  priority: 10,
  retryLimit: 3,
  retryDelay: 60
});

// Work with concurrency control
await boss.work('worker-tasks', { batchSize: 5 }, async ([job]) => {
  await processWorkItem(job.data.workItemId);
});
```

### Finding 3: Agenda (MongoDB-Based)

**Source:** https://github.com/agenda/agenda (9,595 stars)

**Key Points:**
- MongoDB-backed
- Cron/human-readable scheduling
- Concurrency control per job type
- Touch() for progress updates (heartbeat-like)
- Has REST API and web UI (Agendash)

**Drawback:** Requires MongoDB, adding infrastructure complexity.

### Finding 4: Bee-Queue

**Source:** https://github.com/bee-queue/bee-queue (4,005 stars)

**Key Points:**
- Simpler than Bull/BullMQ
- Optimized for "messages" more than "jobs"
- No rate limiting built-in
- Less active development

**Not recommended** for whim - lacks features needed.

## Comparison Matrix

| Feature | BullMQ | pg-boss | Agenda | Whim Custom |
|---------|--------|---------|--------|-------------|
| **Backend** | Redis | PostgreSQL | MongoDB | PostgreSQL + Redis |
| **Rate Limiting** | Built-in | Via concurrency | Limited | Custom |
| **Priority Queues** | Yes (2M levels) | Yes | Yes | Yes (4 levels) |
| **Stalled Detection** | Built-in | Via expiration | Via locking | Custom (heartbeat) |
| **Docker Workers** | No (needs wrapper) | No | No | Yes |
| **File Locking** | No | No | No | Yes (custom) |
| **Daily Budgets** | No | No | No | Yes (Redis-based) |
| **Cooldowns** | Partial (rate limit) | No | No | Yes |
| **Stars** | 8.2k | 3.1k | 9.6k | N/A |
| **TypeScript** | Native | Native | Rewrite | Native |
| **Active** | Very | Yes | Yes | N/A |

## Recommendations

### For This Codebase (whim)

**Recommendation: Keep custom orchestration, consider pg-boss for queue**

1. **Keep WorkerManager**: whim's Docker container spawning, heartbeat, and lifecycle management is well-designed and handles the single-use container model that BullMQ cannot.

2. **Keep RateLimiter**: The custom rate limiter handles daily budgets and cooldowns that no library provides out-of-box.

3. **Consider pg-boss for QueueManager**: 
   - Already using PostgreSQL
   - SKIP LOCKED is more efficient than polling
   - Transactional job creation (add work item + queue job atomically)
   - Built-in retries, priorities, dead letter queues

4. **Alternative: BullMQ for queue only**:
   - If Redis is staying anyway, BullMQ queue is solid
   - Use BullMQ for queue management, custom code for Docker spawning
   - Pattern: BullMQ job triggers custom Docker spawn, container reports back via API

### Hybrid Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Orchestrator                          │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  BullMQ or   │  │   Custom     │  │    Custom        │  │
│  │  pg-boss     │──│   Worker     │──│    Rate          │  │
│  │  Queue       │  │   Manager    │  │    Limiter       │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│         │                  │                   │            │
│         │         ┌───────┴────────┐          │            │
│         │         │  Docker API    │          │            │
│         │         └───────┬────────┘          │            │
└─────────┼─────────────────┼───────────────────┼────────────┘
          │                 │                   │
    ┌─────┴─────┐    ┌─────┴─────┐       ┌─────┴─────┐
    │  Redis/   │    │  Worker   │       │  Redis    │
    │  Postgres │    │  Container│       │  Counters │
    └───────────┘    └───────────┘       └───────────┘
```

### Implementation Notes

**If adopting BullMQ:**
```typescript
// Use BullMQ for queue, custom logic for spawn
const queue = new Queue('work-items');
const worker = new Worker('work-items', async (job) => {
  // Don't process here - just trigger Docker spawn
  const { workItemId } = job.data;
  await workerManager.spawn(workItemId);
  // Job completes when spawn succeeds
  // Actual work completion reported via /complete endpoint
}, { concurrency: config.maxWorkers });
```

**If adopting pg-boss:**
```typescript
// Consolidate on PostgreSQL
const boss = new PgBoss(databaseUrl);
await boss.start();

// Work items and queue in same transaction
await db.transaction(async (client) => {
  const workItem = await insertWorkItem(client, spec);
  await boss.send('work-items', { id: workItem.id }, {
    priority: priorityToNumber(spec.priority)
  });
});
```

### What NOT to Change

1. **ConflictDetector**: File-level locking is unique to whim's needs
2. **RateLimiter's daily budget**: Not available in any library
3. **Docker orchestration**: BullMQ/pg-boss can't manage containers
4. **Heartbeat mechanism**: Keep - libraries assume persistent workers

### Migration Path

If deciding to adopt a library:

1. **Phase 1**: Add BullMQ/pg-boss alongside existing QueueManager
2. **Phase 2**: Migrate getNext() to library's work distribution
3. **Phase 3**: Remove custom SKIP LOCKED logic
4. **Phase 4**: Evaluate if Redis can be dropped (pg-boss only)

## Sources

1. [BullMQ Documentation](https://docs.bullmq.io) - Official docs
2. [BullMQ GitHub](https://github.com/taskforcesh/bullmq) - 8.2k stars, very active
3. [pg-boss GitHub](https://github.com/timgit/pg-boss) - 3.1k stars, PostgreSQL native
4. [Agenda GitHub](https://github.com/agenda/agenda) - 9.6k stars, MongoDB-based
5. [Bee-Queue GitHub](https://github.com/bee-queue/bee-queue) - 4k stars, simpler
6. [Temporal.io Docs](https://docs.temporal.io) - Workflow engine (overkill for this use case)

## Open Questions

- Does whim need Redis long-term? If pg-boss is adopted, Redis could be eliminated
- Is the 60-second cooldown between spawns still necessary with proper rate limiting?
- Could BullMQ Pro's "Groups" feature help with per-repo rate limiting?
