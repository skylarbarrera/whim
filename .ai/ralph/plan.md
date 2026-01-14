# Iteration 6 Plan: Create src/components/ProgressBar.tsx - animated progress bar

## Goal
Create a progress bar component that shows task completion progress. Will be used to display worker iteration progress.

## Files to Create/Modify
- `packages/cli/src/components/ProgressBar.tsx` - Animated progress bar component

## Implementation Steps
1. Create ProgressBar.tsx component that:
   - Takes percent (0-100) as prop
   - Renders filled portion in green (per spec)
   - Renders empty portion in gray dim (per spec)
   - Has configurable width (default ~20 chars)
   - Shows visual progress with characters like █ or ━
   - TypeScript types properly defined

## Tests
- Verify the component follows Ink patterns
- Check that it exports properly
- Ensure colors match spec (green filled, gray dim empty)

## Exit Criteria
- [ ] `packages/cli/src/components/ProgressBar.tsx` exists
- [ ] Component takes percent prop
- [ ] Filled portion is green
- [ ] Empty portion is gray dim
- [ ] Visual representation is clear
- [ ] TypeScript types are properly defined

## Notes
- This is Phase 1, Task 6 from SPEC.md
- Color scheme from spec: Progress filled = Green, Progress empty = Gray dim
- Will be used in worker cards to show iteration progress
- Should be compact and readable in terminal
