# Iteration 9 Plan: Create src/commands/dashboard.tsx - main dashboard view

## Goal
Create the main dashboard view that will display the orchestrator status, workers, queue, and metrics. This is the first task of Phase 2.

## Files to Create/Modify
- `packages/cli/src/commands/dashboard.tsx` - Main dashboard view component

## Implementation Steps
1. Create commands directory
2. Review SPEC.md for dashboard layout requirements:
   - STATUS section (running state, worker count, queue depth)
   - WORKERS section with live worker cards
   - QUEUE section with pending items
   - TODAY section (completed, failed, iterations, cost)
   - Footer with keyboard hints
   - Poll API every 2s with refresh spinner
3. Create dashboard.tsx that:
   - Uses useApi hook to fetch data
   - Uses Section component for layout
   - Uses Spinner for active workers and refresh indicator
   - Displays placeholder sections for now (detailed content in next tasks)
   - Proper TypeScript types from @whim/shared

## Tests
- Verify component structure
- Check that it uses the hooks and components created in Phase 1
- Ensure proper imports

## Exit Criteria
- [ ] `packages/cli/src/commands/dashboard.tsx` exists
- [ ] Uses useApi hook for data fetching
- [ ] Basic layout with Section components
- [ ] Ready for detailed section implementation
- [ ] TypeScript types properly defined

## Notes
- This is Phase 2, Task 1 from SPEC.md
- Will be enhanced in subsequent tasks with detailed sections
- Should poll API every 2 seconds as specified
