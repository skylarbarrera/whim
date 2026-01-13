# Plan: Phase 4.4 - API Server

## Goal
Create `packages/orchestrator/src/server.ts` with Express API server implementing all orchestrator endpoints.

## Files to Create/Modify
- **Create**: `packages/orchestrator/src/server.ts` - Express API server with all endpoints
- **Create**: `packages/orchestrator/src/server.test.ts` - Unit tests for server

## API Endpoints (from SPEC.md)

### Work Item Routes
- POST `/api/work` - add work item (uses QueueManager.add)
- GET `/api/work/:id` - get work item (uses QueueManager.get)
- POST `/api/work/:id/cancel` - cancel work item (uses QueueManager.cancel)

### Worker Routes
- POST `/api/worker/register` - worker registration (uses WorkerManager.register)
- POST `/api/worker/:id/heartbeat` - worker heartbeat (uses WorkerManager.heartbeat)
- POST `/api/worker/:id/lock` - request file locks (uses ConflictDetector.acquireLocks)
- POST `/api/worker/:id/unlock` - release file locks (uses ConflictDetector.releaseLocks)
- POST `/api/worker/:id/complete` - worker completed (uses WorkerManager.complete)
- POST `/api/worker/:id/fail` - worker failed (uses WorkerManager.fail)
- POST `/api/worker/:id/stuck` - worker stuck (uses WorkerManager.stuck)

### Management Routes
- GET `/api/status` - overall status (uses RateLimiter.getStatus + QueueManager.list)
- GET `/api/workers` - list workers (uses WorkerManager.list)
- POST `/api/workers/:id/kill` - kill worker (uses WorkerManager.kill)
- GET `/api/queue` - queue contents (uses QueueManager.list + QueueManager.getStats)
- GET `/api/metrics` - metrics (uses MetricsCollector.getSummary)
- GET `/api/learnings` - learnings (uses MetricsCollector.getLearnings)

## Implementation Details

### Server Factory Pattern
Export `createServer` function that takes dependencies (QueueManager, WorkerManager, etc.) and returns Express app. This enables testing with mocks.

### Request Validation
Use type guards to validate request bodies against shared types.

### Error Handling
- Wrap all handlers in try/catch
- Return consistent error format using ErrorResponse type
- Use appropriate HTTP status codes

### Response Format
- Success: Return appropriate response type from @factory/shared
- Error: Return ErrorResponse with `{ error, code?, details? }`

## Tests
- Unit tests with mocked dependencies
- Test each endpoint's happy path
- Test error handling (validation errors, not found, etc.)

## Exit Criteria
- [ ] server.ts compiles without errors
- [ ] All 16 endpoints implemented
- [ ] Tests pass for key endpoints
- [ ] Type check passes
