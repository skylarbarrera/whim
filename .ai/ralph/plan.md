# Iteration 4 Plan: Dashboard Integration for Review History

## Goal
Add dashboard page to display AI PR review history.

## Task
- [ ] Review history is visible in dashboard (SPEC.md line 21, 251)

## Implementation Steps

1. **Add API endpoint to orchestrator**
   - GET /api/reviews - List all reviews with optional filters
   - GET /api/reviews/work-item/:id - Get reviews for specific work item
   - GET /api/reviews/pr/:number - Get review for specific PR

2. **Create dashboard page**
   - app/reviews/page.tsx - Reviews list page
   - Display review history with filters
   - Show spec alignment and code quality scores
   - Link to PRs and work items
   - Format findings in readable way

3. **Update navigation**
   - Add "Reviews" link to navigation

4. **Test the integration**
   - Verify API endpoints work
   - Verify dashboard page renders

## Files to Modify
- `packages/orchestrator/src/server.ts` - Add review endpoints
- `packages/dashboard/components/Navigation.tsx` - Add Reviews link
- `packages/dashboard/app/reviews/page.tsx` - Create reviews page
- `SPEC.md` - Mark task complete
- `STATE.txt` - Update completion status

## Exit Criteria
- API endpoint returns review history
- Dashboard displays reviews with scores
- Navigation includes Reviews page
- All tasks in SPEC.md complete
- Documentation updated
