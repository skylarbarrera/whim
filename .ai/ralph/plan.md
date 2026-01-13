# Plan: Phase 4.1 - Orchestrator Package Setup

## Goal
Set up the `@factory/orchestrator` package with proper configuration and dependencies.

## Files to Create
- `packages/orchestrator/package.json` - package definition
- `packages/orchestrator/tsconfig.json` - TypeScript config
- `packages/orchestrator/src/index.ts` - placeholder entry point

## Dependencies
- express - HTTP server
- pg - PostgreSQL client
- ioredis - Redis client
- dockerode - Docker SDK
- uuid - UUID generation
- @types/* for TypeScript support

## Exit Criteria
- [x] package.json exists with correct name and dependencies
- [x] tsconfig.json extends root config
- [x] Package can be built without errors
- [x] Turborepo recognizes the new package
