# Whim

An autonomous AI development system that takes GitHub issues, converts them to specs, and produces PRs through iterative Claude Code execution.

## Features (v1)

- **GitHub Issue → PR Pipeline** - Label an issue `whim`, get a PR back
- **Issue Linking** - PRs reference source issues with `Closes #N` for auto-close on merge
- **Parallel Workers** - Run multiple Claude Code instances simultaneously
- **Learnings System** - Workers share discoveries across tasks via vector embeddings
- **Rate Limiting** - Respects Claude Max limits with daily budgets and cooldowns
- **File Locking** - Prevents conflicts when workers touch the same files
- **Real-time Dashboard** - Monitor queue, workers, and metrics

## Core Philosophy

- **Fresh context per iteration** - State lives in files, not memory
- **Learnings persist** - Knowledge transfers across tasks and workers
- **Single system, any scale** - Handles 1 commit or 50 with the same architecture
- **Local-first** - Docker-based, scales horizontally

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              WHIM                                     │
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

1. **Intake** - GitHub issues labeled `whim` are picked up
2. **Spec Generation** - Issues are converted to SPEC.md (task checklist)
3. **Queue** - Work items are prioritized (critical > high > medium > low)
4. **Worker Spawn** - Orchestrator spawns Docker containers with Claude Code
5. **Execution** - Ralph runs Claude Code in autonomous loops, checking off tasks
6. **Learnings** - Workers save discoveries for future tasks
7. **PR Creation** - Completed work becomes a pull request

## Spec Creation Flows

The factory supports two ways to create specifications:

### 1. Autonomous Spec Generation (Default)

**Method A: Using Anthropic SDK (Default)**
The intake service uses the Anthropic SDK directly to convert GitHub issues into specifications.

```env
USE_RALPH_SPEC=false
ANTHROPIC_API_KEY=your_key_here
```

**Method B: Using Ralph CLI (v0.3+)**
Leverage Ralph's built-in spec generation with validation and convention checking:

```env
USE_RALPH_SPEC=true
```

Ralph's spec generator includes:
- LLM-powered spec creation from issue descriptions
- Automatic validation against Ralph conventions
- Structured JSON event output
- Built-in spec quality checks

### 2. Interactive Spec Creation

For manual spec creation with guided prompts, use the wrapper script or run Claude Code's `/create-spec` skill directly.

**Option A: Using the wrapper script (Recommended)**

```bash
# Run from your project directory
./scripts/create-spec.sh

# Or specify output location
./scripts/create-spec.sh --output /path/to/SPEC.md
```

The script will:
- Check prerequisites (Claude CLI, git repo, API key)
- Run the `/create-spec` skill interactively
- Save the generated SPEC.md to your project
- Show next steps for submission to the factory

**Option B: Using Claude CLI directly**

```bash
cd your-project
claude
> /create-spec
```

The skill will:
1. **Interview you** about project type, stack, features, and constraints
2. **Generate a structured SPEC.md** following Ralph conventions
3. **Review with LLM** to catch anti-patterns and violations
4. **Finalize** only after passing validation

**Submitting your spec to the factory:**

Once you have a SPEC.md, submit it via the API:

```bash
curl -X POST http://localhost:3002/api/work \
  -H "Content-Type: application/json" \
  -d @- << EOF
{
  "repo": "owner/repo",
  "spec": "$(cat SPEC.md | jq -Rs .)",
  "priority": "medium",
  "metadata": {
    "source": "interactive",
    "createdBy": "$(git config user.name)"
  }
}
EOF
```

**What makes a good SPEC:**
- Each checkbox = one Ralph iteration
- Describes **requirements**, not implementation details
- No code snippets, file references, or shell commands
- Sub-bullets are deliverables, not instructions

**Example:**
```markdown
# Add User Authentication

## Goal
Secure API endpoints with JWT-based authentication

## Tasks
- [ ] Create User model with password hashing
  - Email and password fields
  - Bcrypt hashing for passwords
  - Unique email constraint
- [ ] Add login endpoint with JWT generation
  - POST /auth/login endpoint
  - Returns JWT token on valid credentials
  - Returns 401 on invalid credentials
- [ ] Add authentication middleware
  - Validates JWT on protected routes
  - Attaches user to request context
  - Returns 401 on missing/invalid token
```

