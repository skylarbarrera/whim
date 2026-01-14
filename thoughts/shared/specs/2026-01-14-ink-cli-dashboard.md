# Whim CLI Dashboard

**Status:** Spec Draft
**Priority:** Medium
**Created:** 2026-01-14

## Overview

A terminal-based dashboard for monitoring Whim, built with [Ink](https://github.com/vadimdemedes/ink) (React for CLIs). Similar UX to Claude Code, Vercel, or Railway CLIs.

## Goals

- Real-time visibility into Whim operations
- Monitor workers, queue, and costs from terminal
- No need to open browser dashboard
- Works over SSH / headless servers

## UX Requirements

### Animated States (Critical)

Every pending/loading state must have animation - no static "Loading..." text.

| State | Animation |
|-------|-----------|
| Worker running | Spinner + pulsing progress bar |
| Waiting for API | Dots animation `...` → `....` → `.....` |
| Queue item pending | Subtle pulse or breathing effect |
| Refreshing data | Spinner in header |
| Worker starting | Spinner + "Starting..." |

Use `ink-spinner` and custom animations. The dashboard should feel **alive**.

### Clear Sections

Dashboard must have visually distinct sections with clear headers:

```
╭─ WORKERS ──────────────────────────────────────────╮
│  ...                                               │
╰────────────────────────────────────────────────────╯

╭─ QUEUE ────────────────────────────────────────────╮
│  ...                                               │
╰────────────────────────────────────────────────────╯

╭─ TODAY ────────────────────────────────────────────╮
│  ...                                               │
╰────────────────────────────────────────────────────╯
```

Each section:
- Clear header with label
- Box borders or visual separation
- Consistent padding
- Keyboard shortcut hint in header (e.g., `WORKERS [w]`)

### Color Scheme

| Element | Color |
|---------|-------|
| Section headers | **Cyan** |
| Active/running | **Green** |
| Queued/waiting | **Yellow** |
| Failed/error | **Red** |
| Completed/success | **Green** (dimmed) |
| Worker ID | **Blue** |
| Repo name | **White** (bold) |
| Branch name | **Magenta** |
| Costs | **Yellow** |
| Progress bar filled | **Green** |
| Progress bar empty | **Gray** (dim) |
| Keyboard hints | **Cyan** (dim) |
| Timestamps | **Gray** |

Use `chalk` for colors. Support `NO_COLOR` env var for accessibility.

## User Experience

### Launch

```bash
# Main dashboard (default)
whim

# Or explicit commands
whim status
whim workers
whim queue
whim logs <worker-id>
```

### Main Dashboard View

```
  Whim                                               ⟳ Updated 2s ago

╭─ STATUS ───────────────────────────────────────────────────────────╮
│  ● Running        Workers: 2/2        Queue: 3 pending             │
╰────────────────────────────────────────────────────────────────────╯

╭─ WORKERS [w] ──────────────────────────────────────────────────────╮
│                                                                    │
│  ◐ worker-a1b2  owner/frontend  ai/fix-auth-bug                   │
│    ├─ Iteration 12/50           ████████████░░░░░░░░  24%         │
│    ├─ Runtime: 4m 32s           Tokens: 45.2k in │ 12.1k out      │
│    └─ Last: Edit src/auth.ts    Cost: $0.42                       │
│                                                                    │
│  ◐ worker-c3d4  owner/backend   ai/add-caching                    │
│    ├─ Iteration 3/50            ██░░░░░░░░░░░░░░░░░░  6%          │
│    ├─ Runtime: 0m 48s           Tokens: 8.4k in │ 2.1k out        │
│    └─ Last: Read package.json   Cost: $0.08                       │
│                                                                    │
╰────────────────────────────────────────────────────────────────────╯

╭─ QUEUE [u] ────────────────────────────────────────────────────────╮
│                                                                    │
│  ◦ owner/api       ai/issue-42-fix-rate-limit     high   waiting  │
│  ◦ owner/frontend  ai/issue-38-dark-mode          med    waiting  │
│  ◦ owner/docs      ai/issue-50-update-readme      low    waiting  │
│                                                                    │
╰────────────────────────────────────────────────────────────────────╯

╭─ TODAY ────────────────────────────────────────────────────────────╮
│  Completed: 7    Failed: 1    Iterations: 142/200    Cost: $12.84 │
╰────────────────────────────────────────────────────────────────────╯

  [q] quit  [w] workers  [u] queue  [l] logs  [k] kill  [?] help
```

**Animation notes:**
- `◐` spins for active workers (cycles: ◐ ◓ ◑ ◒)
- `◦` pulses/breathes for queued items
- Progress bars animate smoothly when updating
- `⟳` spins during refresh

### Worker Detail View (`w` or `whim workers`)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Worker: worker-a1b2c3d4                           ▲ Updated 1s ago │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Repo:     owner/frontend                                           │
│  Branch:   ai/fix-auth-bug                                          │
│  Status:   Running                                                  │
│  Started:  2026-01-14 10:32:15 (4m 32s ago)                        │
│                                                                     │
│  Progress: ██████████░░░░░░░░░░  24% (12/50 iterations)            │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  METRICS                                                            │
│                                                                     │
│  Tokens In:     45,231        Cost In:    $0.34                    │
│  Tokens Out:    12,102        Cost Out:   $0.08                    │
│  Files Modified: 4            Total Cost: $0.42                    │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  RECENT ACTIVITY                                                    │
│                                                                     │
│  10:36:42  Edit   src/auth/login.ts                                │
│  10:36:38  Read   src/auth/types.ts                                │
│  10:36:35  Bash   bun test src/auth                                │
│  10:36:20  Edit   src/auth/session.ts                              │
│  10:36:15  Read   src/auth/session.ts                              │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  [b] back  [l] full logs  [k] kill  [r] refresh                    │
└─────────────────────────────────────────────────────────────────────┘
```

### Logs View (`l` or `whim logs <worker-id>`)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Logs: worker-a1b2c3d4                             ▲ Following...   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  10:36:42 [RALPH:ITERATION] {"iteration": 12, "tokens": {...}}     │
│  10:36:42 [TOOL] Edit src/auth/login.ts                            │
│  10:36:38 [TOOL] Read src/auth/types.ts                            │
│  10:36:35 [TOOL] Bash bun test src/auth                            │
│           > PASS src/auth/login.test.ts                            │
│           > PASS src/auth/session.test.ts                          │
│           > Tests: 12 passed, 12 total                             │
│  10:36:20 [TOOL] Edit src/auth/session.ts                          │
│  10:36:15 [TOOL] Read src/auth/session.ts                          │
│  10:35:58 [RALPH:ITERATION] {"iteration": 11, "tokens": {...}}     │
│  ...                                                                │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  [b] back  [f] toggle follow  [/] search  [↑↓] scroll              │
└─────────────────────────────────────────────────────────────────────┘
```

### Queue View (`whim queue`)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Queue                                             3 items          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  #  REPO             BRANCH                     PRIORITY  STATUS    │
│  ─────────────────────────────────────────────────────────────────  │
│  1  owner/api        ai/issue-42-fix-rate       high      queued    │
│  2  owner/frontend   ai/issue-38-dark-mode      medium    queued    │
│  3  owner/docs       ai/issue-50-readme         low       queued    │
│                                                                     │
│  [enter] view spec  [c] cancel  [p] change priority  [b] back      │
└─────────────────────────────────────────────────────────────────────┘
```

## Commands

| Command | Description |
|---------|-------------|
| `whim` | Open dashboard (connects to running services) |
| `whim status` | Quick status one-liner, then exit |
| `whim logs <id>` | Stream worker logs |
| `whim add <repo> <spec-file>` | Add work item to queue |
| `whim cancel <id>` | Cancel queued item |
| `whim kill <worker-id>` | Kill a worker |
| `whim config` | Show/set config (API URL, etc) |

### Keyboard Shortcuts (in dashboard)

| Key | Action |
|-----|--------|
| `q` | Quit dashboard |
| `w` | Focus workers panel |
| `u` | Focus queue panel |
| `l` | View logs for selected worker |
| `k` | Kill selected worker |
| `c` | Cancel selected queue item |
| `a` | Add work item (opens prompt) |
| `r` | Force refresh |
| `?` | Help |

## Technical Design

### Package Structure

```
packages/cli/
├── package.json
├── src/
│   ├── index.tsx           # Entry point, command routing
│   ├── commands/
│   │   ├── dashboard.tsx   # Main dashboard
│   │   ├── workers.tsx     # Worker list/detail
│   │   ├── queue.tsx       # Queue management
│   │   ├── logs.tsx        # Log viewer
│   │   ├── metrics.tsx     # Metrics view
│   │   └── status.tsx      # Quick status
│   ├── components/
│   │   ├── Section.tsx        # Boxed section with header
│   │   ├── WorkerCard.tsx     # Worker with spinner + progress
│   │   ├── QueueItem.tsx      # Queue item with pulse
│   │   ├── ProgressBar.tsx    # Animated progress bar
│   │   ├── Spinner.tsx        # Custom spinners (◐◓◑◒)
│   │   ├── StatusBadge.tsx    # Status with color
│   │   ├── KeyHints.tsx       # Footer shortcuts
│   │   └── AnimatedDots.tsx   # Loading dots animation
│   ├── hooks/
│   │   ├── useApi.ts       # Orchestrator API client
│   │   ├── usePolling.ts   # Auto-refresh
│   │   └── useKeyboard.ts  # Key bindings
│   └── utils/
│       ├── format.ts       # Number/time formatting
│       └── cost.ts         # Token cost calculation
└── tsconfig.json
```

### Dependencies

```json
{
  "dependencies": {
    "ink": "^5.0.0",
    "ink-spinner": "^5.0.0",
    "ink-table": "^3.1.0",
    "react": "^18.0.0",
    "commander": "^12.0.0",
    "chalk": "^5.0.0"
  }
}
```

### Data Flow

```
┌─────────────┐     HTTP/Polling     ┌──────────────┐
│   CLI       │ ◄──────────────────► │ Orchestrator │
│   (Ink)     │     /api/status      │   API        │
│             │     /api/workers     │              │
│             │     /api/queue       │              │
│             │     /api/metrics     │              │
└─────────────┘                      └──────────────┘
```

### API Requirements

The CLI will use existing orchestrator endpoints:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/status` | Overall status |
| `GET /api/workers` | Active workers |
| `GET /api/workers/:id` | Worker detail |
| `GET /api/queue` | Queue items |
| `GET /api/metrics` | Usage metrics |
| `POST /api/work` | Add work item |
| `POST /api/work/:id/cancel` | Cancel item |
| `POST /api/workers/:id/kill` | Kill worker |

May need new endpoints:
- `GET /api/workers/:id/logs` - Stream worker logs (WebSocket or SSE?)

### Configuration

```bash
# ~/.whimrc or environment
WHIM_API_URL=http://localhost:4000
WHIM_API_KEY=xxx  # If auth enabled
WHIM_REFRESH_INTERVAL=2000  # ms
```

### Cost Calculation

```typescript
// Token pricing (Claude Sonnet)
const COST_PER_1K_INPUT = 0.003;   // $3/1M tokens
const COST_PER_1K_OUTPUT = 0.015;  // $15/1M tokens

function calculateCost(tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1000) * COST_PER_1K_INPUT +
         (tokensOut / 1000) * COST_PER_1K_OUTPUT;
}
```

## Decisions

| Question | Decision |
|----------|----------|
| **Use case** | Monitor + manage (queue work, kill workers, cancel items) |
| **Environment** | Both local and remote/SSH - must work headless |
| **Priority info** | All equal - show workers, costs, queue together |
| **Notifications** | No - just the dashboard |
| **CLI architecture** | CLI IS Whim - starts servers + shows dashboard |
| **Web dashboard** | Kill it - delete `packages/dashboard` |

## Architecture

The CLI is a **standalone dashboard** that connects to running Whim services. Services are managed separately (docker-compose, systemd, etc).

```bash
docker-compose up -d   # Start services (existing flow)
whim                   # Connect and show dashboard
```

### Process Model

```
┌─────────────────────┐         ┌─────────────────────┐
│  whim CLI           │  HTTP   │  Whim Services      │
│  (Ink dashboard)    │ ◄─────► │  (docker-compose)   │
│                     │         │  - orchestrator     │
│  Just a UI client   │         │  - intake           │
│                     │         │  - postgres/redis   │
└─────────────────────┘         └─────────────────────┘
```

### Why this approach
- Simpler - CLI doesn't manage processes
- Flexible - services can run anywhere (Docker, k8s, bare metal)
- Works remote - just point CLI at API URL

## Open Questions

1. **Log streaming** - How to stream worker logs? Options:
   - Poll `/api/workers/:id/logs` endpoint (simplest, works over SSH)
   - WebSocket connection
   - SSE (Server-Sent Events)

2. **Auth** - Need API key auth for remote orchestrators (required for "both" env)

3. **History** - Show completed work items? How many?

## Implementation Phases

### Phase 1: Core Dashboard
- Main status view
- Worker list with progress
- Basic queue view
- Keyboard navigation

### Phase 2: Interactivity
- Kill workers
- Cancel queue items
- Change priority
- Add work items

### Phase 3: Logs & Detail
- Log streaming/viewing
- Worker detail view
- Search/filter

### Phase 4: Polish
- Config file support
- Notifications
- Metrics history
- Error handling

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1 | 4-6 hours |
| Phase 2 | 2-3 hours |
| Phase 3 | 3-4 hours |
| Phase 4 | 2-3 hours |
| **Total** | **~12-16 hours** |

## References

- [Ink](https://github.com/vadimdemedes/ink) - React for CLIs
- [ink-ui](https://github.com/vadimdemedes/ink-ui) - Common components
- [Claude Code CLI](https://github.com/anthropics/claude-code) - UX reference
- [Vercel CLI](https://vercel.com/docs/cli) - UX reference
