# AI Factory Pipeline Fixes

## Goal
Fix the worker pipeline to reliably push commits and create PRs, and ensure tests actually run.

## Critical Issues

### 1. PR Creation Logic Bug
The `createPullRequest` function in `packages/worker/src/setup.ts` checks for uncommitted changes, but Ralph already commits. This causes the function to exit early without pushing.

### 2. Tests Not Actually Running
Claude marks "tests pass" but the worker container lacks test infrastructure (jest, vitest not installed). Tests are being faked/skipped.

## Tasks

### Phase 1: Fix PR Creation Flow
- [ ] Fix `createPullRequest` in `setup.ts` to check for unpushed commits instead of uncommitted changes
  - Use `git log origin/main..HEAD --oneline` or similar to detect unpushed commits
  - Always attempt push if there are commits ahead of origin
  - Remove the misleading "No changes to commit" early return
- [ ] Add better error logging to show exactly which step failed (stage, commit, push, pr create)
- [ ] Pass `GH_TOKEN` properly to `gh` command (currently only sets env, may need `--token` flag)

### Phase 2: Add Test Infrastructure to Worker
- [ ] Install Node.js test runners in worker Dockerfile
  - Add `npm install -g jest ts-jest @types/jest` or vitest
  - Ensure TypeScript compilation works (`tsc` available)
- [ ] Consider adding a validation step that actually runs `npm test` after Ralph completes
- [ ] Add timeout for test execution to prevent hung workers

### Phase 3: Improve Error Handling
- [ ] In `index.ts`, wrap PR creation in try/catch and report partial success
- [ ] Log full stderr/stdout from failed git/gh commands
- [ ] Add retry logic for transient network failures (push, gh api)

### Phase 4: Observability
- [ ] Add logging to show git commit history before push attempt
- [ ] Log the actual `gh pr create` command being run
- [ ] Track and report test execution results in worker metrics

## Acceptance Criteria
- [ ] Worker successfully pushes Ralph's commits to GitHub
- [ ] PR is created with link returned to orchestrator
- [ ] Tests actually execute (not just marked as passed)
- [ ] Failed steps produce actionable error messages
- [ ] Work item status updated to 'completed' with prUrl populated

## Technical Notes

### Current PR Flow Bug (setup.ts:150-156)
```typescript
// BUG: This checks for uncommitted changes, but Ralph already committed
const statusResult = await exec("git", ["status", "--porcelain"], { cwd: repoDir });
if (statusResult.stdout.trim() === "") {
  console.log("No changes to commit");  // Wrong - commits exist, just already staged
  return null;
}
```

### Fix Approach
```typescript
// Check for unpushed commits instead
const unpushedResult = await exec("git", ["rev-list", "--count", "origin/HEAD..HEAD"], { cwd: repoDir });
const unpushedCount = parseInt(unpushedResult.stdout.trim(), 10);
if (unpushedCount === 0) {
  console.log("No commits to push");
  return null;
}
// Skip the commit step (Ralph already did it), go straight to push
```

### Test Infrastructure
The current Dockerfile installs `nodejs` and `npm` from debian repos but no test frameworks. Need to add:
```dockerfile
RUN npm install -g jest ts-jest typescript @types/jest @types/node
```
