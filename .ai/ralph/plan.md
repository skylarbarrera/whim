# Plan: Add Better Error Logging to PR Creation

## Goal
Add structured error logging to `createPullRequest` in `packages/worker/src/setup.ts` to show exactly which step failed (stage, commit, push, pr create) with full command details and output.

## Current State
The function already has `[PR]` prefixed logging but:
- Returns `null` on failure without indicating which specific step failed
- Callers can't distinguish between "no commits to push" (expected) vs "push failed" (error)
- Missing command details when failures occur

## Changes

### 1. Add PRStep enum and PRResult type
Define clear step identifiers and a result type that captures:
- Success/failure status
- Which step was reached
- Error details (command, stdout, stderr)

### 2. Modify createPullRequest to return structured result
Instead of `string | null`, return `PRResult` with:
- `status: 'success' | 'no_changes' | 'error'`
- `step: PRStep` (where it completed or failed)
- `prUrl?: string` (on success)
- `error?: { step: PRStep, command: string, exitCode: number, stdout: string, stderr: string }`

### 3. Add helper for logging failed commands
Create `logCommandFailure(step, command, args, result)` that logs:
- Step that failed
- Full command with args
- Exit code
- stdout and stderr

## Files to Modify
- `packages/worker/src/setup.ts` - Add types and improve logging

## Tests
- Existing tests should still pass (run `bun test`)
- Type check with `bun run build` in packages/worker

## Exit Criteria
- [ ] PRStep enum with: STAGE, COMMIT, CHECK_UNPUSHED, PUSH, CREATE_PR
- [ ] PRResult type with status, step, prUrl, error fields
- [ ] logCommandFailure helper logs full command details
- [ ] createPullRequest returns PRResult instead of string | null
- [ ] Type checks pass
- [ ] Tests pass
