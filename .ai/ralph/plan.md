# Iteration 14 Plan: Add ~/.whimrc config file support (Phase 4)

## Goal
Implement support for a configuration file at ~/.whimrc so users don't have to pass --api-url every time. This is one of the remaining Phase 4 tasks and is self-contained.

## Files to Create/Modify
- `packages/cli/src/config.ts` - New file to read and parse config file
- `packages/cli/src/index.tsx` - Use config file to set default API URL

## Implementation Steps
1. Create config.ts module that:
   - Reads ~/.whimrc if it exists
   - Parses simple key=value format
   - Returns configuration object
   - Handles errors gracefully (missing file is OK)
2. Update index.tsx to:
   - Load config at startup
   - Use config.apiUrl as default for --api-url option
   - CLI flags override config file values
3. Document the config file format in README

## Tests
- Verify config file is read if present
- Check that CLI flags override config
- Ensure missing config doesn't break anything

## Exit Criteria
- [ ] config.ts module created and working
- [ ] Config file loaded at startup
- [ ] CLI flags override config values
- [ ] Task marked complete

## Notes
- This is Phase 4, Task 5 from SPEC.md
- Simple key=value format: apiUrl=http://localhost:3000
- Stored at ~/.whimrc
- Optional - missing file is fine
