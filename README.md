<p align="center">
  <img src="assets/logo-white.png" alt="Whim Logo" width="200">
</p>

<h1 align="center">Whim</h1>

<p align="center">
  <strong>An autonomous AI development system that takes GitHub issues, converts them to specs, and produces PRs through iterative Claude Code execution.</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#api-endpoints">API</a> •
  <a href="#monitoring">Monitoring</a>
</p>

## Features (v1)

- **GitHub Issue → PR Pipeline** - Label an issue `whim`, get a PR back
- **Generic API Intake** - Submit work via description or spec from any source
- **AI-Driven Verification** - Separate worker validates PRs actually work
- **Repository Initialization** - `whim init` detects project type and installs skills
- **Parallel Workers** - Run multiple Claude Code instances simultaneously
- **Learnings System** - Workers share discoveries across tasks via vector embeddings
- **Rate Limiting** - Respects Claude Max limits with daily budgets and cooldowns
- **File Locking** - Prevents conflicts when workers touch the same files
- **Real-time CLI Dashboard** - Terminal UI for monitoring queue, workers, and metrics

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

### Iteration Model

Whim uses Ralph for autonomous coding but with a modified iteration strategy optimized for speed.

**Ralph standalone**: 1 task = 1 Claude session. Claude completes one SPEC checkbox, stops, and Ralph restarts it for the next task. This provides strict checkpointing but incurs context reload overhead per task.

**Whim turbo mode**: Claude runs until SPEC complete or context fills. Ralph restarts Claude only when needed (context exhaustion, idle timeout). Tasks are tracked via SPEC.md checkboxes and commits remain granular (one per task), but Claude sessions span multiple tasks.

This is intentional - Whim prioritizes throughput. A 36-task spec might complete in 3 Claude sessions rather than 36, reducing context reload overhead by ~80%.

## Spec Creation Flows

The factory supports two ways to create specifications:

### 1. Autonomous Spec Generation (Default)

The intake service uses Ralph CLI to convert GitHub issues into specifications:

```bash
ralph spec --headless "<issue description>"
```

Ralph's spec generator includes:
- LLM-powered spec creation from issue descriptions
- Automatic validation against Ralph conventions
- Structured JSON event output
- Built-in spec quality checks
- Verification steps for each task

### 2. Interactive Spec Creation

For manual spec creation with guided prompts, use Ralph's interactive mode:

```bash
cd your-project
ralph spec "Brief description of what you want to build"
```

Ralph will:
1. **Interview you** about project type, stack, features, and constraints
2. **Generate a structured SPEC.md** following Ralph conventions
3. **Validate** against spec conventions
4. **Save** the spec to your project

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
whim/
├── packages/
│   ├── orchestrator/     # Central brain - queue, workers, rate limits
│   ├── worker/           # Docker container - runs Ralph + Claude Code
│   ├── intake/           # GitHub adapter - polls issues, generates specs
│   ├── shared/           # Shared types and utilities
│   └── cli/              # Terminal dashboard (Ink) for monitoring
├── docker/
│   └── docker-compose.yml
├── migrations/
│   └── 001_initial.sql
└── scripts/
    ├── setup.sh
    ├── dev.sh
    └── migrate.sh
```

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

# Start services
./scripts/dev.sh
```

After startup:
- Orchestrator API: http://localhost:3002
- Monitor with: `whim dashboard` or `whim status`

### Manual Work Item

Submit work via description (async spec generation):

```bash
# Submit with description - spec is generated automatically
curl -X POST http://localhost:3002/api/work \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "owner/repo",
    "description": "Add a hello world endpoint that returns JSON",
    "priority": "medium",
    "source": "api",
    "sourceRef": "manual-1"
  }'
# Returns: { "id": "...", "status": "generating" }
# Poll GET /api/work/:id until status is "queued"
```

Or submit with a pre-generated spec:

```bash
curl -X POST http://localhost:3002/api/work \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "owner/repo",
    "spec": "# Task\n\n- [ ] Add hello world endpoint to src/index.ts",
    "priority": "medium"
  }'
# Returns: { "id": "...", "status": "queued" }
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
| `ANTHROPIC_API_KEY` | required | Anthropic API key (used by Ralph for spec generation) |
| `REPOS` | required | Comma-separated: `owner/repo1,owner/repo2` |
| `DATABASE_URL` | `postgres://factory:factory@localhost:5432/factory` | PostgreSQL connection |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `MAX_WORKERS` | `2` | Maximum concurrent workers |
| `DAILY_BUDGET` | `200` | Max iterations per day (Claude Max) |
| `COOLDOWN_SECONDS` | `60` | Seconds between worker spawns |
| `STALE_THRESHOLD` | `300` | Seconds before worker marked stale |
| `INTAKE_LABEL` | `whim` | GitHub label to watch |
| `POLL_INTERVAL` | `60000` | GitHub poll interval (ms) |
| `VERIFICATION_ENABLED` | `true` | Global default for verification |
| `SPEC_MAX_ATTEMPTS` | `3` | Max spec generation retries |
| `HARNESS` | `claude` | AI harness for workers: `claude` or `codex` |
| `OPENAI_API_KEY` | - | Required when `HARNESS=codex` |

## API Endpoints

### Work Items
- `POST /api/work` - Create work item (accepts `description` OR `spec`)
- `GET /api/work/:id` - Get work item status
- `GET /api/work/:id/verification` - Get linked verification item
- `POST /api/work/:id/cancel` - Cancel work item
- `POST /api/work/:id/requeue` - Requeue failed/completed item

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

## CLI Commands

### whim init

Initialize a repository for Whim:

