# Iteration 2 Plan: Add tsconfig.json matching other packages

## Goal
Create a TypeScript configuration file for the CLI package that matches the patterns used in other packages in the monorepo.

## Files to Create/Modify
- `packages/cli/tsconfig.json` - TypeScript configuration extending root config

## Implementation Steps
1. Read tsconfig.json from other packages (orchestrator, dashboard) to understand the pattern
2. Create tsconfig.json for CLI package that:
   - Extends the root tsconfig.json
   - Configures proper output directory (dist/)
   - Sets up proper module resolution
   - Includes src directory
   - Excludes node_modules and dist

## Tests
- Validate tsconfig.json is valid JSON
- Check that it follows the same structure as other packages
- Ensure it extends the root config properly

## Exit Criteria
- [ ] `packages/cli/tsconfig.json` exists
- [ ] Configuration extends root tsconfig.json
- [ ] Follows the same pattern as other packages
- [ ] Ready for TypeScript compilation

## Notes
- This is Phase 1, Task 2 from SPEC.md
- Need to match existing patterns in other packages
- Should work with the build scripts defined in package.json
