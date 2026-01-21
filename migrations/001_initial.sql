-- Whim - Initial Schema (v1)
-- Enables pgvector for semantic similarity search on learnings

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Work Item Type Enum
CREATE TYPE work_item_type AS ENUM (
  'execution',
  'verification'
);

-- Work Item Status Enum
CREATE TYPE work_item_status AS ENUM (
  'generating',
  'queued',
  'assigned',
  'in_progress',
  'completed',
  'failed',
  'cancelled'
);

-- Priority Enum
CREATE TYPE priority AS ENUM (
  'low',
  'medium',
  'high',
  'critical'
);

-- Worker Status Enum
CREATE TYPE worker_status AS ENUM (
  'starting',
  'running',
  'completed',
  'failed',
  'stuck',
  'killed'
);

-- Test Status Enum
CREATE TYPE test_status AS ENUM (
  'passed',
  'failed',
  'timeout',
  'skipped',
  'error'
);

-- Work Items Table
-- Stores specs and their processing state
CREATE TABLE work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo TEXT NOT NULL,
  branch TEXT, -- Nullable: generated async for description submissions
  spec TEXT, -- Nullable: NULL while generating, NULL for verification items
  description TEXT, -- Original description submitted (for async spec generation)
  type work_item_type NOT NULL DEFAULT 'execution',
  priority priority NOT NULL DEFAULT 'medium',
  status work_item_status NOT NULL DEFAULT 'queued',
  worker_id UUID,
  iteration INTEGER NOT NULL DEFAULT 0,
  max_iterations INTEGER NOT NULL DEFAULT 10,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ, -- For exponential backoff
  pr_url TEXT,
  pr_number INTEGER, -- Stored for verification items
  parent_work_item_id UUID REFERENCES work_items(id), -- Links verification to execution
  verification_passed BOOLEAN, -- Result of verification (on verification items)
  source TEXT, -- github, linear, api, slack, etc.
  source_ref TEXT, -- issue:42, LIN-123, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'
);

-- Work Items Indexes
CREATE INDEX idx_work_items_status ON work_items (status);
CREATE INDEX idx_work_items_repo ON work_items (repo);
CREATE INDEX idx_work_items_priority ON work_items (priority);
CREATE INDEX idx_work_items_type ON work_items (type);
CREATE INDEX idx_work_items_parent_work_item_id ON work_items (parent_work_item_id);
CREATE INDEX idx_work_items_source ON work_items (source);
CREATE INDEX idx_work_items_created_at ON work_items (created_at);
-- For queue ordering: queued items by priority (desc) then created_at (asc)
CREATE INDEX idx_work_items_queue ON work_items (priority DESC, created_at ASC)
  WHERE status = 'queued';
-- For retry backoff: queued items with retry scheduled
CREATE INDEX idx_work_items_next_retry ON work_items (next_retry_at)
  WHERE status = 'queued' AND next_retry_at IS NOT NULL;

-- Workers Table
-- Tracks active and historical workers
CREATE TABLE workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id UUID NOT NULL REFERENCES work_items(id),
  status worker_status NOT NULL DEFAULT 'starting',
  iteration INTEGER NOT NULL DEFAULT 0,
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  container_id TEXT,
  error TEXT
);

-- Workers Indexes
CREATE INDEX idx_workers_status ON workers (status);
CREATE INDEX idx_workers_work_item_id ON workers (work_item_id);
CREATE INDEX idx_workers_last_heartbeat ON workers (last_heartbeat);
-- For finding stale workers
CREATE INDEX idx_workers_active ON workers (last_heartbeat)
  WHERE status IN ('starting', 'running');

-- Learnings Table
-- Persisted learnings with vector embeddings for semantic search
CREATE TABLE learnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo TEXT NOT NULL,
  spec TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536), -- OpenAI ada-002 embedding dimension
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  work_item_id UUID REFERENCES work_items(id)
);

-- Learnings Indexes
CREATE INDEX idx_learnings_repo ON learnings (repo);
CREATE INDEX idx_learnings_work_item_id ON learnings (work_item_id);
CREATE INDEX idx_learnings_created_at ON learnings (created_at);
-- Vector similarity index (using HNSW for fast approximate search)
CREATE INDEX idx_learnings_embedding ON learnings
  USING hnsw (embedding vector_cosine_ops);

