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
   */
  private rowToWorkItem(row: WorkItemRow): WorkItem {
    return {
      id: row.id,
      repo: row.repo,
      branch: row.branch,
      spec: row.spec,
      priority: row.priority,
      status: row.status,
      workerId: row.worker_id,
      iteration: row.iteration,
      maxIterations: row.max_iterations,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      error: row.error,
      prUrl: row.pr_url,
      metadata: row.metadata,
    };
  }

  /**
   * Convert a WorkerRow to Worker
   */
  private rowToWorker(row: WorkerRow): Worker {
    return {
      id: row.id,
      workItemId: row.work_item_id,
      status: row.status,
      iteration: row.iteration,
      lastHeartbeat: row.last_heartbeat,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      containerId: row.container_id,
      error: row.error,
    };
  }

  /**
   * Convert a LearningRow to Learning
   */
  private rowToLearning(row: LearningRow): Learning {
    return {
      id: row.id,
      repo: row.repo,
      spec: row.spec,
      content: row.content,
      embedding: row.embedding ? JSON.parse(row.embedding) : null,
      createdAt: row.created_at,
      workItemId: row.work_item_id,
    };
  }

  /**
   * Convert a WorkerMetricsRow to WorkerMetrics
   */
  private rowToWorkerMetrics(row: WorkerMetricsRow): WorkerMetrics {
    return {
      id: row.id,
      workerId: row.worker_id,
      workItemId: row.work_item_id,
      iteration: row.iteration,
      tokensIn: row.tokens_in,
      tokensOut: row.tokens_out,
      duration: row.duration,
      filesModified: row.files_modified,
      testsRun: row.tests_run,
      testsPassed: row.tests_passed,
      testsFailed: row.tests_failed ?? 0,
      testStatus: row.test_status as WorkerMetrics["testStatus"],
      timestamp: row.timestamp,
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

export type { WorkItemRow, WorkerRow, LearningRow, WorkerMetricsRow, FileLockRow };
