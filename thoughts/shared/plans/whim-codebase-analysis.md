# Whim Codebase Analysis
Created: 2025-01-13
Author: architect-agent

## Executive Summary

**Whim** is an autonomous AI development system that transforms GitHub issues into pull requests using Claude Code. It polls GitHub for labeled issues, converts them to specs, queues work items, spawns Docker workers running Claude Code autonomously, and produces PRs.

---

## 1. What Does This Project Do?

### Core Mission
Whim automates the software development lifecycle:
1. **Issue Intake**: Poll GitHub repos for issues labeled `whim`
2. **Spec Generation**: Convert issues to structured SPEC.md checklists via Claude API
3. **Work Queue**: Priority-ordered queue with PostgreSQL persistence
4. **Worker Spawning**: Docker containers running "Ralph" (Claude Code in autonomous mode)
5. **PR Creation**: Workers complete specs, run tests, and create PRs
6. **Learnings**: Workers share discoveries via vector embeddings for future tasks

### Key Value Proposition
- No human intervention from issue creation to PR
- Parallel workers for concurrent development
- Rate limiting respects Claude Max API limits
- File locking prevents worker conflicts
- Learnings persist across tasks for improved performance

---

## 2. Architecture Overview

### Package Structure

```
whim/
├── packages/
│   ├── orchestrator/   # Central brain - queue, workers, rate limits
│   ├── worker/         # Docker container - runs Ralph + Claude Code
│   ├── intake/         # GitHub adapter - polls issues, generates specs
│   ├── shared/         # Shared types and utilities
│   └── dashboard/      # Next.js monitoring UI
├── docker/
│   └── docker-compose.yml
├── migrations/
│   └── 001_initial.sql  # PostgreSQL + pgvector schema
└── scripts/
    ├── setup.sh
    ├── dev.sh
    └── migrate.sh
```

### Component Responsibilities

| Package | Purpose | Key Files |
|---------|---------|-----------|
| `@whim/orchestrator` | Central coordinator | workers.ts, queue.ts, rate-limits.ts, server.ts |
| `@whim/worker` | Claude Code execution | ralph.ts, setup.ts, client.ts, learnings.ts |
| `@whim/intake` | GitHub polling + spec gen | github.ts, spec-gen.ts, ralph-spec-gen.ts |
| `@whim/shared` | Types + utilities | types.ts |
| `@whim/dashboard` | Monitoring UI | Next.js 14+ app |

### Data Flow

```
┌─────────────┐     ┌─────────────┐     ┌───────────────┐
│   GitHub    │────▶│   Intake    │────▶│ Orchestrator  │
│   Issues    │     │  (polling)  │     │    (queue)    │
└─────────────┘     └─────────────┘     └───────┬───────┘
                                                │
                    ┌───────────────────────────┼────────────────────────────┐
                    ▼                           ▼                            ▼
            ┌───────────────┐           ┌───────────────┐            ┌───────────────┐
            │   Worker 1    │           │   Worker 2    │            │   Worker N    │
            │    (Ralph)    │           │    (Ralph)    │            │    (Ralph)    │
            │   └─Claude    │           │   └─Claude    │            │   └─Claude    │
            └───────┬───────┘           └───────┬───────┘            └───────┬───────┘
                    │                           │                            │
                    └───────────────────────────┼────────────────────────────┘
                                                ▼
                                        ┌───────────────┐
                                        │  GitHub PRs   │
                                        │  (Closes #N)  │
                                        └───────────────┘
```

### Communication Patterns

1. **Intake -> Orchestrator**: HTTP POST `/api/work` with generated spec
2. **Orchestrator -> Worker**: Docker spawn with env vars (WORK_ITEM JSON)
3. **Worker -> Orchestrator**: HTTP heartbeats, locks, completion/failure
4. **Worker -> Ralph**: Spawns `ralph` CLI subprocess, parses JSON stdout events
5. **Dashboard -> Orchestrator**: Proxy API calls for monitoring

---

## 3. The Orchestrator Deep Dive

### Core Components

#### WorkerManager (`workers.ts`)
- **Spawns Docker containers** via Dockerode library
- **Manages lifecycle**: starting -> running -> completed/failed/stuck/killed
- **Handles registration**: Workers self-register after container starts
- **Heartbeat monitoring**: Updates last_heartbeat, tracks iterations
- **Health checks**: Finds stale workers (no heartbeat in N seconds)
- **Kill logic**: Stops container, updates status, releases locks

