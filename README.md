# AI Software Factory

An autonomous AI development system that takes GitHub issues, converts them to specs, and produces PRs through iterative Claude Code execution.

## Core Philosophy

- **Fresh context per iteration** - State lives in files, not memory
- **Learnings persist** - Knowledge transfers across tasks and workers
- **Single system, any scale** - Handles 1 commit or 50 with the same architecture
- **Local-first** - Docker-based, scales horizontally

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              FACTORY                                     │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                         ORCHESTRATOR                                │ │
│  │  • Queue management (priority-based)                                │ │
│  │  • Worker lifecycle (spawn/kill/health)                             │ │
│  │  • Rate limiting (Claude Max aware)                                 │ │
│  │  • Conflict detection (file locking)                                │ │
│  │  • Metrics collection                                               │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│                    ┌───────────────┼───────────────┐                    │
│                    ▼               ▼               ▼                    │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐        │
│  │     WORKER 1     │ │     WORKER 2     │ │     WORKER N     │        │
│  │  ┌────────────┐  │ │  ┌────────────┐  │ │  ┌────────────┐  │        │
│  │  │   RALPH    │  │ │  │   RALPH    │  │ │  │   RALPH    │  │        │
│  │  │ (core loop)│  │ │  │ (core loop)│  │ │  │ (core loop)│  │        │
│  │  └────────────┘  │ │  └────────────┘  │ │  └────────────┘  │        │
│  │  ┌────────────┐  │ │  ┌────────────┐  │ │  ┌────────────┐  │        │
│  │  │CLAUDE CODE │  │ │  │CLAUDE CODE │  │ │  │CLAUDE CODE │  │        │
│  │  │  + MCPs    │  │ │  │  + MCPs    │  │ │  │  + MCPs    │  │        │
│  │  └────────────┘  │ │  └────────────┘  │ │  └────────────┘  │        │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘        │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                         SHARED STATE                                │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │ │
│  │  │  PostgreSQL  │  │    Redis     │  │     Git      │              │ │
│  │  │  (learnings, │  │   (locks,    │  │   (repos,    │              │ │
│  │  │   metrics)   │  │   pubsub)    │  │  branches)   │              │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

## How It Works

1. **Intake** - GitHub issues labeled `ai-factory` are picked up
2. **Spec Generation** - Issues are converted to SPEC.md (task checklist)
3. **Queue** - Work items are prioritized (critical > high > medium > low)
4. **Worker Spawn** - Orchestrator spawns Docker containers with Claude Code
5. **Execution** - Ralph runs Claude Code in autonomous loops, checking off tasks
6. **Learnings** - Workers save discoveries for future tasks
7. **PR Creation** - Completed work becomes a pull request

## Project Structure

```
factory/
├── packages/
│   ├── orchestrator/     # Central brain - queue, workers, rate limits
│   ├── worker/           # Docker container - runs Ralph + Claude Code
│   ├── intake/           # GitHub adapter - polls issues, generates specs
│   ├── shared/           # Shared types and utilities
│   └── dashboard/        # Web UI for monitoring
├── docker/
│   └── docker-compose.yml
├── migrations/
│   └── 001_initial.sql
├── scripts/
│   ├── setup.sh
│   ├── dev.sh
│   └── migrate.sh
├── SPEC.md               # Factory implementation checklist
└── SPEC-ralph.md         # Ralph CLI implementation checklist
```

## Implementation Specs

| Spec | Description |
|------|-------------|
| **SPEC.md** | Factory infrastructure (orchestrator, workers, intake, dashboard) |
| **SPEC-ralph.md** | Ralph CLI (autonomous Claude Code loop with event contract) |

Ralph and Factory are separate concerns. Factory spawns Ralph and parses its stdout events. See SPEC-ralph.md for the event contract.

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Bun
- GitHub CLI (`gh`)

### Setup

```bash
# Clone and setup
git clone <repo>
cd factory
./scripts/setup.sh

# Edit configuration
cp .env.example .env
# Edit .env with your GITHUB_TOKEN and REPOS

# Start services
bun dev
```

### Manual Work Item

