# Iteration 11 Plan: Add keyboard navigation (Phase 3)

## Goal
Implement keyboard controls for the dashboard to allow user interaction. This completes Phase 3 functionality.

## Files to Create/Modify
- `packages/cli/src/commands/dashboard.tsx` - Add keyboard handler using useInput hook from Ink

## Implementation Steps
1. Import useInput hook from Ink
2. Implement keyboard handler with the following keys:
   - 'q' - quit dashboard (exit app)
   - 'r' - force refresh (call refetch)
   - '?' - show help overlay (can be placeholder for now)
   - 'w' - focus workers section (placeholder for future)
   - 'u' - focus queue section (placeholder for future)
   - 'k' - kill selected worker (placeholder - needs API call)
   - 'c' - cancel selected queue item (placeholder - needs API call)
   - Arrow keys - navigate items (placeholder for future)
3. Add state for showing help overlay if needed
4. Connect refetch function from useApi to 'r' key

## Tests
- Verify keyboard handler is connected
- Check that 'q' and 'r' work properly
- Ensure other keys have placeholder handlers

## Exit Criteria
- [ ] useInput hook integrated
- [ ] 'q' key quits the app
- [ ] 'r' key refreshes data
- [ ] Other keys have placeholder handlers
- [ ] Phase 3 tasks marked complete

## Notes
- This covers Phase 3 from SPEC.md
- Some functionality (navigation, kill, cancel) are placeholders for now
- Help overlay can be simple or placeholder
- Focus on core quit and refresh functionality
