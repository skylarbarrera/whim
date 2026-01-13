# Phase 2: Add Test Infrastructure to Worker

## Goal
Enable the worker container to actually run tests, rather than faking/skipping them.

## Files to Modify
- `packages/worker/Dockerfile` - Add test runners (jest, ts-jest, typescript)
- `packages/worker/src/testing.ts` - New module for test validation with timeout
- `packages/worker/src/testing.test.ts` - Tests for the testing module
- `packages/worker/src/index.ts` - Add test validation step after Ralph completes

## Implementation

### 1. Dockerfile Changes
Add to the runtime stage:
```dockerfile
RUN npm install -g jest ts-jest typescript @types/jest @types/node vitest
```

### 2. Testing Module (testing.ts)
Create a new module that:
- Runs `npm test` in the repo directory
- Has configurable timeout (default 5 minutes)
- Returns structured results (passed, failed, timed out)
- Captures stdout/stderr for debugging

### 3. Index.ts Integration
After Ralph completes successfully:
1. Run test validation step
2. Report test results in metrics
3. Consider test failure as partial success (still create PR, but note test failures)

## Exit Criteria
- [ ] Worker Dockerfile includes jest, typescript, vitest
- [ ] testing.ts module with runTests function and timeout support
- [ ] Tests for testing.ts
- [ ] Integration in index.ts
- [ ] All existing tests pass