```bash
# Submit work via API
curl -X POST http://localhost:3000/api/work \
  -H "Content-Type: application/json" \
  -d '{
    "source": "api",
    "sourceId": "manual-1",
    "sourceUrl": "https://example.com",
    "repo": "https://github.com/owner/repo.git",
    "spec": "# Task\n\n- [ ] Add hello world endpoint",
    "priority": "medium"
  }'
```

### GitHub Integration

1. Add label `ai-factory` to a GitHub issue
2. Intake service picks it up
3. Generates SPEC.md from issue
4. Queues for processing
5. PR created when complete

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GITHUB_TOKEN` | required | GitHub PAT with repo permissions |
| `REPOS` | required | Comma-separated: `owner/repo1,owner/repo2` |
| `MAX_WORKERS` | `2` | Maximum concurrent workers |
| `DAILY_BUDGET` | `200` | Max iterations per day (Claude Max) |
| `COOLDOWN_SECONDS` | `60` | Seconds between worker spawns |
| `INTAKE_LABEL` | `ai-factory` | GitHub label to watch |
| `POLL_INTERVAL` | `60000` | GitHub poll interval (ms) |

## API Endpoints

### Work Items
- `POST /api/work` - Create work item
- `GET /api/work/:id` - Get work item status
- `POST /api/work/:id/cancel` - Cancel work item

### Workers
- `GET /api/workers` - List all workers
- `POST /api/workers/:id/kill` - Kill worker

### Dashboard
- `GET /api/status` - Factory status overview
- `GET /api/queue` - Queue contents
- `GET /api/metrics` - Performance metrics
- `GET /api/learnings` - Browse learnings

## Worker Protocol

Workers communicate with orchestrator via HTTP:

```
Worker                              Orchestrator
   │                                     │
   ├──── POST /worker/register ─────────►│
   │                                     │
   ├──── POST /worker/:id/heartbeat ────►│  (every iteration)
   │                                     │
   ├──── POST /worker/:id/lock ─────────►│  (before editing files)
   │                                     │
   ├──── POST /worker/:id/complete ─────►│  (on success)
   │  or POST /worker/:id/fail ─────────►│  (on failure)
   │  or POST /worker/:id/stuck ────────►│  (when stuck)
   │                                     │
```

## Learnings System

Workers save discoveries to `.ai/new-learnings.md`:

```markdown
- Pattern: Use `gh pr create --fill` for auto-generated PR descriptions
- Gotcha: TypeScript strict mode requires explicit null checks
- Approach: Run tests after each file change, not at the end
```

Learnings are stored in PostgreSQL with vector embeddings for semantic retrieval. Future workers receive relevant learnings before starting.

## Rate Limiting

The system respects Claude Max rate limits:

- **Concurrent workers**: Limited to prevent overwhelming the API
- **Daily budget**: Caps total iterations per day
- **Cooldown**: Minimum time between worker spawns

## File Locking

When multiple workers run simultaneously, Redis-based file locking prevents conflicts:

1. Worker requests lock before editing
2. If file locked by another worker, conflict is flagged
3. Locks auto-expire after 1 hour
4. Released on worker completion

## Development

```bash
# Build all packages
bun run build

# Run specific package
bun run --filter @factory/orchestrator dev

# Run tests
bun test

# Lint
bun run lint
```

## Monitoring

Dashboard at `http://localhost:3001`:

- **Overview**: Queue depth, active workers, daily usage
- **Workers**: Live status, iterations, kill button
- **Queue**: Pending items, priorities, cancel button
- **Learnings**: Browse and search past discoveries
- **Metrics**: Charts for throughput, success rate, duration

## Troubleshooting

### Worker not spawning
- Check `MAX_WORKERS` limit
- Check `DAILY_BUDGET` not exhausted
- Check `COOLDOWN_SECONDS` timer

### Worker stuck
- Check orchestrator logs for heartbeat gaps
- Workers auto-killed after 2 minutes without heartbeat
- Check `.ai/stuck.md` in workspace for worker's explanation

### File conflicts
- Two workers editing same file
- Check Redis for active locks: `redis-cli keys "lock:*"`
- Consider increasing task granularity

## License

MIT
