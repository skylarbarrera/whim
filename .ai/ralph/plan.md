# Iteration 1 Plan: Create packages/cli with package.json

## Goal
Create the foundation for the new Ink-based CLI dashboard by setting up the `packages/cli` package with proper dependencies and configuration.

## Files to Create/Modify
- `packages/cli/package.json` - New package manifest with Ink, React, Chalk, and Commander dependencies
- May need to update root `package.json` or workspace configuration

## Implementation Steps
1. Create `packages/cli` directory structure
2. Create `package.json` with:
   - Package name: `@whim/cli`
   - Dependencies: ink, react, chalk, commander, @whim/shared
   - Dev dependencies: TypeScript, @types/react, @types/node
   - Build scripts matching other packages
   - Proper bin entry for `whim` command
3. Verify the package is recognized by the workspace

## Tests
- Run `bun install` to verify dependencies resolve
- Check that the workspace recognizes the new package
- Verify package.json is valid JSON

## Exit Criteria
- [ ] `packages/cli/package.json` exists with all required dependencies
- [ ] `bun install` completes successfully
- [ ] Package follows the same structure as other packages in the workspace

## Notes
- This is Phase 1, Task 1 from SPEC.md
- Need to ensure compatibility with existing Bun workspace setup
- The `whim` bin command will be defined but not yet functional
