# Plan: Phase 3.2 - Log Full stderr/stdout from Failed Git/GH Commands

## Goal
Ensure all git and gh command failures log full stdout/stderr for debugging.

## Current State
- `createPullRequest()` already uses `logCommandFailure()` helper for all git/gh commands
- `setupWorkspace()` has several git commands that don't log errors properly:
  - Line 128: `ralph init` - only logs stderr as warning
  - Line 134-135: `git add -A` and `git commit` - no error logging (fail silently)
  - Line 141, 144: `git config` - no error checking

## Files to Modify
- `packages/worker/src/setup.ts`

## Changes

### 1. Add Error Logging to setupWorkspace()
The following commands currently fail silently or don't log complete info:

**git config commands (lines 141-146):**
- Add error logging for git config failures
- These are critical - if they fail, commits will fail later

**Initial git add and commit (lines 134-135):**
- Add error logging for the initial workspace commit
- Use same pattern as createPullRequest()

**ralph init (line 128-131):**
- Currently only logs stderr on warning
- Should also log stdout and exit code for debugging

## Tests
- Existing tests should continue to pass
- Run `bun test` in packages/worker

## Exit Criteria
- [ ] All git commands in setupWorkspace() log errors on failure
- [ ] ralph init logs full output on warning/failure
- [ ] git config failures are logged
- [ ] Type checks pass
- [ ] Existing tests pass
