# Plan: ConflictDetector Implementation

## Goal
Create `packages/orchestrator/src/conflicts.ts` - a ConflictDetector class that manages file locks to prevent multiple workers from editing the same files simultaneously.

## Files to Create/Modify
- `packages/orchestrator/src/conflicts.ts` (create) - ConflictDetector class
- `packages/orchestrator/src/conflicts.test.ts` (create) - unit tests

## Interface (from SPEC.md)
```typescript
class ConflictDetector {
  acquireLocks(workerId: string, files: string[]): Promise<{ acquired: string[]; blocked: string[] }>
  releaseLocks(workerId: string, files: string[]): Promise<void>
  releaseAllLocks(workerId: string): Promise<void>
}
```

## Implementation Details
1. Uses the `file_locks` table from migration 001:
   - `id` UUID PRIMARY KEY
   - `worker_id` UUID NOT NULL REFERENCES workers(id)
   - `file_path` TEXT NOT NULL
   - `acquired_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - UNIQUE (file_path) -- Only one worker can hold a lock on a file

2. `acquireLocks` - Try to insert locks for files, returning which were acquired vs blocked by other workers
3. `releaseLocks` - Delete specific file locks owned by the worker
4. `releaseAllLocks` - Delete all file locks owned by the worker (cleanup on completion/failure)

## Tests
1. Test acquiring locks on free files
2. Test acquiring locks when some are taken by another worker
3. Test releasing specific locks
4. Test releasing all locks for a worker
5. Test that a worker can re-acquire its own locks (idempotent)
6. Test acquiring empty file list

## Exit Criteria
- [x] ConflictDetector class created with all 3 methods
- [ ] Unit tests pass
- [ ] TypeScript compiles without errors