```bash
whim init           # Interactive mode
whim init --yes     # Non-interactive, accept defaults
```

Detects:
- Project type (web, api, cli, library, monorepo)
- Package manager (npm, pnpm, bun, yarn)
- Test framework (vitest, jest, mocha, bun test)
- AI harness (claude-code, codex, opencode)

Creates:
- `.ralph/config.yml` - Harness preference
- `.whim/config.yml` - Project type and verification settings

Installs:
- Ralph skills (via `add-skill`)
- Whim verify skill
- vitest (if no test framework)
- playwright (for web projects)

### whim verify

Run AI-driven verification:

```bash
whim verify                    # Run verification
whim verify --pr 123           # Specify PR number
whim verify --pr 123 --comment # Post results as PR comment
```

Requires Claude Code and `ANTHROPIC_API_KEY`.

## Monitoring

Use the Whim CLI to monitor the orchestrator:

```bash
# Interactive dashboard with live updates (polls every 2s)
whim dashboard

# Quick status check (one-line summary)
whim status

# Connect to remote orchestrator
whim dashboard --api-url http://remote-host:3002
whim status --api-url http://remote-host:3002

# Or configure default API URL in ~/.whimrc
echo "apiUrl=http://remote-host:3002" > ~/.whimrc
```

### Configuration File

Create `~/.whimrc` to set defaults:

```bash
# Whim CLI Configuration
apiUrl=http://localhost:3002
```

CLI flags override config file values.

### CLI Dashboard Features

The interactive dashboard shows:

- **STATUS**: Running state, active worker count, queue depth
- **WORKERS**: Live worker cards with repo, branch, iteration, progress bar
- **QUEUE**: Pending items with priority and status
- **TODAY**: Completed/failed counts, iterations, success rate

### Keyboard Controls

- `q` - Quit dashboard
- `r` - Force refresh
- `?` - Show help overlay
- Navigation keys (coming soon)

Service ports:
| Service | Port |
|---------|------|
| Orchestrator API | 3002 |
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

## Landscape & Future Directions

### Related Projects

Whim exists in a growing ecosystem of AI coding agents. Here's how it compares:

| Feature | Whim | [Open SWE](https://github.com/langchain-ai/open-swe) | [SWE-agent](https://github.com/SWE-agent/SWE-agent) | [Aider](https://github.com/Aider-AI/aider) | [GitHub Copilot Agent](https://github.blog/news-insights/product-news/github-copilot-meet-the-new-coding-agent/) | [Sweep AI](https://github.com/sweepai/sweep) |
|---------|------|----------|-----------|-------|----------------------|----------|
| **LLM Support** | Claude Code, Codex | Claude (Opus 4.1 option) | Any (GPT-4o, Claude, etc.) | Any (Claude, GPT-4o, DeepSeek, local) | GitHub models | Multiple (GPT-4, Claude) |
| **Trigger** | GitHub label, API | GitHub label, Web UI | CLI, batch mode | CLI | GitHub issue assignment | GitHub issue (`Sweep:` prefix) |
| **Orchestration** | Custom queue + Docker workers | LangGraph | YAML config | None (single session) | GitHub Actions | GitHub App |
| **Parallel Execution** | ✅ Multiple workers | ✅ Cloud sandboxes | ❌ | ❌ | ✅ Mission Control | ❌ |
| **Verification** | ✅ AI verifies PR works† | ❌ | ❌ | Lint/test on change | ✅ Runs existing tests | ❌ |
| **Learnings/Memory** | ✅ Vector embeddings, cross-worker | ❌ | ❌ | ❌ | ✅ Codebase memory (Pro) | ❌ |
| **Hosting** | Self-hosted (Docker) | Cloud (LangChain) | Self-hosted | Self-hosted | Cloud (GitHub) | Cloud or self-hosted |
| **Open Source** | ✅ MIT | ✅ | ✅ | ✅ Apache 2.0 | ❌ Closed | ✅ |
| **Spec Generation** | ✅ Ralph interview → SPEC.md | Plan phase | ❌ | ❌ | ❌ | ❌ |
| **Rate Limiting** | ✅ Daily budget, cooldowns | Cloud-managed | ❌ | ❌ | Cloud-managed | Cloud-managed |

† **Verification difference**: Most tools run your existing test suite before/during PR creation. Whim's verification worker goes further—after the PR is created, an AI agent checks out the branch, runs existing tests, *and* intelligently writes additional tests based on what changed. This catches issues that existing tests miss.

### Why Whim?

- **Self-hosted control** - Your infrastructure, your data, no cloud dependency
- **Verification workflow** - Separate AI worker verifies PRs actually work (not just "tests pass")
- **Harness flexibility** - Swap between Claude Code and Codex
- **Ralph spec generation** - Structured interview → SPEC.md with quality checks
- **Learnings system** - Knowledge persists and transfers across workers

### Future Considerations

**Orchestration alternatives** we're evaluating:

| Tool | What It Offers | Trade-off |
|------|----------------|-----------|
| [Temporal](https://temporal.io) | Durable execution, automatic retries, full event history, survives crashes | Additional infrastructure (self-hosted is free, or use Temporal Cloud) |
| [pg-boss](https://github.com/timgit/pg-boss) | Battle-tested PostgreSQL job queue | Less control than custom, but handles edge cases |

Current custom orchestration works well for our scale. Temporal becomes attractive if:
- Worker retry logic gets complex
- Need better observability into stuck/failed workflows
- Multi-node orchestrator deployment required

See [Temporal's AI agent orchestration guide](https://temporal.io/blog/of-course-you-can-build-dynamic-ai-agents-with-temporal) for context.

## License

MIT
