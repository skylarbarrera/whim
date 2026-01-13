# Phase 5.1: Worker Package Core

## Goal
Implement the worker package that runs inside Docker containers, communicates with the orchestrator, manages the workspace, and runs Ralph to execute tasks.

## Files to Create/Modify

### New Files
1. `packages/worker/package.json` - Package config with dependencies
2. `packages/worker/tsconfig.json` - TypeScript config extending root
3. `packages/worker/src/client.ts` - OrchestratorClient class
4. `packages/worker/src/setup.ts` - Workspace setup functions
5. `packages/worker/src/learnings.ts` - Learning management functions
6. `packages/worker/src/ralph.ts` - Ralph execution and event parsing
7. `packages/worker/src/index.ts` - Main entry point

### Test Files
- `packages/worker/src/client.test.ts` - Client tests
- `packages/worker/src/setup.test.ts` - Setup tests
- `packages/worker/src/learnings.test.ts` - Learnings tests
- `packages/worker/src/ralph.test.ts` - Ralph event parsing tests

## Implementation Details

### OrchestratorClient (`src/client.ts`)
- `baseUrl` property from env
- `workerId` property
- `heartbeat(iteration: number, status?: string, tokens?: {in: number, out: number})` - POST /api/worker/:id/heartbeat
- `lockFile(files: string[])` - POST /api/worker/:id/lock
- `complete(prUrl?: string, metrics?, learnings?)` - POST /api/worker/:id/complete
- `fail(error: string, iteration: number)` - POST /api/worker/:id/fail
- `stuck(reason: string, attempts: number)` - POST /api/worker/:id/stuck
- `getLearnings(repo: string)` - GET /api/learnings?repo=

### setupWorkspace (`src/setup.ts`)
- Clone repo: `git clone --depth 1 <repo-url>`
- Create branch: `git checkout -b <branch>`
- Write SPEC.md in repo root
- Copy Claude config files if needed

### loadLearnings, saveLearnings (`src/learnings.ts`)
- `loadLearnings(client, repo, destPath)` - Fetch from orchestrator → write `.ai/learnings.md`
- `saveLearnings(client, sourcePath)` - Parse `.ai/new-learnings.md` → send to orchestrator

### runRalph (`src/ralph.ts`)
- Spawn `claude --dangerously-skip-permissions` process
- Parse `[RALPH:*]` events from stdout:
  - `[RALPH:ITERATION]` → heartbeat
  - `[RALPH:FILE_EDIT]` → lockFile
  - `[RALPH:STUCK]` → stuck report
  - `[RALPH:COMPLETE]` → metrics extraction
  - `[RALPH:FAILED]` → fail report

### Main Entry (`src/index.ts`)
1. Parse env vars (ORCHESTRATOR_URL, WORK_ITEM, WORKER_ID, GITHUB_TOKEN)
2. Create OrchestratorClient
3. Setup workspace
4. Load learnings
5. Run Ralph
6. Extract new learnings
7. Create PR (using gh cli)
8. Report completion

## Exit Criteria
- [x] All files created and compile without errors
- [x] Unit tests pass for all modules
- [x] `bun run build` succeeds
- [x] `bun run typecheck` passes