Key method: `spawn(workItem)`:
```typescript
const container = await this.docker.createContainer({
  Image: "whim-worker:latest",
  Env: [
    `WORKER_ID=${workerId}`,
    `WORK_ITEM=${JSON.stringify(workItem)}`,
    `ORCHESTRATOR_URL=http://host.docker.internal:3000`,
    `GITHUB_TOKEN=...`,
    `ANTHROPIC_API_KEY=...`,
  ],
  HostConfig: {
    NetworkMode: "whim-network",
  },
});
await container.start();
```

#### QueueManager (`queue.ts`)
- **Priority-based ordering**: critical > high > medium > low
- **Concurrent-safe dequeue**: Uses `FOR UPDATE SKIP LOCKED`
- **Atomic status transitions**: queued -> assigned -> in_progress
- **Queue statistics**: Counts by status and priority

#### RateLimiter (`rate-limits.ts`)
- **Worker limits**: MAX_WORKERS concurrent containers
- **Cooldown**: COOLDOWN_SECONDS between spawns
- **Daily budget**: DAILY_BUDGET iterations per day
- **Redis-backed**: Atomic counters, daily reset logic

#### ConflictDetector (`conflicts.ts`)
- **File locking**: Workers request locks before editing
- **Redis-based**: Fast atomic lock operations
- **Auto-expiry**: 1-hour TTL prevents deadlocks
- **Release on completion**: All locks freed when worker finishes

#### Server (`server.ts`)
- **Express HTTP API**: 16+ endpoints
- **Worker protocol**: /register, /heartbeat, /lock, /unlock, /complete, /fail, /stuck
- **Management**: /workers, /workers/:id/kill
- **Queue ops**: /work, /work/:id, /work/:id/cancel
- **Status**: /status, /queue, /metrics, /learnings, /health

---

## 4. Technology Stack

### Languages & Runtimes
| Layer | Technology |
|-------|------------|
| Primary language | TypeScript (ES modules) |
| Build tool | Bun + tsc |
| Monorepo | Turbo (turbo.json) |
| Package manager | Bun workspaces |

### Infrastructure
| Component | Technology |
|-----------|------------|
| Database | PostgreSQL 16 + pgvector |
| Cache/Locks | Redis 7 |
| Containers | Docker + Docker Compose |
| Networking | Docker bridge network |

### Key Libraries
| Library | Used For |
|---------|----------|
| `dockerode` | Docker container management |
| `express` | HTTP API server |
| `pg` | PostgreSQL client |
| `ioredis` | Redis client |
| `@octokit/rest` | GitHub API |
| `@anthropic-ai/sdk` | Claude API (spec generation, reviews) |
| `uuid` | ID generation |
| `supertest` | API testing |

### External Dependencies
| Service | Purpose |
|---------|---------|
| Claude API | Spec generation, code review |
| Claude Code CLI | Autonomous coding in workers |
| Ralph CLI | Claude Code wrapper with task loop |
| GitHub CLI (`gh`) | PR creation |
| GitHub API | Issue polling, labels |

---

## 5. Custom vs Library Code Analysis

### Heavily Custom-Built (Potential for Existing Solutions)

#### 1. Worker Pool / Job Queue System
**Current**: Custom WorkerManager + QueueManager + RateLimiter

**What's built**:
- Priority queue with PostgreSQL
- Worker lifecycle management
- Heartbeat monitoring
- File locking
- Rate limiting

**Existing alternatives**:
| Library | Notes |
|---------|-------|
| **BullMQ** | Redis-based, priority queues, rate limiting, worker pools |
| **Temporal.io** | Workflow orchestration, durable execution, worker management |
| **Quirrel** | TypeScript-first job queue |
| **Graphile Worker** | PostgreSQL-based, good if already using Postgres |
| **pg-boss** | PostgreSQL job queue with priorities |

**Recommendation**: BullMQ or Temporal would replace most of the orchestrator. However, the Docker spawning is unique to this use case.

#### 2. Docker Container Spawning
**Current**: Custom Dockerode wrapper in workers.ts

**What's built**:
- Container creation with env vars
- Network configuration
- Container lifecycle (start, stop)

**Existing alternatives**:
| Library | Notes |
|---------|-------|
| **Kubernetes Jobs** | If deploying to K8s |
| **AWS ECS/Fargate** | Managed container orchestration |
| **Nomad** | HashiCorp's container orchestrator |

**Reality check**: Dockerode is the standard library for this. The wrapper is necessary for the specific env var injection pattern.

#### 3. Rate Limiting
**Current**: Custom Redis counters + daily reset

**Existing alternatives**:
| Library | Notes |
|---------|-------|
| **BullMQ** | Built-in rate limiting per queue |
| **rate-limiter-flexible** | Redis/Postgres backends, many algorithms |
| **@upstash/ratelimit** | Serverless-friendly |

#### 4. File Locking / Conflict Detection
**Current**: Custom Redis-based file locks

**Existing alternatives**:
| Library | Notes |
|---------|-------|
| **Redlock** | Distributed locks on Redis |
| **@sesamecare-oss/redlock** | Modern Redlock implementation |

**Note**: The current implementation is simple and works. Redlock adds more safety guarantees for distributed scenarios.

#### 5. Spec Generation from Issues
**Current**: Anthropic SDK with custom prompt

**Reality check**: This is a value-add custom feature. No off-the-shelf solution for "GitHub issue -> task spec" exists. The prompt engineering is domain-specific.

### Well-Chosen Libraries (Keep As-Is)

| Component | Library | Assessment |
|-----------|---------|------------|
| HTTP server | Express | Standard, appropriate |
| PostgreSQL | pg | Standard |
| Redis | ioredis | Standard |
| GitHub | @octokit/rest | Standard |
| Claude | @anthropic-ai/sdk | Standard |
| Docker | Dockerode | Standard |
| Testing | Bun test / Vitest | Appropriate |

---

## 6. Worker Spawning/Management Logic

### Detailed Flow

```
1. TRIGGER: Queue has items AND capacity available
   ├── hasCapacity() checks:
   │   ├── Active workers < MAX_WORKERS
   │   ├── Cooldown elapsed since last spawn
   │   └── Daily iteration budget not exhausted
   │
