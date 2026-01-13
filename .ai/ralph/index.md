# Ralph Session Index

## Session 1 - 2025-01-12

### Task: Phase 1 - Project Scaffolding

**Commit:** 80a1e51

**Files Created/Modified:**
- `package.json` - Added packageManager field for Bun
- `turbo.json` - Turborepo configuration with build/dev/test/lint/typecheck/clean tasks
- `tsconfig.json` - Base TypeScript config with strict mode, ES2022 target
- `.gitignore` - Added Turbo and Bun entries
- `.env.example` - All environment variables from SPEC.md

**Notes:**
- Bun monorepo configured with workspaces: ["packages/*"]
- Turbo build works (0 packages currently)
- All Phase 1 tasks completed in single iteration

---

## Session 2 - 2025-01-12

### Task: Phase 2 - Shared Package

**Commit:** 6ec667d

**Files Created:**
- `packages/shared/package.json` - Package config with name @factory/shared
- `packages/shared/tsconfig.json` - Extends root config
- `packages/shared/src/types.ts` - All shared types (WorkItem, Worker, Learning, Metrics, API types)
- `packages/shared/src/index.ts` - Re-exports all types
- `bun.lock` - Lockfile from bun install

**Types Defined:**
- WorkItem, WorkItemStatus, Priority
- Worker, WorkerStatus
- Learning
- WorkerMetrics, FactoryMetrics
- API request/response types (AddWorkItemRequest, WorkerRegisterRequest, etc.)

**Notes:**
- All types are exported as interfaces/types only (no runtime code)
- Build produces proper .d.ts declaration files
- All Phase 2 tasks completed in single iteration

---

## Session 3 - 2025-01-12

### Task: Phase 3 - Database Schema

**Commit:** 7b332c2

**Files Created:**
- `migrations/001_initial.sql` - Initial PostgreSQL schema with all tables

**Tables Created:**
1. `work_items` - Stores work items (specs) with status, priority, metadata
2. `workers` - Tracks worker lifecycle and heartbeats
3. `learnings` - Persisted learnings with pgvector embeddings
4. `worker_metrics` - Per-iteration metrics (tokens, duration, tests)
5. `file_locks` - Prevents concurrent edits to same files

**Enums Created:**
- `work_item_status` (queued, assigned, in_progress, completed, failed, cancelled)
- `priority` (low, medium, high, critical)
- `worker_status` (starting, running, completed, failed, stuck, killed)

**Features:**
- pgvector extension for semantic similarity search
- HNSW index on learnings.embedding for fast vector search
- Partial indexes for queue ordering and active worker lookup
- Auto-updating `updated_at` trigger on work_items
- Proper foreign key relationships

**Notes:**
- Using 1536-dimension vectors (OpenAI ada-002 compatible)
- All column names use snake_case (PostgreSQL convention)
- All Phase 3 tasks completed in single iteration

---

## Session 4 - 2025-01-12

### Task: Phase 4.1 - Orchestrator Package Setup

**Files Created:**
- `packages/orchestrator/package.json` - Package config with name @factory/orchestrator
- `packages/orchestrator/tsconfig.json` - Extends root config with reference to shared
- `packages/orchestrator/src/index.ts` - Placeholder entry point

**Dependencies Added:**
- express ^4.21.0 - HTTP server
- pg ^8.13.0 - PostgreSQL client
- ioredis ^5.4.0 - Redis client
- dockerode ^4.0.0 - Docker SDK
- uuid ^11.0.0 - UUID generation
- Type definitions for all the above

**Notes:**
- tsconfig.json includes reference to @factory/shared package
- Build verifies successfully with `bun run build`
- Turborepo recognizes and caches both packages
- All Phase 4.1 tasks completed in single iteration
