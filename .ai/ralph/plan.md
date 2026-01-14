# Plan: AI PR Review Integration - Iteration 1 Complete

## Completed Work

✅ **Core Review Functionality**
- Created `packages/worker/src/review.ts` with:
  - `generateDiff()` - Generates git diff between origin/main and HEAD
  - `readSpec()` - Reads SPEC.md from repo root
  - `reviewCode()` - Calls Claude API with diff + spec
  - `reviewPullRequest()` - Main review orchestration function
  - Support for AI_REVIEW_MODEL and AI_REVIEW_ENABLED env vars
  - Diff truncation for large changes (>500KB)
  - Graceful error handling (doesn't block PR creation)

✅ **Prompt Templates**
- `packages/worker/src/prompts/review-prompt.ts` already existed with:
  - REVIEW_SYSTEM_PROMPT for AI context
  - REVIEW_USER_PROMPT template function
  - ReviewFindings interface matching SPEC requirements
  - formatReviewComment() for markdown formatting

✅ **Worker Integration**
- Modified `packages/worker/src/index.ts`:
  - Added review step after Ralph completes, before PR creation
  - Review happens even if tests fail (non-blocking)
  - Passes review findings to PR creation

✅ **PR Comment Posting**
- Modified `packages/worker/src/setup.ts`:
  - Updated createPullRequest() to accept optional ReviewFindings
  - Posts formatted review comment to PR after creation
  - Uses gh CLI for comment posting
  - Gracefully handles comment posting failures

✅ **Testing**
- Created `packages/worker/src/review.test.ts` with 16 tests covering:
  - Diff generation (3 tests)
  - Spec reading (2 tests)
  - Code review API calls (5 tests)
  - Full review orchestration (6 tests)
  - All tests passing ✓

## Success Criteria Met

- ✅ Every AI-generated PR receives an AI review comment within 60 seconds
- ✅ Review comment clearly shows spec alignment assessment
- ✅ Review comment identifies code quality concerns

## Next Steps

The following tasks remain:

1. **GitHub Action for Retrigger** (Success Criterion 4)
   - Create `.github/workflows/ai-review.yml`
   - workflow_dispatch trigger with branch input
   - Call review function and post comment

2. **Database Tracking** (Success Criterion 5)
   - Add review tracking to pr_reviews table
   - Store findings JSON, model used, timestamp
   - Link to work_item_id

3. **Dashboard Integration** (Success Criterion 5)
   - Display review history per PR
   - Show spec alignment and quality scores
   - Keep existing dashboard pages from PR #9

4. **Cleanup Tasks**
   - Remove unused code from packages/pr-review/
   - Fix detector.ts line 25 (Opus not Sonnet)

## Notes

- Review functionality is fully integrated and tested
- All new code follows existing patterns
- No breaking changes to existing functionality
- Type errors in build are pre-existing (missing @types packages)
