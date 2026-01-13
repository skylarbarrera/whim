# Plan: Phase 2 - Shared Package

## Goal
Create the `packages/shared` package with all shared types for the AI Software Factory.

## Files to Create

1. `packages/shared/package.json` - Package config with name `@factory/shared`
2. `packages/shared/tsconfig.json` - Extends root tsconfig
3. `packages/shared/src/types.ts` - All shared type definitions
4. `packages/shared/src/index.ts` - Re-exports all types

## Types to Define (from SPEC.md)

- `WorkItem`, `WorkItemStatus`, `Priority`
- `Worker`, `WorkerStatus`
- `Learning`
- `WorkerMetrics`, `FactoryMetrics`
- API request/response types:
  - `WorkerRegisterRequest`
  - `WorkerHeartbeatRequest`
  - etc.

## Exit Criteria

1. `bun install` succeeds at root
2. `bun run typecheck` passes
3. Package exports all types correctly
4. All 4 tasks in SPEC Phase 2 marked complete
