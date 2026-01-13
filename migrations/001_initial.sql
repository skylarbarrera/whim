-- AI Software Factory - Initial Schema
-- Enables pgvector for semantic similarity search on learnings

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Work Item Status Enum
CREATE TYPE work_item_status AS ENUM (
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

-- Work Items Table
-- Stores specs and their processing state
CREATE TABLE work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  spec TEXT NOT NULL,
  priority priority NOT NULL DEFAULT 'medium',
  status work_item_status NOT NULL DEFAULT 'queued',
  worker_id UUID,
  iteration INTEGER NOT NULL DEFAULT 0,
  max_iterations INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error TEXT,
  pr_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'
);

-- Work Items Indexes
CREATE INDEX idx_work_items_status ON work_items (status);
CREATE INDEX idx_work_items_repo ON work_items (repo);
CREATE INDEX idx_work_items_priority ON work_items (priority);
CREATE INDEX idx_work_items_created_at ON work_items (created_at);
-- For queue ordering: queued items by priority (desc) then created_at (asc)
CREATE INDEX idx_work_items_queue ON work_items (priority DESC, created_at ASC)
  WHERE status = 'queued';

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
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Worker Metrics Indexes
CREATE INDEX idx_worker_metrics_worker_id ON worker_metrics (worker_id);
CREATE INDEX idx_worker_metrics_work_item_id ON worker_metrics (work_item_id);
CREATE INDEX idx_worker_metrics_timestamp ON worker_metrics (timestamp);

-- File Locks Table
-- Prevents concurrent edits to same files
CREATE TABLE file_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers(id),
  file_path TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (file_path) -- Only one worker can hold a lock on a file
);

-- File Locks Indexes
CREATE INDEX idx_file_locks_worker_id ON file_locks (worker_id);
CREATE INDEX idx_file_locks_file_path ON file_locks (file_path);

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
