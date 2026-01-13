# Plan: Phase 4.2 - Database & Redis Clients

## Goal
Create PostgreSQL and Redis client wrappers for the orchestrator package.

## Files to Create
1. `packages/orchestrator/src/db.ts` - PostgreSQL client wrapper
2. `packages/orchestrator/src/redis.ts` - Redis client wrapper

## Implementation Details

### db.ts
- Create a Database class wrapping the `pg` Pool
- Provide typed query helper methods
- Include helper functions for common operations (row to entity mapping)
- Camelcase conversion for column names (snake_case DB → camelCase TS)
- Connection management (connect/disconnect)

### redis.ts
- Create a RedisClient class wrapping `ioredis`
- Provide typed methods for common operations (get, set, incr, expire)
- Connection management (connect/disconnect)
- Key prefix support for namespacing

## Tests
- Type checks via `bun run typecheck` in orchestrator package

## Exit Criteria
- [ ] Both files compile without errors
- [ ] Types align with @factory/shared types
- [ ] Code follows patterns established in shared package
