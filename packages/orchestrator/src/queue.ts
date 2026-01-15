/**
 * Queue Manager
 * Handles work item queue operations with priority-based ordering
 */

import { v4 as uuid } from "uuid";
import type { Database } from "./db.js";
import type {
  WorkItem,
  WorkItemStatus,
  Priority,
  AddWorkItemRequest,
  QueueStatsResponse,
} from "@whim/shared";

/**
 * Priority order for SQL sorting (higher number = higher priority)
 */
const PRIORITY_ORDER: Record<Priority, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Queue Manager for work items
 * Handles adding, retrieving, and managing work items in the queue
 */
export class QueueManager {
  constructor(private db: Database) {}

  /**
   * Add a new work item to the queue
   */
  async add(input: AddWorkItemRequest): Promise<WorkItem> {
    const id = uuid();
    const branch = input.branch ?? `whim/${id.slice(0, 8)}`;
    const priority = input.priority ?? "medium";
    const maxIterations = input.maxIterations ?? 50;
    const metadata = input.metadata ?? {};

    const result = await this.db.queryOne<WorkItem>(
      `INSERT INTO work_items (id, repo, branch, spec, priority, max_iterations, metadata)
       VALUES ($1, $2, $3, $4, $5::priority, $6, $7::jsonb)
       RETURNING *`,
      [
        id,
        input.repo,
        branch,
        input.spec,
        priority,
        maxIterations,
        JSON.stringify(metadata),
      ]
    );

    if (!result) {
      throw new Error("Failed to insert work item");
    }

    return result;
  }

  /**
   * Get a work item by ID
   */
  async get(id: string): Promise<WorkItem | null> {
    return this.db.getWorkItem(id);
  }

  /**
   * Get the next highest priority queued work item
   * Uses FOR UPDATE SKIP LOCKED for safe concurrent access
   * Returns null if no items are queued
   */
  async getNext(): Promise<WorkItem | null> {
    // Use a transaction to atomically select and update
    return this.db.transaction(async (client) => {
      // Select the highest priority queued item and lock it
      // Priority enum values are ordered naturally by PostgreSQL (critical > high > medium > low)
      // But we use CASE to be explicit about ordering
      // Also respect retry backoff: skip items whose next_retry_at is in the future
      const selectResult = await client.query(
        `SELECT * FROM work_items
         WHERE status = 'queued'
           AND (next_retry_at IS NULL OR next_retry_at <= NOW())
         ORDER BY
           CASE priority
             WHEN 'critical' THEN 4
             WHEN 'high' THEN 3
             WHEN 'medium' THEN 2
             WHEN 'low' THEN 1
           END DESC,
           created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        []
      );

      if (selectResult.rows.length === 0) {
        return null;
      }

      const row = selectResult.rows[0];

      // Update status to assigned
      await client.query(
        `UPDATE work_items SET status = 'assigned' WHERE id = $1`,
        [row.id]
      );

      // Return the work item with updated status
      return this.rowToWorkItem({ ...row, status: "assigned" });
    });
  }

  /**
   * Cancel a work item
   * Only cancels if status is 'queued' or 'assigned'
   * Returns true if cancelled, false if not cancellable
   */
  async cancel(id: string): Promise<boolean> {
    const result = await this.db.execute(
      `UPDATE work_items
       SET status = 'cancelled'
       WHERE id = $1 AND status IN ('queued', 'assigned')`,
      [id]
    );

    return result.rowCount > 0;
  }

  /**
   * List active work items (queued, assigned, or in_progress)
   */
  async list(): Promise<WorkItem[]> {
    return this.db.query<WorkItem>(
      `SELECT * FROM work_items
       WHERE status IN ('queued', 'assigned', 'in_progress')
       ORDER BY
         CASE priority
           WHEN 'critical' THEN 4
           WHEN 'high' THEN 3
           WHEN 'medium' THEN 2
           WHEN 'low' THEN 1
         END DESC,
         created_at ASC`
    );
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<QueueStatsResponse> {
    // Get total count
    const totalResult = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM work_items`
    );
    const total = parseInt(totalResult?.count ?? "0", 10);

    // Get count by status
    const statusRows = await this.db.query<{
      status: WorkItemStatus;
      count: string;
    }>(`SELECT status, COUNT(*) as count FROM work_items GROUP BY status`);

    const byStatus: Record<WorkItemStatus, number> = {
      generating: 0,
      queued: 0,
      assigned: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const row of statusRows) {
      byStatus[row.status] = parseInt(row.count, 10);
    }

    // Get count by priority
    const priorityRows = await this.db.query<{
      priority: Priority;
      count: string;
    }>(`SELECT priority, COUNT(*) as count FROM work_items GROUP BY priority`);

    const byPriority: Record<Priority, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    for (const row of priorityRows) {
      byPriority[row.priority] = parseInt(row.count, 10);
    }

    return { total, byStatus, byPriority };
  }

  /**
   * Convert a database row to WorkItem
   * Used internally for transaction results where we can't use db.getWorkItem
   */
  private rowToWorkItem(row: Record<string, unknown>): WorkItem {
    return {
      id: row.id as string,
      repo: row.repo as string,
      branch: (row.branch as string) ?? null,
      spec: (row.spec as string) ?? null,
      description: (row.description as string) ?? null,
      type: (row.type as "execution" | "verification") ?? "execution",
      priority: row.priority as Priority,
      status: row.status as WorkItemStatus,
      workerId: (row.worker_id as string) ?? null,
      iteration: row.iteration as number,
      maxIterations: row.max_iterations as number,
      retryCount: (row.retry_count as number) ?? 0,
      nextRetryAt: (row.next_retry_at as Date) ?? null,
      prNumber: (row.pr_number as number) ?? null,
      parentWorkItemId: (row.parent_work_item_id as string) ?? null,
      verificationPassed: (row.verification_passed as boolean) ?? null,
      source: (row.source as string) ?? null,
      sourceRef: (row.source_ref as string) ?? null,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
      completedAt: (row.completed_at as Date) ?? null,
      error: (row.error as string) ?? null,
      prUrl: (row.pr_url as string) ?? null,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    };
  }
}
