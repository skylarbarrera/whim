# Whim CLI Dashboard

Ink-based terminal dashboard for monitoring and managing Whim.

## Overview

- **Replaces:** `packages/dashboard` (delete after CLI complete)
- **Tech:** Ink (React for CLIs) + TypeScript
- **Architecture:** Standalone client, connects to orchestrator API

## Phase 1: Setup & Components

- [x] Create `packages/cli` with package.json (ink, react, chalk, commander)
- [x] Add tsconfig.json matching other packages
- [ ] Create entry point `src/index.tsx` with commander routing
- [ ] Create `src/components/Section.tsx` - boxed section with header
- [ ] Create `src/components/Spinner.tsx` - animated spinner (◐◓◑◒)
- [ ] Create `src/components/ProgressBar.tsx` - animated progress bar
- [ ] Create `src/hooks/useApi.ts` - orchestrator API client with polling
- [ ] Verify `whim` command runs and shows "Hello World"

## Phase 2: Main Dashboard

- [ ] Create `src/commands/dashboard.tsx` - main dashboard view
- [ ] Add STATUS section (running state, worker count, queue depth)
- [ ] Add WORKERS section with live worker cards
- [ ] Worker card shows: id, repo, branch, iteration, progress bar, tokens, cost
- [ ] Add QUEUE section with pending items
- [ ] Queue item shows: repo, branch, priority, status
- [ ] Add TODAY section (completed, failed, iterations, cost)
- [ ] Add footer with keyboard hints
- [ ] Poll API every 2s, show refresh spinner

## Phase 3: Keyboard Navigation & Actions

- [ ] Add keyboard handler with `useInput` hook
- [ ] `q` - quit dashboard
- [ ] `w` - focus workers section
- [ ] `u` - focus queue section
- [ ] `k` - kill selected worker (POST /api/workers/:id/kill)
- [ ] `c` - cancel selected queue item (POST /api/work/:id/cancel)
- [ ] `r` - force refresh
- [ ] `?` - show help overlay
- [ ] Arrow keys to select items within sections

## Phase 4: Logs & Polish

- [ ] Create `src/commands/logs.tsx` - log viewer
- [ ] `l` key opens logs for selected worker
- [ ] Poll worker logs from API (or add new endpoint)
- [ ] Add `--api-url` flag for remote orchestrators
- [ ] Add `~/.whimrc` config file support
- [ ] Add error handling for API failures (show error in UI, don't crash)
- [ ] Add `whim status` one-liner command

## Color Scheme

| Element | Color |
|---------|-------|
| Section headers | Cyan |
| Active/running | Green |
| Queued/waiting | Yellow |
| Failed/error | Red |
| Worker ID | Blue |
| Repo name | White bold |
| Branch name | Magenta |
| Costs | Yellow |
| Progress filled | Green |
| Progress empty | Gray dim |
| Key hints | Cyan dim |

## Animation Requirements

- Spinner for active workers (◐◓◑◒ cycle)
- Pulse/breathe for queued items
- Smooth progress bar updates
- Refresh indicator in header

## Cleanup

- [ ] Delete `packages/dashboard` after CLI is working
- [ ] Update docker-compose to remove dashboard service
- [ ] Update README to document CLI usage