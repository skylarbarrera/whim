# Iteration 15 Plan: Implement Logs Viewer for CLI Dashboard

## Goal
Complete the three remaining tasks in Phase 4 of SPEC.md:
1. Create `src/commands/logs.tsx` - log viewer
2. `l` key opens logs for selected worker
3. Poll worker logs from API (or add new endpoint)

## Current State Analysis
- Worker logs to stdout via console.log statements
- No existing API endpoint in orchestrator to retrieve worker logs
- Dashboard has worker selection state management scaffolded but not implemented
- Need to add worker selection, log viewer component, and logs API endpoint

## Implementation Strategy

### Option 1: Add Docker Logs API Endpoint (RECOMMENDED)
Since workers run in Docker containers, we can use Docker SDK to retrieve container logs:
1. Add `/api/workers/:id/logs` endpoint to orchestrator
2. Use Docker SDK to fetch container logs
3. Return logs as JSON with streaming support
4. CLI can poll this endpoint for updates

### Option 2: Log Aggregation System
Store logs in Redis or database - more complex, not needed for MVP.

## Files to Modify/Create

### 1. Orchestrator (Add Logs API)
- `packages/orchestrator/src/server.ts` - Add GET /api/workers/:id/logs endpoint
- `packages/orchestrator/package.json` - Add dockerode dependency if needed

### 2. CLI (Add Logs Viewer)
- `packages/cli/src/commands/logs.tsx` - New log viewer component
- `packages/cli/src/commands/dashboard.tsx` - Add worker selection state and 'l' key handler
- `packages/cli/src/hooks/useApi.ts` - Already supports generic polling

### 3. Shared Types (Optional)
- `packages/shared/src/types.ts` - Add WorkerLogsResponse type if needed

## Implementation Steps

### Step 1: Add Logs API Endpoint
1. Check if orchestrator already has Docker SDK access (WorkerManager uses it)
2. Add endpoint to fetch container logs using Docker API
3. Return last N lines of logs with optional tail support
4. Add error handling for stopped/missing containers

### Step 2: Add Worker Selection to Dashboard
1. Add state: `selectedWorkerIndex` and `focusedSection`
2. Implement arrow key navigation when section is focused
3. Highlight selected worker with different color/border
4. Add 'w' key to focus workers section
5. Add 'l' key to open logs for selected worker

### Step 3: Create Logs Viewer Component
1. Create scrollable text area showing logs
2. Poll logs API every 2 seconds
3. Auto-scroll to bottom on new logs
4. Show worker ID and repo/branch in header
5. 'q' or ESC to go back to dashboard
6. Handle error states (worker not found, container stopped)

## Tests
- Manual testing with running workers
- Verify logs update in real-time
- Test with stopped workers (should show last logs)
- Test navigation with multiple workers

## Exit Criteria
- ✅ Can press 'l' on a selected worker to view its logs
- ✅ Logs update every 2 seconds
- ✅ Can navigate back to dashboard with 'q'
- ✅ Works with active and stopped workers
- ✅ All three checkboxes in SPEC.md marked complete
