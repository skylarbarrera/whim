-- PR Review System Migration

-- Create review_status enum
CREATE TYPE review_status AS ENUM (
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled'
);

-- Create check_status enum
CREATE TYPE check_status AS ENUM (
  'pending',
  'running',
  'success',
  'failure',
  'skipped',
  'error'
);

-- Create check_type enum
CREATE TYPE check_type AS ENUM (
  'lint',
  'test',
  'typecheck',
  'build',
  'security',
  'quality'
);

-- Create pr_reviews table
CREATE TABLE pr_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_owner VARCHAR(255) NOT NULL,
  repo_name VARCHAR(255) NOT NULL,
  pr_number INTEGER NOT NULL,
  status review_status NOT NULL DEFAULT 'pending',
  is_ai_generated BOOLEAN NOT NULL,
  detection_confidence DECIMAL(3,2) NOT NULL,
  detection_reasons TEXT[] NOT NULL DEFAULT '{}',
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  merge_blocked BOOLEAN DEFAULT false,
  override_user VARCHAR(255),
  override_reason TEXT,
  override_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_pr_review UNIQUE(repo_owner, repo_name, pr_number)
);

-- Create pr_review_checks table
CREATE TABLE pr_review_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES pr_reviews(id) ON DELETE CASCADE,
  check_name VARCHAR(100) NOT NULL,
  check_type check_type NOT NULL,
  status check_status NOT NULL DEFAULT 'pending',
  required BOOLEAN NOT NULL DEFAULT false,
  summary TEXT,
  details TEXT,
  error_count INTEGER DEFAULT 0,
  warning_count INTEGER DEFAULT 0,
  duration INTEGER, -- milliseconds
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_review_check UNIQUE(review_id, check_name)
);

-- Add foreign key to work_items table
ALTER TABLE work_items
ADD COLUMN pr_review_id UUID REFERENCES pr_reviews(id);

-- Create indexes for performance
CREATE INDEX idx_pr_reviews_status ON pr_reviews(status);
CREATE INDEX idx_pr_reviews_repo_pr ON pr_reviews(repo_owner, repo_name, pr_number);
CREATE INDEX idx_pr_reviews_merge_blocked ON pr_reviews(merge_blocked) WHERE merge_blocked = true;
CREATE INDEX idx_pr_reviews_created_at ON pr_reviews(created_at DESC);

CREATE INDEX idx_pr_review_checks_review ON pr_review_checks(review_id);
CREATE INDEX idx_pr_review_checks_status ON pr_review_checks(status);
CREATE INDEX idx_pr_review_checks_type ON pr_review_checks(check_type);
CREATE INDEX idx_pr_review_checks_required_status ON pr_review_checks(required, status) WHERE required = true;

-- Add trigger to auto-update updated_at on pr_reviews
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

-- Add comments for documentation
COMMENT ON TABLE pr_reviews IS 'Tracks PR review lifecycle for AI-generated pull requests';
COMMENT ON TABLE pr_review_checks IS 'Individual check results (lint, test, etc.) for each PR review';
COMMENT ON COLUMN pr_reviews.detection_confidence IS 'Confidence score 0-1 that this is AI-generated';
COMMENT ON COLUMN pr_reviews.merge_blocked IS 'Whether merge is blocked due to check failures';
COMMENT ON COLUMN pr_review_checks.required IS 'Whether this check must pass to allow merge';
COMMENT ON COLUMN pr_review_checks.metadata IS 'Check-specific metadata in JSON format';
