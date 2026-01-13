# Plan: Phase 3.1 - Wrap PR Creation in Try/Catch

## Goal
Wrap PR creation in `index.ts` with try/catch to handle unexpected errors and report partial success when the work was done but PR creation failed.

## Files to Modify
- `packages/worker/src/index.ts` - Add try/catch around PR creation, report partial success

## Changes

### 1. Wrap PR Creation in Try/Catch
The current code already handles PRResult status cases, but unexpected errors (like network failures, gh command not found, etc.) could throw exceptions that aren't caught.

Changes:
- Wrap `createPullRequest()` call in try/catch
- If exception is thrown, log detailed error message
- Report to orchestrator with partial success indicator
- Distinguish between "work done, PR failed" vs "work failed"

### 2. Report Partial Success
When Ralph succeeds but PR creation throws an exception:
- Log the full error with stack trace
- Still call `client.complete()` but with `null` prUrl
- Mark the work as partially successful (code done, PR failed)

## Tests
- Existing tests in `setup.test.ts` cover the PRResult cases
- Manual testing: The try/catch handles unexpected errors

## Exit Criteria
- [x] PR creation wrapped in try/catch
- [x] Unexpected errors logged with full details
- [x] Partial success reported when PR creation throws
- [x] Type checks pass
- [x] Existing tests pass
