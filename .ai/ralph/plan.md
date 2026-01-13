# Plan: Phase 9.2 - Dashboard Pages and Components

## Goal
Implement dashboard pages and shared components for monitoring the AI Factory.

## Files to Create/Modify
1. `packages/dashboard/app/page.tsx` - Overview/factory status summary
2. `packages/dashboard/app/workers/page.tsx` - List workers, kill button
3. `packages/dashboard/app/queue/page.tsx` - List queue, cancel button
4. `packages/dashboard/app/learnings/page.tsx` - Browse learnings
5. `packages/dashboard/app/metrics/page.tsx` - Basic metrics display
6. `packages/dashboard/components/StatusCard.tsx` - Reusable status card
7. `packages/dashboard/components/DataTable.tsx` - Reusable data table
8. `packages/dashboard/components/Navigation.tsx` - Navigation component
9. `packages/dashboard/app/layout.tsx` - Update with navigation

## Tests
- Build verification with `bun run build`
- Type checking with `bun run typecheck`

## Exit Criteria
- [ ] Overview page with status summary
- [ ] Workers page with list and kill button
- [ ] Queue page with list and cancel button
- [ ] Learnings page for browsing
- [ ] Metrics page with basic display
- [ ] Shared components (StatusCard, DataTable, Navigation)
- [ ] All type checks pass
- [ ] Build succeeds
