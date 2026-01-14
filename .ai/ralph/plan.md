# Iteration 10 Plan: Add detailed WORKERS and QUEUE sections

## Goal
Enhance the dashboard to display detailed worker cards and queue items with all required information from the spec.

## Files to Create/Modify
- `packages/cli/src/commands/dashboard.tsx` - Update to show detailed worker and queue information

## Implementation Steps
1. Read the current dashboard.tsx
2. Add detailed worker card rendering:
   - id (in blue per spec)
   - repo (white bold per spec)
   - branch (magenta per spec)
   - iteration
   - progress bar using ProgressBar component
   - tokens (in/out)
   - cost (yellow per spec)
   - Spinner for active workers
3. Add detailed queue item rendering:
   - repo (white bold)
   - branch (magenta)
   - priority
   - status (with appropriate colors: yellow for queued, green for active, etc.)
4. Apply color scheme from spec

## Tests
- Verify all required fields are displayed
- Check that colors match specification
- Ensure ProgressBar is used for worker progress

## Exit Criteria
- [ ] Worker cards show all required fields
- [ ] Worker cards use correct colors from spec
- [ ] Worker progress bar displays correctly
- [ ] Queue items show all required fields
- [ ] Queue items use correct status colors
- [ ] Phase 2 fully complete

## Notes
- This is Phase 2, Tasks 6-7 from SPEC.md
- Completes Phase 2 implementation
- Color scheme: Worker ID=Blue, Repo=White bold, Branch=Magenta, Costs=Yellow, Status colors vary
