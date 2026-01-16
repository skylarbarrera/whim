/**
 * Queue Manager
 * Handles work item queue operations with priority-based ordering
 */

import { v4 as uuid } from "uuid";
import type { Database } from "./db.js";
import type {
  WorkItem,
  WorkItemStatus,
  WorkItemType,
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
    const priority = input.priority ?? "medium";
    const maxIterations = input.maxIterations ?? 50;
    const metadata = input.metadata ?? {};

    // Determine status based on whether spec or description is provided
    // If description: status='generating', spec=NULL, branch=NULL (will be set later)
    // If spec: status='queued', branch=default or provided
    const hasDescription = !!input.description;
    const status: WorkItemStatus = hasDescription ? "generating" : "queued";
    const branch = hasDescription ? null : (input.branch ?? `whim/${id.slice(0, 8)}`);
    const spec = hasDescription ? null : input.spec ?? null;
    const description = input.description ?? null;

    // Type is always 'execution' for API-created work items
    const type: WorkItemType = "execution";

    const result = await this.db.queryOne<WorkItem>(
      `INSERT INTO work_items (
        id, repo, branch, spec, description, type, priority, status,
        max_iterations, source, source_ref, metadata
      )
       VALUES ($1, $2, $3, $4, $5, $6::work_item_type, $7::priority, $8::work_item_status, $9, $10, $11, $12::jsonb)
       RETURNING *`,
      [
        id,
        input.repo,
        branch,
        spec,
        description,
        type,
        priority,
        status,
        maxIterations,
        input.source ?? null,
        input.sourceRef ?? null,
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
   *
   * @param type - Optional filter by work item type. When omitted, execution items have priority over verification items.
   */
  async getNext(type?: WorkItemType): Promise<WorkItem | null> {
    // Use a transaction to atomically select and update
    return this.db.transaction(async (client) => {
      // Select the highest priority queued item and lock it
      // Priority enum values are ordered naturally by PostgreSQL (critical > high > medium > low)
      // But we use CASE to be explicit about ordering
      // Also respect retry backoff: skip items whose next_retry_at is in the future
      // When no type filter: execution items have priority over verification items
      const typeCondition = type ? `AND type = $1::work_item_type` : '';
      const params = type ? [type] : [];

      const selectResult = await client.query(
        `SELECT * FROM work_items
         WHERE status = 'queued'
           AND (next_retry_at IS NULL OR next_retry_at <= NOW())
           ${typeCondition}
         ORDER BY
           ${type ? '' : "(type = 'execution') DESC,"}
           CASE priority
             WHEN 'critical' THEN 4
             WHEN 'high' THEN 3
             WHEN 'medium' THEN 2
             WHEN 'low' THEN 1
           END DESC,
           created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        params
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
   *
   * @param type - Optional filter by work item type
   */
  async list(type?: WorkItemType): Promise<WorkItem[]> {
    const typeCondition = type ? `AND type = $1::work_item_type` : '';
    const params = type ? [type] : [];

    return this.db.query<WorkItem>(
      `SELECT * FROM work_items
       WHERE status IN ('queued', 'assigned', 'in_progress')
         ${typeCondition}
       ORDER BY
         (type = 'execution') DESC,
         CASE priority
           WHEN 'critical' THEN 4
           WHEN 'high' THEN 3
           WHEN 'medium' THEN 2
           WHEN 'low' THEN 1
         END DESC,
         created_at ASC`,
      params
    );
  }

  /**
   * Add a verification work item linked to a parent execution item
   * Called when execution worker completes with verification enabled
   */
  async addVerificationWorkItem(
    parentWorkItem: WorkItem,
    prNumber: number
  ): Promise<WorkItem> {
    const id = uuid();

    const result = await this.db.queryOne<WorkItem>(
      `INSERT INTO work_items (
        id, repo, branch, spec, type, priority, status,
        max_iterations, pr_number, parent_work_item_id, metadata
      )
       VALUES ($1, $2, $3, $4, $5::work_item_type, $6::priority, $7::work_item_status, $8, $9, $10, $11::jsonb)
       RETURNING *`,
      [
        id,
        parentWorkItem.repo,
        parentWorkItem.branch,
        null, // verification items don't have specs
        "verification",
        parentWorkItem.priority, // inherit priority from parent
        "queued",
        parentWorkItem.maxIterations, // inherit max iterations
        prNumber,
        parentWorkItem.id, // link to parent
        JSON.stringify({}), // empty metadata for now
      ]
    );

    if (!result) {
      throw new Error("Failed to insert verification work item");
    }

    return result;
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
