# Plan: Phase 4.3 - Track and Report Test Execution Results in Worker Metrics

## Goal
Enhance worker metrics to include testsFailed and testStatus for better observability.

## Current State
- Test results are already captured by runTests() in testing.ts
- testsRun and testsPassed are already sent in WorkerCompleteRequest
- testsFailed is available but not sent
- testStatus (passed/failed/timeout/skipped/error) not tracked in metrics

## Files to Modify
- `packages/shared/src/types.ts` - Add testsFailed and testStatus to metrics
- `packages/worker/src/ralph.ts` - Add testsFailed to RalphMetrics
- `packages/worker/src/index.ts` - Include testsFailed and testStatus in metrics

## Changes

### 1. Update shared types
Add to WorkerCompleteRequest.metrics:
- testsFailed: number
- testStatus?: "passed" | "failed" | "timeout" | "skipped" | "error"

Add to WorkerMetrics:
- testsFailed: number
- testStatus?: string

### 2. Update ralph.ts RalphMetrics
Add testsFailed field

### 3. Update index.ts
Include testsFailed and testStatus in the metrics sent to orchestrator

## Tests
- Existing tests should pass
- Update client.test.ts to include new fields

## Exit Criteria
- [ ] testsFailed added to metrics types
- [ ] testStatus added to metrics types
- [ ] Worker sends complete test metrics to orchestrator
- [ ] Type checks pass
- [ ] All tests pass
