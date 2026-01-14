# Iteration 3 Plan: Database Tracking of Reviews

## Goal
Add database tracking for AI PR reviews to support audit trail and dashboard display.

## Task
- [ ] Review records appear in database (SPEC.md line 250)

## Implementation Steps

1. **Check existing database schema**
   - Read migrations/002_pr_reviews.sql (if exists)
   - Understand pr_reviews table structure

2. **Create or update migration**
   - Ensure pr_reviews table exists with required columns:
     - id, work_item_id, pr_number
     - review_timestamp, model_used
     - findings (JSONB)
     - Created/updated timestamps

3. **Update worker to save reviews**
   - Modify packages/worker/src/index.ts to save review to database
   - Add database insert after review completes
   - Store: work_item_id, pr_number, findings JSON, model, timestamp

4. **Update orchestrator database module**
   - Add pr_reviews table type in packages/orchestrator/src/db.ts
   - Add methods: insertReview, getReviewsByWorkItem, getReviewByPR

5. **Add tests**
   - Test review insertion
   - Test review retrieval

## Files to Check
- migrations/002_pr_reviews.sql (may exist from PR #9)
- packages/pr-review/src/tracker.ts (may have existing code)
- packages/shared/src/types.ts (add PRReview type if needed)

## Files to Create/Modify
- migrations/002_pr_reviews.sql (if missing)
- packages/shared/src/types.ts (PRReview interface)
- packages/worker/src/client.ts (add completeWithReview or update complete)
- packages/orchestrator/src/db.ts (add review methods)
- packages/orchestrator/src/server.ts (add GET /api/reviews/:workItemId endpoint)
- Test files for new functionality

## Exit Criteria
- pr_reviews table exists in schema
- Worker saves reviews to database
- Reviews can be retrieved by work_item_id or pr_number
- Tests pass
- Documentation updated
