# Plan: Phase 4.3 - QueueManager Implementation

## Goal
Create `packages/orchestrator/src/queue.ts` with the QueueManager class that handles all work item queue operations.

## Files to Create/Modify
- `packages/orchestrator/src/queue.ts` (CREATE)

## API Methods (from SPEC)
1. `add(input)` - Add work item to queue
2. `get(id)` - Get work item by ID
3. `getNext()` - Get highest priority queued item (with row locking)
4. `cancel(id)` - Cancel work item
5. `list()` - List active work items
6. `getStats()` - Get queue statistics

## Implementation Details

### Dependencies
- Database class from `./db.ts`
- Types from `@factory/shared`

### Priority Logic
- Queue ordered by: priority DESC (critical > high > medium > low), then created_at ASC (FIFO within same priority)
- Use FOR UPDATE SKIP LOCKED for safe concurrent access

### Status Transitions
- `add()`: Creates with status "queued"
- `getNext()`: Sets status to "assigned" atomically
- `cancel()`: Sets status to "cancelled" (only if not yet in_progress)

### Statistics
- Total count
- Count by status
- Count by priority

## Tests
No tests required per iteration policy (type checks verify correctness).

## Exit Criteria
1. File compiles without errors
2. All methods from SPEC implemented
3. Types match @factory/shared
