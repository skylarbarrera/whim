/**
 * MetricsCollector - Collects and aggregates whim metrics
 *
 * Provides methods to get whim summary metrics, worker metrics,
 * and learnings with optional filtering.
 */

import type { Database } from "./db.js";
import type { WhimMetrics, WorkerMetrics, Learning } from "@whim/shared";

/**
 * Options for filtering learnings
 */
export interface LearningsFilterOptions {
  /** Filter by repository */
  repo?: string;
  /** Filter by spec (partial match) */
  spec?: string;
  /** Maximum number of learnings to return */
  limit?: number;
}

/**
 * MetricsCollector aggregates metrics from workers and learnings
 */
export class MetricsCollector {
  constructor(
    private db: Database,
    private dailyBudget: number = parseInt(process.env.DAILY_BUDGET ?? "200", 10)
  ) {}

  /**
   * Get whim metrics summary
   *
   * Aggregates current state of whim including active workers,
   * queued items, daily statistics, and success rate.
   *
   * @returns Whim metrics summary
   */
  async getSummary(): Promise<WhimMetrics> {
    // Get active workers count
    const activeResult = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM workers WHERE status IN ('starting', 'running')`
    );
    const activeWorkers = parseInt(activeResult?.count ?? "0", 10);

    // Get queued items count
    const queuedResult = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM work_items WHERE status = 'queued'`
    );
    const queuedItems = parseInt(queuedResult?.count ?? "0", 10);

    // Get completed today count
    const completedResult = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM work_items
       WHERE status = 'completed'
       AND completed_at >= CURRENT_DATE`
    );
    const completedToday = parseInt(completedResult?.count ?? "0", 10);

    // Get failed today count
    const failedResult = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM work_items
       WHERE status = 'failed'
       AND updated_at >= CURRENT_DATE`
    );
    const failedToday = parseInt(failedResult?.count ?? "0", 10);

    // Get iterations today (sum of all worker iterations that ran today)
    const iterationsResult = await this.db.queryOne<{ sum: string | null }>(
      `SELECT COALESCE(SUM(iteration), 0) as sum FROM worker_metrics
       WHERE timestamp >= CURRENT_DATE`
    );
    const iterationsToday = parseInt(iterationsResult?.sum ?? "0", 10);

    // Get average completion time from metrics (in ms)
    const avgTimeResult = await this.db.queryOne<{ avg: string | null }>(
      `SELECT AVG(duration) as avg FROM worker_metrics`
    );
    const avgCompletionTime = avgTimeResult?.avg
      ? parseFloat(avgTimeResult.avg)
      : 0;

    // Calculate success rate (completed / (completed + failed)) for all time
    const totalCompletedResult = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM work_items WHERE status = 'completed'`
    );
    const totalCompleted = parseInt(totalCompletedResult?.count ?? "0", 10);

    const totalFailedResult = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM work_items WHERE status = 'failed'`
    );
    const totalFailed = parseInt(totalFailedResult?.count ?? "0", 10);

    const successRate =
      totalCompleted + totalFailed > 0
        ? totalCompleted / (totalCompleted + totalFailed)
        : 0;

    // Get verification-specific metrics
    const verificationStats = await this.getVerificationStats();

    return {
      activeWorkers,
      queuedItems,
      completedToday,
      failedToday,
      iterationsToday,
      dailyBudget: this.dailyBudget,
      avgCompletionTime,
      successRate,
      verification: verificationStats,
    };
  }

  /**
   * Get verification-specific statistics
   */
  private async getVerificationStats(): Promise<{
    total: number;
    passed: number;
    failed: number;
    pending: number;
    passRate: number;
  }> {
    // Total verification items
    const totalResult = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM work_items WHERE type = 'verification'`
    );
    const total = parseInt(totalResult?.count ?? "0", 10);

    // Passed verifications
    const passedResult = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM work_items
       WHERE type = 'verification' AND verification_passed = true`
    );
    const passed = parseInt(passedResult?.count ?? "0", 10);

    // Failed verifications
    const failedResult = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM work_items
       WHERE type = 'verification' AND verification_passed = false`
    );
    const failed = parseInt(failedResult?.count ?? "0", 10);

    // Pending verifications (queued, assigned, in_progress)
    const pendingResult = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM work_items
       WHERE type = 'verification' AND status IN ('queued', 'assigned', 'in_progress')`
    );
    const pending = parseInt(pendingResult?.count ?? "0", 10);

    // Pass rate
    const completed = passed + failed;
    const passRate = completed > 0 ? passed / completed : 0;

    return { total, passed, failed, pending, passRate };
  }

  /**
   * Get all worker metrics
   *
   * Returns all worker metrics ordered by timestamp descending.
   *
   * @returns Array of worker metrics
   */
  async getAll(): Promise<WorkerMetrics[]> {
    return this.db.query<WorkerMetrics>(
      `SELECT
        id,
        worker_id as "workerId",
        work_item_id as "workItemId",
        iteration,
        tokens_in as "tokensIn",
        tokens_out as "tokensOut",
        duration,
        files_modified as "filesModified",
        tests_run as "testsRun",
        tests_passed as "testsPassed",
        timestamp
       FROM worker_metrics
       ORDER BY timestamp DESC`
    );
  }

  /**
   * Get learnings with optional filters
   *
   * Returns learnings matching the provided filters. Supports filtering
   * by repository, spec content (partial match), and limiting results.
   *
   * @param options - Filter options
   * @returns Array of learnings matching filters
   */
  async getLearnings(options?: LearningsFilterOptions): Promise<Learning[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (options?.repo) {
      conditions.push(`repo = $${paramIndex}`);
      values.push(options.repo);
      paramIndex++;
    }

    if (options?.spec) {
      conditions.push(`spec ILIKE $${paramIndex}`);
      values.push(`%${options.spec}%`);
      paramIndex++;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const limitClause = options?.limit ? `LIMIT ${options.limit}` : "";

    return this.db.query<Learning>(
      `SELECT
        id,
        repo,
        spec,
        content,
        embedding,
        created_at as "createdAt",
        work_item_id as "workItemId"
       FROM learnings
       ${whereClause}
       ORDER BY created_at DESC
       ${limitClause}`,
      values
    );
  }
}
