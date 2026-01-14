# Iteration 3 Plan: Create entry point src/index.tsx with commander routing

## Goal
Create the main entry point for the CLI with commander for command routing. This will be the executable that runs when users type `whim`.

## Files to Create/Modify
- `packages/cli/src/index.tsx` - Main entry point with commander routing

## Implementation Steps
1. Create src directory
2. Create index.tsx with:
   - Shebang line for node execution
   - Import commander for CLI routing
   - Set up basic command structure
   - Add placeholder commands (dashboard will be added later)
   - Handle version and help automatically via commander
   - Add error handling

## Tests
- Verify the file compiles
- Check that the structure is correct for a CLI entry point
- Ensure it follows Ink/React patterns

## Exit Criteria
- [ ] `packages/cli/src/index.tsx` exists
- [ ] Has proper shebang for executable
- [ ] Uses commander for routing
- [ ] Ready to add dashboard command later
- [ ] File is valid TypeScript/React

## Notes
- This is Phase 1, Task 3 from SPEC.md
- Will need to be executable after build
- Dashboard command will be added in later tasks
- Should follow Ink conventions for CLI apps