-- Worker Metrics Table
-- Per-iteration metrics for workers
CREATE TABLE worker_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers(id),
  work_item_id UUID NOT NULL REFERENCES work_items(id),
  iteration INTEGER NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 0, -- milliseconds
  files_modified INTEGER NOT NULL DEFAULT 0,
  tests_run INTEGER NOT NULL DEFAULT 0,
  tests_passed INTEGER NOT NULL DEFAULT 0,
  tests_failed INTEGER NOT NULL DEFAULT 0,
  test_status test_status,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Worker Metrics Indexes
CREATE INDEX idx_worker_metrics_worker_id ON worker_metrics (worker_id);
CREATE INDEX idx_worker_metrics_work_item_id ON worker_metrics (work_item_id);
CREATE INDEX idx_worker_metrics_timestamp ON worker_metrics (timestamp);

-- File Locks Table
-- Prevents concurrent edits to same files (scoped per-repo)
CREATE TABLE file_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers(id),
  repo TEXT NOT NULL,
  file_path TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (repo, file_path) -- Locks are scoped per-repo
);

-- File Locks Indexes
CREATE INDEX idx_file_locks_worker_id ON file_locks (worker_id);
CREATE UNIQUE INDEX idx_file_locks_repo_path ON file_locks (repo, file_path);

-- PR Reviews Table
-- Stores AI code review results for pull requests
CREATE TABLE pr_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  pr_number INTEGER NOT NULL,
  review_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  model_used VARCHAR(100) NOT NULL,
  findings JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- PR Reviews Indexes
CREATE INDEX idx_pr_reviews_work_item ON pr_reviews(work_item_id);
CREATE INDEX idx_pr_reviews_pr_number ON pr_reviews(pr_number);
CREATE INDEX idx_pr_reviews_timestamp ON pr_reviews(review_timestamp DESC);

-- Trigger Functions

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at trigger to work_items
CREATE TRIGGER update_work_items_updated_at
  BEFORE UPDATE ON work_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Apply updated_at trigger to pr_reviews
CREATE TRIGGER update_pr_reviews_updated_at
  BEFORE UPDATE ON pr_reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Table and Column Comments
COMMENT ON TABLE work_items IS 'Work items (execution or verification) with specs and processing state';
COMMENT ON COLUMN work_items.type IS 'execution (normal work) or verification (test existing PR)';
COMMENT ON COLUMN work_items.description IS 'Original description for async spec generation';
COMMENT ON COLUMN work_items.spec IS 'Generated or provided spec (NULL while generating or for verification items)';
COMMENT ON COLUMN work_items.branch IS 'Branch name (generated async for description submissions)';
COMMENT ON COLUMN work_items.parent_work_item_id IS 'Links verification items to their parent execution item';
COMMENT ON COLUMN work_items.verification_passed IS 'Verification result (set on verification items)';
COMMENT ON COLUMN work_items.source IS 'Source system: github, linear, api, slack, etc.';
COMMENT ON COLUMN work_items.source_ref IS 'Source reference: issue:42, LIN-123, etc.';
COMMENT ON COLUMN work_items.retry_count IS 'Number of times this work item has been retried after failure';
COMMENT ON COLUMN work_items.next_retry_at IS 'Earliest time this item can be retried (exponential backoff)';

COMMENT ON TABLE pr_reviews IS 'AI code review results for pull requests';
COMMENT ON COLUMN pr_reviews.work_item_id IS 'Foreign key to work_items table';
COMMENT ON COLUMN pr_reviews.pr_number IS 'GitHub pull request number';
COMMENT ON COLUMN pr_reviews.review_timestamp IS 'When the review was performed';
COMMENT ON COLUMN pr_reviews.model_used IS 'Claude model used for review';
COMMENT ON COLUMN pr_reviews.findings IS 'JSON object containing review findings';

COMMENT ON TABLE file_locks IS 'File locks scoped per repository to prevent concurrent edits';
COMMENT ON COLUMN file_locks.repo IS 'Repository scope for the lock';
