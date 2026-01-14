/**
 * PostgreSQL database client wrapper
 * Provides typed query methods and connection management
 */

import pg from "pg";
import type {
  WorkItem,
  WorkItemStatus,
  Priority,
  Worker,
  WorkerStatus,
  Learning,
  WorkerMetrics,
  PRReview,
  ReviewFindings,
} from "@factory/shared";

const { Pool } = pg;

export interface DatabaseConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

/**
 * Convert snake_case database column names to camelCase
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert a database row with snake_case keys to camelCase
 */
function rowToCamelCase<T>(row: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    result[snakeToCamel(key)] = value;
  }
  return result as T;
}

/**
 * Convert camelCase to snake_case for database columns
 */
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Database row types from PostgreSQL
 */
interface WorkItemRow {
  id: string;
  repo: string;
  branch: string;
  spec: string;
  priority: Priority;
  status: WorkItemStatus;
  worker_id: string | null;
  iteration: number;
  max_iterations: number;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  error: string | null;
  pr_url: string | null;
  metadata: Record<string, unknown>;
}

interface WorkerRow {
  id: string;
  work_item_id: string;
  status: WorkerStatus;
  iteration: number;
  last_heartbeat: Date;
  started_at: Date;
  completed_at: Date | null;
  container_id: string | null;
  error: string | null;
}

interface LearningRow {
  id: string;
  repo: string;
  spec: string;
  content: string;
  embedding: string | null; // pgvector returns as string
  created_at: Date;
  work_item_id: string | null;
}

interface WorkerMetricsRow {
  id: string;
  worker_id: string;
  work_item_id: string;
  iteration: number;
  tokens_in: number;
  tokens_out: number;
  duration: number;
  files_modified: number;
  tests_run: number;
  tests_passed: number;
  tests_failed?: number;
  test_status?: string;
  timestamp: Date;
}

interface FileLockRow {
  id: string;
  worker_id: string;
  file_path: string;
  acquired_at: Date;
}

interface PRReviewRow {
  id: string;
  work_item_id: string;
  pr_number: number;
  review_timestamp: Date;
  model_used: string;
  findings: ReviewFindings; // JSONB is parsed as object
  created_at: Date;
  updated_at: Date;
}

/**
 * Database client wrapper with typed query methods
 */
export class Database {
  private pool: pg.Pool;
  private connected = false;

  constructor(config: DatabaseConfig) {
    this.pool = new Pool(config);
  }

