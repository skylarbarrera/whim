# Iteration 12 Plan: Add --api-url flag and whim status command (Phase 4)

## Goal
Add support for configuring the API URL and create a simple status command for quick checks. These are high-value, low-complexity items from Phase 4.

## Files to Create/Modify
- `packages/cli/src/index.tsx` - Add --api-url flag support and status command
- `packages/cli/src/commands/dashboard.tsx` - Accept apiUrl prop
- `packages/cli/src/hooks/useApi.ts` - Already supports apiUrl parameter

## Implementation Steps
1. Update index.tsx to:
   - Pass --api-url option value to Dashboard component
   - Create new 'status' command that shows one-line summary
2. Update Dashboard to:
   - Accept optional apiUrl prop
   - Pass it to useApi hook
3. Create simple status command that:
   - Fetches /api/status once
   - Shows brief summary line
   - Good for scripts and quick checks

## Tests
- Verify --api-url flag works
- Check that status command outputs simple format

## Exit Criteria
- [ ] --api-url flag functional
- [ ] Dashboard accepts and uses custom API URL
- [ ] whim status command exists and works
- [ ] Tasks marked complete

## Notes
- These are Phase 4, Tasks 4 and 7 from SPEC.md
- Skipping logs viewer and config file for now (more complex)
- Error handling already exists in dashboard
- Focus on highest value, simplest items
