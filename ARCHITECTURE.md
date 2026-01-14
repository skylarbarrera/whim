# Whim Architecture

Whim is an autonomous AI development system that transforms GitHub issues into pull requests.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│    GitHub                                                                   │
│    ┌──────┐                                                                │
│    │Issues│ ◄─────────────────────────────────────────────────┐            │
│    └──┬───┘                                                   │            │
│       │ polls (whim label)                                    │ creates    │
│       ▼                                                       │            │
│    ┌──────────┐         ┌──────────────┐         ┌────────┐  │            │
│    │  Intake  │────────►│ Orchestrator │────────►│ Worker │──┘            │
│    └──────────┘ queue   └──────────────┘ spawn   └────────┘               │
│                              │    ▲                   │                    │
│                         HTTP │    │ heartbeat         │ runs               │
│                              ▼    │                   ▼                    │
│                         ┌────────────┐          ┌─────────┐               │
│                         │ PostgreSQL │          │  Ralph  │               │
│                         │   + Redis  │          │ (Claude)│               │
│                         └────────────┘          └─────────┘               │
│                                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Components

### Intake (`packages/intake`)
- Polls GitHub for issues labeled `whim`
- Generates structured specs from issue descriptions using Claude
- Queues work items with the orchestrator

### Orchestrator (`packages/orchestrator`)
- Central brain managing the work queue and worker lifecycle
- **Queue Manager**: Priority-based work queue with PostgreSQL persistence
- **Worker Manager**: Spawns Docker containers, tracks heartbeats, handles failures
- **Rate Limiter**: Enforces max workers, cooldowns, daily iteration budgets
- **Conflict Detector**: File-level locking to prevent concurrent edits

### Worker (`packages/worker`)
- Runs inside Docker container with isolated environment
- Clones target repo, writes SPEC.md
- Spawns Ralph (Claude Code in autonomous mode)
- Reports progress via heartbeats, creates PR on completion

### Dashboard (`packages/dashboard`)
- Next.js monitoring UI
- Shows queue status, worker activity, metrics

## Data Flow

1. **Issue Detection**: Intake polls GitHub, finds labeled issues
2. **Spec Generation**: Claude converts issue to structured SPEC.md checklist
3. **Queueing**: Work item added to PostgreSQL queue with priority
4. **Scheduling**: Orchestrator checks capacity, assigns next queued item
5. **Execution**: Docker container spawns, worker clones repo and runs Ralph
6. **Progress**: Worker sends heartbeats on each Claude tool call
7. **Completion**: Worker creates PR, reports success, container exits
8. **Cleanup**: Orchestrator releases locks, updates metrics

## Key Design Decisions

### Why Docker Containers for Workers?
- **Isolation**: Each task runs in clean environment
- **Security**: Limited access to host, resource limits enforced
- **Reproducibility**: Same image, same behavior
- **Cleanup**: Container exit = full cleanup

### Why PostgreSQL for Queue?
- **ACID**: Transactions ensure work items aren't lost or duplicated
- **FOR UPDATE SKIP LOCKED**: Safe concurrent access without lock contention
- **Persistence**: Survives orchestrator restarts
- **Queryable**: Easy monitoring and debugging

### Why Redis for Rate Limiting?
- **Atomic operations**: INCR/DECR for counters
- **Fast**: Sub-millisecond latency
- **TTL**: Automatic expiration for cooldowns
- Note: Active worker count is derived from PostgreSQL (source of truth)

### Why Heartbeats?
- **Liveness**: Detect stuck/crashed workers
- **Progress**: Track iteration count
- **Conflict detection**: File locks tied to active workers

## Security Model

### API Authentication
- `API_KEY` environment variable enables authentication
- `X-API-Key` header or `Authorization: Bearer <key>`
- Health endpoint exempt (for load balancers)
- Worker endpoints exempt (use WORKER_ID)

### Container Security
- Resource limits: 4GB memory, 2 CPU cores, 256 PIDs
- Non-root user inside container
- Network isolation via `whim-network`
- No host volume mounts (except workspace)

### Input Validation
- Repo format validated: `owner/repo` pattern
- Length limits on repo, branch, spec
- Request body size limit: 1MB

## Failure Handling

### Worker Failures
- **Heartbeat timeout**: Worker killed, work item requeued with backoff
- **Container crash**: Detected by health check, same as timeout
- **Max iterations**: Work item marked failed after 3 retries

### Orchestrator Failures
- **Restart**: Picks up where it left off (queue in PostgreSQL)
- **Stale workers**: Health check finds and kills them

### Database Failures
- Connection pool with timeouts
- Spawn rollback on failure (delete worker, reset work item)

## Rate Limiting

| Limit | Default | Purpose |
|-------|---------|---------|
| Max Workers | 2 | Concurrent workers |
| Cooldown | 60s | Seconds between spawns |
| Daily Budget | 200 | Max iterations per day |
| Max Retries | 3 | Retries before permanent failure |

Exponential backoff: 1 min → 5 min → 30 min

## File Structure

```
packages/
├── orchestrator/     # Central coordinator
│   └── src/
│       ├── index.ts      # Main loop
│       ├── server.ts     # Express API
│       ├── queue.ts      # Work queue
│       ├── workers.ts    # Worker lifecycle
│       ├── rate-limits.ts # Rate limiting
│       └── conflicts.ts  # File locks
├── worker/           # Task executor
│   └── src/
│       ├── index.ts      # Worker entry
│       ├── ralph.ts      # Claude runner
│       └── setup.ts      # Repo setup
├── intake/           # GitHub poller
├── shared/           # Shared types
└── dashboard/        # Monitoring UI
```

## API Endpoints

### Queue Management
- `POST /api/work` - Add work item
- `GET /api/work/:id` - Get work item
- `DELETE /api/work/:id` - Cancel work item
- `GET /api/queue` - List queue
- `GET /api/queue/stats` - Queue statistics

### Worker Protocol
- `POST /api/worker/register` - Worker self-registration
- `POST /api/worker/:id/heartbeat` - Progress update
- `POST /api/worker/:id/lock` - Acquire file locks
- `POST /api/worker/:id/unlock` - Release file locks
- `POST /api/worker/:id/complete` - Report success
- `POST /api/worker/:id/fail` - Report failure

### Monitoring
- `GET /health` - Health check
- `GET /api/workers` - List workers
- `GET /api/workers/stats` - Worker statistics
- `GET /api/metrics` - System metrics