  /**
   * Connect to the database and verify connectivity
   */
  async connect(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT 1");
      this.connected = true;
    } finally {
      client.release();
    }
  }

  /**
   * Disconnect from the database
   */
  async disconnect(): Promise<void> {
    await this.pool.end();
    this.connected = false;
  }

  /**
   * Check if connected to the database
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Execute a query and return all rows
   */
  async query<T>(text: string, values?: unknown[]): Promise<T[]> {
    const result = await this.pool.query(text, values);
    return result.rows.map((row) => rowToCamelCase<T>(row));
  }

  /**
   * Execute a query and return the first row or null
   */
  async queryOne<T>(text: string, values?: unknown[]): Promise<T | null> {
    const result = await this.pool.query(text, values);
    if (result.rows.length === 0) {
      return null;
    }
    return rowToCamelCase<T>(result.rows[0]);
  }

  /**
   * Execute a query and return the first row, throwing if not found
   */
  async queryOneOrFail<T>(text: string, values?: unknown[]): Promise<T> {
    const result = await this.queryOne<T>(text, values);
    if (result === null) {
      throw new Error("Expected one row but found none");
    }
    return result;
  }

  /**
   * Execute a command that doesn't return rows (INSERT, UPDATE, DELETE)
   */
  async execute(
    text: string,
    values?: unknown[]
  ): Promise<{ rowCount: number }> {
    const result = await this.pool.query(text, values);
    return { rowCount: result.rowCount ?? 0 };
  }

  /**
   * Run a function within a transaction
   */
  async transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // ============================================
  // Work Item Operations
  // ============================================

  /**
   * Convert a WorkItemRow to WorkItem
   * Note: Row is already converted to camelCase by queryOne
   */
  private rowToWorkItem(row: WorkItemRow): WorkItem {
    // Row is already in camelCase from queryOne, just cast it
    return row as unknown as WorkItem;
  }

  /**
   * Convert a WorkerRow to Worker
   * Note: Row is already converted to camelCase by queryOne
   */
  private rowToWorker(row: WorkerRow): Worker {
    // Row is already in camelCase from queryOne, just cast it
    return row as unknown as Worker;
  }

  /**
   * Convert a LearningRow to Learning
   * Note: Row is already converted to camelCase by queryOne
   */
  private rowToLearning(row: LearningRow): Learning {
    const camelRow = row as unknown as Record<string, unknown>;
    return {
      ...(camelRow as unknown as Learning),
      embedding: camelRow.embedding ? JSON.parse(camelRow.embedding as string) : null,
    };
  }

  /**
   * Convert a WorkerMetricsRow to WorkerMetrics
   * Note: Row is already converted to camelCase by queryOne
   */
  private rowToWorkerMetrics(row: WorkerMetricsRow): WorkerMetrics {
    const camelRow = row as unknown as Record<string, unknown>;
    return {
      ...(camelRow as unknown as WorkerMetrics),
      testsFailed: (camelRow.testsFailed as number) ?? 0,
    };
  }

  // ============================================
  // Typed Query Methods for Entity Tables
  // ============================================

  async getWorkItem(id: string): Promise<WorkItem | null> {
    const row = await this.queryOne<WorkItemRow>(
      "SELECT * FROM work_items WHERE id = $1",
      [id]
    );
    return row ? this.rowToWorkItem(row as unknown as WorkItemRow) : null;
  }

  async getWorker(id: string): Promise<Worker | null> {
    const row = await this.queryOne<WorkerRow>(
      "SELECT * FROM workers WHERE id = $1",
      [id]
    );
    return row ? this.rowToWorker(row as unknown as WorkerRow) : null;
  }

  async getLearning(id: string): Promise<Learning | null> {
    const row = await this.queryOne<LearningRow>(
      "SELECT * FROM learnings WHERE id = $1",
      [id]
    );
    return row ? this.rowToLearning(row as unknown as LearningRow) : null;
  }

  async getWorkerMetrics(id: string): Promise<WorkerMetrics | null> {
    const row = await this.queryOne<WorkerMetricsRow>(
      "SELECT * FROM worker_metrics WHERE id = $1",
      [id]
    );
    return row
      ? this.rowToWorkerMetrics(row as unknown as WorkerMetricsRow)
      : null;
  }

  /**
   * Insert a new PR review record
   */
  async insertPRReview(
    workItemId: string,
    prNumber: number,
    modelUsed: string,
    findings: ReviewFindings
  ): Promise<PRReview> {
    const row = await this.queryOne<PRReviewRow>(
      `INSERT INTO pr_reviews (work_item_id, pr_number, model_used, findings)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [workItemId, prNumber, modelUsed, JSON.stringify(findings)]
    );
    if (!row) {
      throw new Error("Failed to insert PR review");
    }
    return this.rowToPRReview(row as unknown as PRReviewRow);
  }

  /**
   * Get all reviews for a work item
   */
  async getReviewsByWorkItem(workItemId: string): Promise<PRReview[]> {
    const rows = await this.query<PRReviewRow>(
      "SELECT * FROM pr_reviews WHERE work_item_id = $1 ORDER BY review_timestamp DESC",
      [workItemId]
    );
    return rows.map((row) => this.rowToPRReview(row as unknown as PRReviewRow));
  }

  /**
   * Get review by PR number
   */
  async getReviewByPR(prNumber: number): Promise<PRReview | null> {
    const row = await this.queryOne<PRReviewRow>(
      "SELECT * FROM pr_reviews WHERE pr_number = $1 ORDER BY review_timestamp DESC LIMIT 1",
      [prNumber]
    );
    return row ? this.rowToPRReview(row as unknown as PRReviewRow) : null;
  }

  /**
   * Convert a PRReviewRow to PRReview
   */
  private rowToPRReview(row: PRReviewRow): PRReview {
    const camelRow = row as unknown as Record<string, unknown>;
    return {
      id: String(camelRow.id),
      workItemId: String(camelRow.workItemId),
      prNumber: Number(camelRow.prNumber),
      reviewTimestamp: new Date(camelRow.reviewTimestamp as string | Date),
      modelUsed: String(camelRow.modelUsed),
      findings: camelRow.findings as ReviewFindings,
      createdAt: new Date(camelRow.createdAt as string | Date),
      updatedAt: new Date(camelRow.updatedAt as string | Date),
    };
  }
}

/**
 * Create a Database instance from environment variables
 */
export function createDatabase(): Database {
  const connectionString =
    process.env.DATABASE_URL ||
    "postgres://factory:factory@localhost:5432/factory";

  return new Database({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

export type { WorkItemRow, WorkerRow, LearningRow, WorkerMetricsRow, FileLockRow, PRReviewRow };
