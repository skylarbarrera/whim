# Plan: Implement Core PR Review Functionality

## Goal
Implement the core PR review system with detection, tracking, and aggregation capabilities.

## Context
Phase 1 (Design PR Review System Architecture) is complete. We have:
- Architecture document with component design
- Database schema (migrations/002_pr_reviews.sql)
- TypeScript types in shared package
- Integration points documented

Now we need to implement the core functionality:
1. PR review service/handler - Main orchestrator
2. AI-generated PR detection logic - Identify AI PRs
3. Review status tracking - Manage review lifecycle
4. Review result aggregation - Combine check results

## Approach

### 1. Package Structure
Create new `packages/pr-review` with:
- detector.ts - AI PR detection
- tracker.ts - Review status tracking
- aggregator.ts - Result aggregation
- service.ts - Main review service
- types.ts - Local types (re-export from shared)

### 2. PR Detector
Implement detection based on:
- Co-author pattern: "Co-Authored-By: Claude Sonnet 4.5"
- Branch name pattern: "ai/issue-*"
- Labels: "ai-generated"
- Return confidence score + reasons

### 3. Review Tracker
Implement lifecycle management:
- createReview() - Insert pr_reviews row
- updateReviewStatus() - State transitions
- recordCheck() - Insert pr_review_checks row
- updateCheck() - Update check result
- getReview() - Fetch review with checks
- markOverridden() - Record manual override

### 4. Result Aggregator
Implement logic to:
- Collect all check results
- Determine if required checks passed
- Calculate merge_blocked status
- Generate summary message
- Return AggregatedResult

### 5. Review Service
Tie it all together:
- detectAndCreateReview() - Entry point for new PRs
- runChecks() - Coordinate check execution (placeholder)
- aggregateResults() - Call aggregator
- updateMergeStatus() - Report to GitHub
- getReviewStatus() - Query review state

## Files to Create

### New Package
- `packages/pr-review/package.json`
- `packages/pr-review/tsconfig.json`
- `packages/pr-review/src/index.ts` - Exports
- `packages/pr-review/src/detector.ts` - Detection logic
- `packages/pr-review/src/tracker.ts` - Status tracking
- `packages/pr-review/src/aggregator.ts` - Result aggregation
- `packages/pr-review/src/service.ts` - Main service

### Tests
- `packages/pr-review/src/detector.test.ts`
- `packages/pr-review/src/tracker.test.ts`
- `packages/pr-review/src/aggregator.test.ts`
- `packages/pr-review/src/service.test.ts`

## Files to Modify
- Root `package.json` - Add pr-review to workspaces (already included via packages/*)

## Exit Criteria
- [ ] Package builds successfully
- [ ] All 4 components implemented with interfaces
- [ ] Detector identifies AI PRs with confidence scores
- [ ] Tracker manages review lifecycle in database
- [ ] Aggregator combines check results correctly
- [ ] Service ties components together
- [ ] All unit tests pass
- [ ] Type checks pass

## Notes
- Use Database class from orchestrator (import pattern)
- Focus on core logic, not GitHub API integration (that's Phase 6)
- Checks will be placeholder/stub for now (detailed in Phase 3-4)
- This creates the foundation for the review system