2. SPAWN: WorkerManager.spawn(workItem)
   ├── Create worker record in PostgreSQL (status: 'starting')
   ├── Update work item (status: 'in_progress', worker_id)
   ├── Create Docker container with:
   │   ├── WORKER_ID, WORK_ITEM (JSON), ORCHESTRATOR_URL
   │   ├── GITHUB_TOKEN, ANTHROPIC_API_KEY
   │   └── Network: whim-network
   ├── Start container
   ├── Update worker with container_id
   └── Record spawn with rate limiter
   │
3. WORKER EXECUTION (inside container):
   ├── Worker starts, reads env vars
   ├── setupWorkspace(): Clone repo, checkout branch, write SPEC.md
   ├── verifyGitAuth(): Ensure push access before doing work
   ├── loadLearnings(): Fetch relevant past learnings
   ├── runRalph(): Spawn ralph CLI, parse JSON events
   │   ├── On 'iteration': heartbeat to orchestrator
   │   ├── On 'tool': heartbeat + file lock if write
   │   ├── On 'commit': incremental push to origin
   │   ├── On 'complete': success
   │   └── On 'failed'/'stuck': failure/stuck
   ├── runTests(): Validate tests pass
   ├── reviewPullRequest(): AI code review
   ├── createPullRequest(): Push branch, gh pr create
   └── client.complete(): Report success to orchestrator
   │
4. COMPLETION: WorkerManager.complete(workerId, data)
   ├── Update worker status to 'completed'
   ├── Update work item with PR URL
   ├── Save PR review to database
   ├── Release all file locks
   ├── Record metrics
   └── Decrement active worker count
   │
5. HEALTH CHECK (periodic):
   ├── healthCheck(): Find workers with stale heartbeat
   └── kill(): Stop container, release locks, requeue or fail
```

### Key Insights

1. **Single-use containers**: Each worker handles one work item, then exits
2. **State in files**: SPEC.md checkboxes track progress, survives restarts
3. **Heartbeat-based health**: Workers ping every tool call, stale = killed
4. **Incremental push**: Commits pushed after each Ralph commit (no lost work)
5. **Two-phase flow**: Ralph does the work, worker handles infrastructure

---

## 7. Potential Improvements

### High-Impact Substitutions

| Current | Replacement | Benefit |
|---------|-------------|---------|
| Custom queue + worker pool | **BullMQ** | Battle-tested, built-in rate limiting, retries, delays |
| Custom file locking | **Redlock** | Proper distributed lock algorithm |
| Polling for work | **Redis pub/sub** | Instant work dispatch, no polling delay |

### Architecture Considerations

1. **BullMQ + Docker Hybrid**:
   - Use BullMQ for the queue and rate limiting
   - Keep custom Docker spawning (unique to this use case)
   - BullMQ worker processor triggers Docker container spawn

2. **Temporal.io for Full Orchestration**:
   - Replace everything with Temporal workflows
   - Worker activities for Docker spawning
   - Built-in retries, timeouts, state persistence
   - Overkill if current simplicity is working

3. **Kubernetes Path** (if scaling needed):
   - Replace Docker spawning with K8s Jobs
   - Use K8s native resource limits
   - Horizontal pod autoscaling

### What to Keep

- **Ralph integration**: The Claude Code wrapper with headless mode is valuable
- **Spec generation**: Domain-specific, no replacement
- **Learnings system**: Vector embeddings for semantic search is custom value-add
- **GitHub integration**: Standard Octokit usage is correct

---

## 8. Summary Assessment

### Strengths
- Clean separation of concerns (orchestrator/worker/intake)
- Well-designed worker protocol (heartbeat, locks, completion)
- Robust error handling (retry on transient failures, incremental push)
- Good observability (metrics, dashboard, PR reviews)

### Areas for Improvement
- Job queue could use existing library (BullMQ)
- Rate limiting is reinvented (could use BullMQ or rate-limiter-flexible)
- File locking is simplified (Redlock for proper distributed locks)
- Health checking is polling-based (could use container events)

### Verdict
The system is well-architected for its purpose. The custom code is justified for:
- Docker spawning with specific env injection
- Ralph integration (unique to this project)
- Spec generation prompts
- Learnings system

Consider replacing only if:
- Scale requires battle-tested queue (BullMQ)
- Multi-node deployment needs proper distributed locks (Redlock)
- Moving to Kubernetes (K8s Jobs replace Docker spawning)
