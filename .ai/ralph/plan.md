# Phase 3: Database Schema

## Goal
Create the initial PostgreSQL migration with all required tables for the AI Software Factory.

## Files to Create
- `migrations/001_initial.sql`

## Implementation Details

### Tables to Create

1. **work_items** - Stores work items (specs to be implemented)
   - Columns from `WorkItem` type
   - Status enum constraint
   - Priority enum constraint
   - Indexes on status, repo, priority

2. **workers** - Tracks active and historical workers
   - Columns from `Worker` type
   - Status enum constraint
   - Indexes on status, work_item_id

3. **learnings** - Persisted learnings with vector embeddings
   - Columns from `Learning` type
   - pgvector column for semantic search
   - Index on repo, work_item_id, and vector similarity

4. **worker_metrics** - Per-iteration metrics for workers
   - Columns from `WorkerMetrics` type
   - Indexes on worker_id, work_item_id, timestamp

5. **file_locks** - Prevents concurrent edits to same files
   - worker_id, file_path, acquired_at
   - Unique constraint on file_path
   - Index on worker_id for cleanup

### Extensions
- Enable pgvector extension for vector similarity search

## Tests
- Schema will be validated by PostgreSQL when applied
- No unit tests needed for SQL migrations

## Exit Criteria
- [ ] migrations/ directory exists
- [ ] migrations/001_initial.sql contains all tables
- [ ] All table columns match types in @factory/shared
- [ ] pgvector extension enabled
- [ ] Appropriate indexes created
