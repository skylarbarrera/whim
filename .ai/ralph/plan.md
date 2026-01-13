# Plan: Phase 3.3 - Add Retry Logic for Transient Network Failures

## Goal
Add retry logic for git push and gh pr create to handle transient network failures.

## Files to Modify
- `packages/worker/src/setup.ts`

## Changes

### 1. Create retry helper function
```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    delayMs?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {}
): Promise<T>
```

Features:
- Configurable max retries (default: 3)
- Exponential backoff with jitter
- Custom retry predicate for error types
- Logs retry attempts

### 2. Apply retry to git push
In `createPullRequest()`, wrap the push command with retry logic:
- Retry on network errors (connection reset, timeout)
- Retry on HTTP 5xx errors from GitHub
- Max 3 retries with exponential backoff

### 3. Apply retry to gh pr create
In `createPullRequest()`, wrap the PR creation with retry logic:
- Retry on network errors
- Retry on API rate limiting (HTTP 429)
- Retry on HTTP 5xx errors
- Max 3 retries with exponential backoff

## Tests
- Add unit tests for withRetry helper
- Add tests for retry behavior in push/pr scenarios

## Exit Criteria
- [ ] withRetry helper implemented and tested
- [ ] git push uses retry logic
- [ ] gh pr create uses retry logic
- [ ] Retries logged for debugging
- [ ] Type checks pass
- [ ] All tests pass
