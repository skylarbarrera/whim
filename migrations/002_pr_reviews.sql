-- Migration: Add pr_reviews table for tracking AI code reviews
-- Created: 2026-01-14

CREATE TABLE IF NOT EXISTS pr_reviews (
  id SERIAL PRIMARY KEY,
  work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  pr_number INTEGER NOT NULL,
  review_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  model_used VARCHAR(100) NOT NULL,
  findings JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index for fast lookup by work item
CREATE INDEX idx_pr_reviews_work_item ON pr_reviews(work_item_id);

-- Index for fast lookup by PR number
CREATE INDEX idx_pr_reviews_pr_number ON pr_reviews(pr_number);

-- Index for timestamp-based queries
CREATE INDEX idx_pr_reviews_timestamp ON pr_reviews(review_timestamp DESC);

-- Trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_pr_reviews_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pr_reviews_updated_at
  BEFORE UPDATE ON pr_reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_pr_reviews_updated_at();

-- Comments for documentation
COMMENT ON TABLE pr_reviews IS 'Stores AI code review results for pull requests';
COMMENT ON COLUMN pr_reviews.work_item_id IS 'Foreign key to work_items table';
COMMENT ON COLUMN pr_reviews.pr_number IS 'GitHub pull request number';
COMMENT ON COLUMN pr_reviews.review_timestamp IS 'When the review was performed';
COMMENT ON COLUMN pr_reviews.model_used IS 'Claude model used for review (e.g., claude-sonnet-4-20250514)';
COMMENT ON COLUMN pr_reviews.findings IS 'JSON object containing review findings (specAlignment, codeQuality, overallSummary)';
