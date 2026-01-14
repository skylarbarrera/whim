# Iteration 5 Plan: Create src/components/Spinner.tsx - animated spinner (◐◓◑◒)

## Goal
Create an animated spinner component that cycles through the characters ◐◓◑◒ to indicate loading or activity. This will be used for active workers and refresh indicators.

## Files to Create/Modify
- `packages/cli/src/components/Spinner.tsx` - Animated spinner component

## Implementation Steps
1. Create Spinner.tsx component that:
   - Cycles through spinner frames: ◐◓◑◒
   - Uses React hooks (useState, useEffect) for animation
   - Has configurable interval (default ~100ms)
   - Can be used inline with other text
   - TypeScript types properly defined

## Tests
- Verify the component follows Ink patterns
- Check that it exports properly
- Ensure animation timing makes sense

## Exit Criteria
- [ ] `packages/cli/src/components/Spinner.tsx` exists
- [ ] Component animates through ◐◓◑◒ frames
- [ ] Uses React hooks for animation
- [ ] Can be used inline
- [ ] TypeScript types are properly defined

## Notes
- This is Phase 1, Task 5 from SPEC.md
- Will be used for active workers and refresh indicator
- Animation should be smooth and not too fast
- Should work well in terminal output
