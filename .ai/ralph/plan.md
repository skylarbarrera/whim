# Plan: Create Merge Blocking System

## Goal
Implement the merge blocking system that enforces review requirements through branch protection rules and status checks, preventing merges when required checks fail.

## Current State
- PR review core functionality complete (detection, tracking, aggregation)
- Lint and test checks implemented with BaseCheck framework
- Database schema includes merge_blocked flag on pr_reviews table
- No integration with GitHub Branch Protection or Status API yet

## Files to Create/Modify

### New Files
1. `packages/pr-review/src/github-status.ts` - GitHub Status API client
2. `packages/pr-review/src/branch-protection.ts` - Branch protection manager
3. `packages/pr-review/src/merge-guardian.ts` - Merge prevention logic
4. `packages/pr-review/tests/github-status.test.ts` - Status API tests
5. `packages/pr-review/tests/branch-protection.test.ts` - Protection tests
6. `packages/pr-review/tests/merge-guardian.test.ts` - Guardian tests

### Modified Files
1. `packages/pr-review/src/service.ts` - Integrate status reporting
2. `packages/pr-review/src/index.ts` - Export new modules
3. `packages/shared/src/types.ts` - Add GitHub status types if needed

## Implementation Steps

### Step 1: GitHub Status API Client
Create `github-status.ts` with:
- `GitHubStatusClient` class
- `createStatus()` - POST to /repos/:owner/:repo/statuses/:sha
- `getStatuses()` - GET statuses for a commit
- Status context: "ai-factory/pr-review"
- States: pending, success, failure, error
- Target URL to dashboard review page
- Description with check summary

### Step 2: Branch Protection Manager
Create `branch-protection.ts` with:
- `BranchProtectionManager` class
- `getProtection()` - GET branch protection rules
- `updateProtection()` - PUT branch protection rules
- `addRequiredStatusCheck()` - Add "ai-factory/pr-review" to required checks
- `removeRequiredStatusCheck()` - Remove from required checks
- Handle repos without branch protection gracefully
- Support multiple branch patterns (main, master, develop, etc.)

### Step 3: Merge Prevention Logic
Create `merge-guardian.ts` with:
- `MergeGuardian` class
- `canMerge(reviewId)` - Check if PR can be merged
- `blockMerge(reviewId, reason)` - Update status to blocked
- `allowMerge(reviewId)` - Update status to allowed
- `isOverridden(reviewId)` - Check override status
- Logic:
  - All required checks must be 'success'
  - No required checks in 'pending' or 'running' state
  - No failed required checks (unless overridden)
  - Returns MergeDecision with allowed flag, reason, failedChecks[]

### Step 4: Emergency Override
Add to `merge-guardian.ts`:
- `override(reviewId, user, reason)` - Emergency override
- Records override in database (calls tracker.markOverridden)
- Updates GitHub status to success with override note
- Sends notification (console log for now, webhook later)
- Validates user has permission (accept any for now)

### Step 5: Integrate with ReviewService
Update `service.ts`:
- Inject GitHubStatusClient and MergeGuardian
- After check completion in runCheck():
  - Call guardian.canMerge()
  - Call statusClient.createStatus() with result
  - Update merge_blocked in database
- Add new methods:
  - `syncProtection(repo, branch)` - Ensure protection rules exist
  - `reportStatus(reviewId)` - Update GitHub status
  - `overrideReview(reviewId, user, reason)` - Emergency override

### Step 6: Tests
Write comprehensive tests:
- Mock Octokit for GitHub API calls
- Test status creation (pending, success, failure)
- Test branch protection updates
- Test merge decision logic (all checks pass, some fail, override)
- Test override recording and status update
- Edge cases: no checks, all optional, already overridden

## Exit Criteria
- [x] GitHubStatusClient reports check results to GitHub
- [x] BranchProtectionManager configures required status checks
- [x] MergeGuardian determines merge eligibility from check results
- [x] Emergency override mechanism works and records audit trail
- [x] ReviewService integrates all components
- [x] All tests pass (aim for 15+ new tests)
- [x] Package builds without errors
- [x] Types integrate with @factory/shared

## Sub-bullets from SPEC.md
- [ ] Implement branch protection rules
- [ ] Add status check requirements
- [ ] Create merge prevention logic
- [ ] Add override mechanisms for emergencies

All 4 sub-bullets will be completed in this iteration.
