-- Add repo scope to file locks for multi-repo support
-- Previously, file_path was globally unique which meant src/app.ts in repo1
-- would block src/app.ts in repo2. Now locks are scoped per-repo.

-- Add repo column
ALTER TABLE file_locks ADD COLUMN repo TEXT;

-- Backfill repo from the worker's work item
UPDATE file_locks
SET repo = (
  SELECT wi.repo FROM work_items wi
  JOIN workers w ON w.work_item_id = wi.id
  WHERE w.id = file_locks.worker_id
);

-- Make repo required (should be empty after backfill anyway)
ALTER TABLE file_locks ALTER COLUMN repo SET NOT NULL;

-- Drop old global uniqueness constraint
ALTER TABLE file_locks DROP CONSTRAINT IF EXISTS file_locks_file_path_key;

-- Create new repo-scoped uniqueness constraint
CREATE UNIQUE INDEX idx_file_locks_repo_path ON file_locks (repo, file_path);

-- Drop old file_path-only index (replaced by repo_path)
DROP INDEX IF EXISTS idx_file_locks_file_path;
