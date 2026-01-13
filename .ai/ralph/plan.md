# Plan: Phase 9.1 - Dashboard Package Setup

## Goal
Setup the dashboard package with Next.js 14+ App Router, API proxy to orchestrator, and Dockerfile.

## Files to Create/Modify
1. `packages/dashboard/package.json` - Package config with name @factory/dashboard
2. `packages/dashboard/tsconfig.json` - Next.js TypeScript config
3. `packages/dashboard/next.config.js` - Next.js config with API proxy
4. `packages/dashboard/app/layout.tsx` - Root layout
5. `packages/dashboard/app/page.tsx` - Placeholder home page
6. `packages/dashboard/Dockerfile` - Multi-stage Next.js build

## Tests
- Build verification with `bun run build`
- Type checking with `bun run typecheck`

## Exit Criteria
- [ ] package.json with Next.js 14+ dependencies
- [ ] tsconfig.json for Next.js
- [ ] next.config.js with API proxy to orchestrator
- [ ] Basic app/layout.tsx and app/page.tsx
- [ ] Dockerfile for production build
- [ ] All type checks pass
- [ ] Build succeeds
