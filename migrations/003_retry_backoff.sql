-- Migration: Add retry backoff support for work items
-- Prevents poison pill items from consuming daily budget in a loop

-- Add retry tracking columns
ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

-- Index for efficient queue queries that respect next_retry_at
CREATE INDEX IF NOT EXISTS idx_work_items_next_retry
  ON work_items (next_retry_at)
  WHERE status = 'queued' AND next_retry_at IS NOT NULL;

-- Comments for documentation
COMMENT ON COLUMN work_items.retry_count IS 'Number of times this work item has been retried after failure';
COMMENT ON COLUMN work_items.next_retry_at IS 'Earliest time this item can be retried (for exponential backoff)';
