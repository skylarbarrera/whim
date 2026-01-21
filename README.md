<p align="center">
  <img src="assets/logo-white.png" alt="Whim Logo" width="200">
</p>

<h1 align="center">Whim</h1>

<p align="center">
  <strong>Autonomous AI development system that turns GitHub issues into pull requests.</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#api">API</a>
</p>

## Features

- **GitHub Issue → PR** - Label an issue `whim`, get a pull request back
- **Spec Generation** - Converts issue descriptions to structured task specs via [Ralphie](https://github.com/skylarbarrera/ralphie)
- **Parallel Workers** - Run multiple Claude Code instances simultaneously
- **AI Verification** - Separate worker validates PRs actually work
- **Learnings System** - Workers share discoveries via vector embeddings
- **Rate Limiting** - Respects API limits with daily budgets and cooldowns
- **File Locking** - Prevents conflicts when workers touch the same files
- **CLI Dashboard** - Real-time terminal UI for monitoring

## How It Works

```
GitHub Issue (labeled "whim")
        ↓
   Intake Service
   (generates spec via Ralphie)
        ↓
   Orchestrator Queue
        ↓
   Worker Container
   (Claude Code + Ralphie)
        ↓
   Pull Request
        ↓
   Verification Worker
   (tests + validates)
```

1. **Intake** - Picks up GitHub issues labeled `whim`
2. **Spec Generation** - Converts issue to SPEC.md task checklist
3. **Queue** - Prioritizes work items (critical > high > medium > low)
4. **Execution** - Docker worker runs Claude Code autonomously
5. **PR Creation** - Completed work becomes a pull request
6. **Verification** - AI worker checks the PR actually works

## Quick Start

### Prerequisites

- Docker & Docker Compose
- GitHub CLI (`gh`) authenticated
- GitHub PAT with repo permissions
- Anthropic API key

### Setup

```bash
git clone https://github.com/skylarbarrera/whim.git
cd whim

# Run setup script
./scripts/setup.sh

# Configure environment
cp .env.example .env
# Edit .env with your tokens and repos

# Start services
./scripts/dev.sh
```

### Usage

**Via GitHub:**
1. Create an issue in a configured repo
2. Add the `whim` label
3. Wait for PR

**Via API:**
```bash
curl -X POST http://localhost:3002/api/work \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "owner/repo",
    "description": "Add a /health endpoint that returns JSON status"
  }'
```

**Monitor:**
```bash
whim dashboard    # Interactive dashboard
whim status       # Quick status check
```

## Configuration

### Required

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub PAT with repo permissions |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `REPOS` | Comma-separated repos: `owner/repo1,owner/repo2` |
| `POSTGRES_PASSWORD` | Database password |
| `ALLOWED_USERS` | GitHub usernames authorized to trigger work |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_WORKERS` | `2` | Maximum concurrent workers |
| `DAILY_BUDGET` | `200` | Max iterations per day |
| `COOLDOWN_SECONDS` | `60` | Seconds between worker spawns |
| `INTAKE_LABEL` | `whim` | GitHub label to watch |
| `HARNESS` | `claude` | AI backend: `claude`, `codex`, or `opencode` |

### Ports

| Service | Default | Env Var |
|---------|---------|---------|
| Orchestrator | 3002 | `ORCHESTRATOR_PORT` |
| PostgreSQL | 5433 | `POSTGRES_PORT` |
| Redis | 6380 | `REDIS_PORT` |

## API

### Work Items
- `POST /api/work` - Create work item
- `GET /api/work/:id` - Get status
- `POST /api/work/:id/cancel` - Cancel
- `POST /api/work/:id/requeue` - Retry

### Management
- `GET /api/status` - System status
- `GET /api/queue` - Queue contents
- `GET /api/workers` - List workers
- `GET /api/metrics` - Metrics
- `GET /health` - Health check

## CLI

```bash
# Initialize a repo for Whim
whim init

# Run AI verification on current branch
whim verify
whim verify --pr 123 --comment

# Monitor
whim dashboard
whim status
```

## Security

- **User Allowlist** - Only configured GitHub users can trigger work
- **Docker Socket Proxy** - Limited container operations, no exec/volumes/build
- **Container Limits** - 4GB memory, 2 CPU cores, 256 PID limit
- **Input Validation** - Parameterized queries, request size limits

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed system design.

## Development

```bash
bun install        # Install dependencies
bun run build      # Build all packages
bun test           # Run tests
bun run lint       # Lint
```

## License

MIT