See [Ralph's create-spec skill documentation](https://github.com/skylarbarrera/ralph#creating-a-good-spec) for more details.

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
├── SPEC.md               # Whim implementation checklist
└── SPEC-ralph.md         # Ralph CLI implementation checklist
```

## Implementation Specs

| Spec | Description |
|------|-------------|
| **SPEC.md** | Whim infrastructure (orchestrator, workers, intake, dashboard) |
| **SPEC-ralph.md** | Ralph CLI (autonomous Claude Code loop with event contract) |

Ralph and Whim are separate concerns. Whim spawns Ralph and parses its stdout events. See SPEC-ralph.md for the event contract.

## Quick Start

### Prerequisites

- Docker & Docker Compose
- GitHub CLI (`gh`) authenticated
- GitHub Personal Access Token (repo permissions)
- Anthropic API Key (for Claude)

### Setup

```bash
# Clone and setup
git clone <repo>
cd <repo>
./scripts/setup.sh

# Edit configuration
cp .env.example .env
# Add your GITHUB_TOKEN, ANTHROPIC_API_KEY, and REPOS

# Start services (without dashboard)
./scripts/dev.sh

# Or with dashboard
./scripts/dev.sh --dashboard
```

After startup:
- Orchestrator API: http://localhost:3002
- Dashboard (if enabled): http://localhost:3003

### Manual Work Item

```bash
# Submit work via API (orchestrator runs on port 3002)
curl -X POST http://localhost:3002/api/work \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "owner/repo",
    "branch": "ai/add-hello-endpoint",
    "spec": "# Task\n\n- [ ] Add hello world endpoint to src/index.ts",
    "priority": "medium",
    "metadata": {
      "issueNumber": 42,
      "issueTitle": "Add hello endpoint"
    }
  }'
```

### GitHub Integration

1. Add label `whim` to a GitHub issue
2. Intake service picks it up, adds `ai-processing` label
3. Generates SPEC.md from issue description
4. Queues work item for processing
5. Worker executes tasks, creates PR with `Closes #N`
6. Comment posted to issue with PR link
7. Issue label updated to `ai-pr-ready`
8. When PR merges, GitHub auto-closes the issue

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GITHUB_TOKEN` | required | GitHub PAT with repo permissions |
| `ANTHROPIC_API_KEY` | conditional | Anthropic API key (required if `USE_RALPH_SPEC=false`) |
| `USE_RALPH_SPEC` | `false` | Use Ralph CLI for spec generation (requires Ralph v0.3+) |
| `REPOS` | required | Comma-separated: `owner/repo1,owner/repo2` |
| `DATABASE_URL` | `postgres://factory:factory@localhost:5432/factory` | PostgreSQL connection |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `MAX_WORKERS` | `2` | Maximum concurrent workers |
| `DAILY_BUDGET` | `200` | Max iterations per day (Claude Max) |
| `COOLDOWN_SECONDS` | `60` | Seconds between worker spawns |
| `STALE_THRESHOLD` | `300` | Seconds before worker marked stale |
| `INTAKE_LABEL` | `whim` | GitHub label to watch |
| `POLL_INTERVAL` | `60000` | GitHub poll interval (ms) |

## API Endpoints

### Work Items
- `POST /api/work` - Create work item
- `GET /api/work/:id` - Get work item status
- `POST /api/work/:id/cancel` - Cancel work item

### Workers (Management)
- `GET /api/workers` - List all workers
- `POST /api/workers/:id/kill` - Kill worker

### Workers (Internal - used by workers)
- `POST /api/worker/register` - Worker self-registration
- `POST /api/worker/:id/heartbeat` - Send heartbeat
- `POST /api/worker/:id/lock` - Request file locks
- `POST /api/worker/:id/unlock` - Release file locks
- `POST /api/worker/:id/complete` - Mark work complete
- `POST /api/worker/:id/fail` - Report failure
- `POST /api/worker/:id/stuck` - Report stuck state

### Status & Metrics
- `GET /api/status` - Whim status overview
- `GET /api/queue` - Queue contents and stats
- `GET /api/metrics` - Performance metrics
- `GET /api/learnings` - Browse learnings
- `GET /health` - Health check

## Worker Protocol

Workers communicate with orchestrator via HTTP:

```
Worker                              Orchestrator
   │                                     │
   ├──── POST /api/worker/register ─────►│  (get workerId + workItem)
   │                                     │
   │  ┌─── iteration loop ───────────────┤
   │  │                                  │
   ├──┼── POST /api/worker/:id/heartbeat►│  (every tool call)
   │  │                                  │
   ├──┼── POST /api/worker/:id/lock ────►│  (before editing files)
   │  │                                  │
   ├──┼── POST /api/worker/:id/unlock ──►│  (after editing files)
   │  │                                  │
   │  └──────────────────────────────────┤
   │                                     │
   ├──── POST /api/worker/:id/complete ─►│  (on success + PR URL)
   │  or POST /api/worker/:id/fail ─────►│  (on failure)
   │  or POST /api/worker/:id/stuck ────►│  (when stuck)
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

Start with dashboard enabled:

```bash
./scripts/dev.sh --dashboard
```

Dashboard at `http://localhost:3003`:

- **Overview** (`/`): Queue depth, active workers, daily usage
- **Workers** (`/workers`): Live status, iterations, kill button
- **Queue** (`/queue`): Pending items, priorities, cancel button
- **Learnings** (`/learnings`): Browse and search past discoveries
- **Metrics** (`/metrics`): Charts for throughput, success rate, duration

Service ports:
| Service | Port |
|---------|------|
| Orchestrator API | 3002 |
| Dashboard | 3003 |
| PostgreSQL | 5432 |
| Redis | 6379 |

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
