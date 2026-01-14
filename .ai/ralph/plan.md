# Iteration 7 Plan: Create src/hooks/useApi.ts - orchestrator API client with polling

## Goal
Create a custom React hook that fetches data from the orchestrator API and polls for updates. This will provide real-time dashboard data.

## Files to Create/Modify
- `packages/cli/src/hooks/useApi.ts` - Custom hook for API client with polling

## Implementation Steps
1. Create hooks directory
2. Look at @whim/shared types to understand API response structure
3. Create useApi hook that:
   - Takes API endpoint URL as parameter
   - Takes poll interval (default 2s per spec)
   - Uses useState for data, loading, error states
   - Uses useEffect for polling with setInterval
   - Fetches data using native fetch API
   - Returns { data, loading, error, refetch }
   - Cleans up interval on unmount
   - TypeScript types properly defined with generics

## Tests
- Verify the hook follows React patterns
- Check that polling works correctly
- Ensure proper cleanup happens

## Exit Criteria
- [ ] `packages/cli/src/hooks/useApi.ts` exists
- [ ] Hook fetches data from API endpoint
- [ ] Polls every 2 seconds by default
- [ ] Returns data, loading, error, refetch
- [ ] Properly cleans up on unmount
- [ ] TypeScript types with generics

## Notes
- This is Phase 1, Task 7 from SPEC.md
- Spec says "Poll API every 2s"
- Need to check shared types for API response structure
- Will be used by dashboard command to fetch worker/queue data
