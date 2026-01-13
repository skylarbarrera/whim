# Plan: Phase 10 - Integration Testing and Validation

## Goal
Verify all packages build correctly and the full system works end-to-end via docker-compose.

## Tasks
1. **Verify all packages build with `bun build`**
   - Run `bun install` at root
   - Run `bun run build` to build all packages
   - Fix any TypeScript or build errors

2. **Test docker-compose brings all services online**
   - Run `docker compose up` and verify:
     - postgres starts and accepts connections
     - redis starts and accepts connections
     - orchestrator starts and serves API
     - intake starts (may fail without GITHUB_TOKEN, expected)
     - dashboard starts and serves UI

3. **Test end-to-end flow**
   - Create work item via API
   - Verify queue status shows item
   - (Worker spawn would need real Claude CLI - document limitation)

4. **Document issues in `.ai/new-learnings.md`**
   - Record any issues found
   - Note fixes applied
   - Document limitations

## Files to Modify/Create
- Fix any build errors in packages/*
- `.ai/new-learnings.md` - Document findings

## Exit Criteria
- All packages build without errors
- docker-compose up starts all services
- Orchestrator API responds at /api/status
- Dashboard UI loads at http://localhost:3000
- Issues documented in `.ai/new-learnings.md`
