/**
 * WorkerManager - Manages worker lifecycle
 *
 * Handles spawning Docker containers, worker registration, heartbeats,
 * completion, failure, and health checks for factory workers.
 */

import { v4 as uuid } from "uuid";
import type Docker from "dockerode";
import type { Database } from "./db.js";
import type { RateLimiter } from "./rate-limits.js";
import type { ConflictDetector } from "./conflicts.js";
import type {
  Worker,
  WorkerStatus,
  WorkItem,
  WorkerStatsResponse,
  WorkerHeartbeatRequest,
  WorkerCompleteRequest,
} from "@factory/shared";

/**
 * Configuration for WorkerManager
 */
export interface WorkerManagerConfig {
  /** Docker image name for workers */
  workerImage: string;
  /** Orchestrator URL for workers to connect to */
  orchestratorUrl: string;
  /** Seconds without heartbeat before worker is considered stale */
  staleThresholdSeconds: number;
}

/**
 * Result of a spawn operation
 */
export interface SpawnResult {
  workerId: string;
  containerId: string;
}

/**
 * WorkerManager handles all worker lifecycle operations
 */
export class WorkerManager {
  private config: WorkerManagerConfig;

  constructor(
    private db: Database,
    private rateLimiter: RateLimiter,
    private conflictDetector: ConflictDetector,
    private docker: Docker,
    config?: Partial<WorkerManagerConfig>
  ) {
    this.config = {
      workerImage: config?.workerImage ?? process.env.WORKER_IMAGE ?? "factory-worker:latest",
      orchestratorUrl: config?.orchestratorUrl ?? process.env.ORCHESTRATOR_URL ?? "http://factory-orchestrator:3000",
      staleThresholdSeconds: config?.staleThresholdSeconds ?? parseInt(process.env.STALE_THRESHOLD ?? "300", 10),
    };
  }

  /**
   * Check if we have capacity to spawn a new worker
   * Delegates to the rate limiter
   */
  async hasCapacity(): Promise<boolean> {
    return this.rateLimiter.canSpawnWorker();
  }

  /**
   * Spawn a new worker container for a work item
   *
   * Creates the worker record first, then spawns the Docker container.
   * Records the spawn with the rate limiter.
   *
   * @param workItem - The work item to process
   * @returns The worker ID and container ID
   */
  async spawn(workItem: WorkItem): Promise<SpawnResult> {
    // Create worker record
    const workerId = uuid();

    await this.db.execute(
      `INSERT INTO workers (id, work_item_id, status, iteration)
       VALUES ($1, $2, 'starting', 0)`,
      [workerId, workItem.id]
    );

    // Update work item with worker assignment
    await this.db.execute(
      `UPDATE work_items SET worker_id = $1, status = 'in_progress' WHERE id = $2`,
      [workerId, workItem.id]
    );

    // Spawn Docker container
    // Convert localhost to Docker-accessible address for container networking
    // - Mac/Windows: host.docker.internal (Docker Desktop feature)
    // - Linux: Docker bridge gateway IP (172.17.0.1)
    const dockerHost = process.platform === "linux"
      ? "172.17.0.1"
      : "host.docker.internal";
    const workerOrchestratorUrl = this.config.orchestratorUrl.replace(
      /localhost|127\.0\.0\.1/,
      dockerHost
    );
    const container = await this.docker.createContainer({
      Image: this.config.workerImage,
      Env: [
        `WORKER_ID=${workerId}`,
        `WORK_ITEM=${JSON.stringify(workItem)}`,
        `ORCHESTRATOR_URL=${workerOrchestratorUrl}`,
        `GITHUB_TOKEN=${process.env.GITHUB_TOKEN ?? ""}`,
        `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ?? ""}`,
        // Pass through mock mode for testing lifecycle without Claude
        `MOCK_RALPH=${process.env.MOCK_RALPH ?? ""}`,
        `MOCK_FAIL=${process.env.MOCK_FAIL ?? ""}`,
        `MOCK_STUCK=${process.env.MOCK_STUCK ?? ""}`,
      ],
      HostConfig: {
        AutoRemove: false,  // Keep for debugging
        NetworkMode: "factory-network",
      },
    });

    await container.start();

    // Update worker with container ID
    const containerId = container.id;
    await this.db.execute(
      `UPDATE workers SET container_id = $1 WHERE id = $2`,
      [containerId, workerId]
    );

    // Record spawn with rate limiter
    await this.rateLimiter.recordSpawn();

    return { workerId, containerId };
  }

  /**
   * Register a worker that has started
   *
   * Called by workers to self-register after starting.
   * Creates the worker record if it doesn't exist.
   *
   * @param workItemId - The work item ID being processed
   * @returns The worker and work item
   */
  async register(workItemId: string): Promise<{ worker: Worker; workItem: WorkItem }> {
    // Check if worker already exists for this work item
    const existing = await this.db.queryOne<Worker>(
      `SELECT * FROM workers WHERE work_item_id = $1 AND status IN ('starting', 'running')`,
      [workItemId]
    );

    if (existing) {
      // Update status to running
      await this.db.execute(
        `UPDATE workers SET status = 'running', last_heartbeat = NOW() WHERE id = $1`,
        [existing.id]
      );

      const workItem = await this.db.getWorkItem(workItemId);
      if (!workItem) {
        throw new Error(`Work item not found: ${workItemId}`);
      }

      return {
        worker: { ...existing, status: "running" },
        workItem,
      };
    }

    // Create new worker record
    const workerId = uuid();
    await this.db.execute(
      `INSERT INTO workers (id, work_item_id, status, iteration)
       VALUES ($1, $2, 'running', 0)`,
      [workerId, workItemId]
    );

    // Update work item
    await this.db.execute(
      `UPDATE work_items SET worker_id = $1, status = 'in_progress' WHERE id = $2`,
      [workerId, workItemId]
    );

    const worker = await this.db.getWorker(workerId);
    const workItem = await this.db.getWorkItem(workItemId);

    if (!worker || !workItem) {
      throw new Error("Failed to create worker or work item not found");
    }

    return { worker, workItem };
  }

  /**
   * Update worker heartbeat
   *
   * Called periodically by workers to indicate they're still alive.
   * Updates the last_heartbeat timestamp and iteration count.
   *
   * @param workerId - The worker ID
   * @param data - Heartbeat data including iteration and optional metrics
   */
  async heartbeat(workerId: string, data: WorkerHeartbeatRequest): Promise<void> {
    // Get current iteration to check if it increased
    const worker = await this.db.getWorker(workerId);
    const previousIteration = worker?.iteration ?? 0;

    const result = await this.db.execute(
      `UPDATE workers
       SET last_heartbeat = NOW(), iteration = $2, status = 'running'
       WHERE id = $1 AND status IN ('starting', 'running')`,
      [workerId, data.iteration]
    );

    if (result.rowCount === 0) {
      throw new Error(`Worker not found or not active: ${workerId}`);
    }

    // Only record iteration when it actually increases (not on every heartbeat)
    if (data.iteration > previousIteration) {
      await this.rateLimiter.recordIteration();
    }
  }

  /**
   * Handle worker completion
   *
   * Called when a worker successfully completes its work item.
   * Updates worker and work item status, releases file locks,
   * and records metrics.
   *
   * @param workerId - The worker ID
   * @param data - Completion data including PR URL and metrics
   */
  async complete(workerId: string, data: WorkerCompleteRequest): Promise<void> {
    // Get worker
    const worker = await this.db.getWorker(workerId);
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }

    // Only allow completion from active workers
    if (worker.status !== "starting" && worker.status !== "running") {
      throw new Error(`Worker ${workerId} is not active (status: ${worker.status})`);
    }

    // Update worker status
    await this.db.execute(
      `UPDATE workers SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [workerId]
    );

    // Update work item
    await this.db.execute(
      `UPDATE work_items
       SET status = 'completed', completed_at = NOW(), pr_url = $2
       WHERE id = $1`,
      [worker.workItemId, data.prUrl ?? null]
    );

    // Record PR review if provided
    if (data.review && data.prNumber && worker.workItemId) {
      try {
        await this.db.insertPRReview(
          worker.workItemId,
          data.prNumber,
          data.review.modelUsed,
          data.review.findings
        );
      } catch (error) {
        // Log but don't fail if review tracking fails
        console.error(`Failed to save PR review for worker ${workerId}:`, error);
      }
    }

    // Release all file locks
    await this.conflictDetector.releaseAllLocks(workerId);

    // Record metrics if provided and we have a valid work item
    if (data.metrics && worker.workItemId) {
      await this.db.execute(
        `INSERT INTO worker_metrics
         (worker_id, work_item_id, iteration, tokens_in, tokens_out, duration, files_modified, tests_run, tests_passed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          workerId,
          worker.workItemId,
          worker.iteration,
          data.metrics.tokensIn,
          data.metrics.tokensOut,
          data.metrics.duration,
          data.metrics.filesModified,
          data.metrics.testsRun,
          data.metrics.testsPassed,
        ]
      );
    }

    // Record worker done with rate limiter
    await this.rateLimiter.recordWorkerDone();
  }

  /**
   * Handle worker failure
   *
   * Called when a worker fails to complete its work item.
   * Updates worker and work item status with error info,
   * and releases file locks.
   *
   * @param workerId - The worker ID
   * @param error - Error message
   * @param iteration - Current iteration when failure occurred
   */
  async fail(workerId: string, error: string, iteration: number): Promise<void> {
    // Get worker
    const worker = await this.db.getWorker(workerId);
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }

    // Only allow failure from active workers
    if (worker.status !== "starting" && worker.status !== "running") {
      throw new Error(`Worker ${workerId} is not active (status: ${worker.status})`);
    }

    // Update worker status
    await this.db.execute(
      `UPDATE workers
       SET status = 'failed', completed_at = NOW(), error = $2, iteration = $3
       WHERE id = $1`,
      [workerId, error, iteration]
    );

    // Update work item
    await this.db.execute(
      `UPDATE work_items
       SET status = 'failed', error = $2, iteration = $3
       WHERE id = $1`,
      [worker.workItemId, error, iteration]
    );

    // Release all file locks
    await this.conflictDetector.releaseAllLocks(workerId);

    // Record worker done with rate limiter
    await this.rateLimiter.recordWorkerDone();
  }

  /**
   * Handle worker stuck state
   *
   * Called when a worker gets stuck (e.g., repeated failures, can't proceed).
   * Updates worker status and optionally triggers intervention.
   *
   * @param workerId - The worker ID
   * @param reason - Reason for being stuck
   * @param attempts - Number of attempts made
   */
  async stuck(workerId: string, reason: string, attempts: number): Promise<void> {
    // Get worker
    const worker = await this.db.getWorker(workerId);
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }

    // Update worker status
    await this.db.execute(
      `UPDATE workers
       SET status = 'stuck', error = $2
       WHERE id = $1`,
      [workerId, `Stuck after ${attempts} attempts: ${reason}`]
    );

    // Update work item status (keep as in_progress for potential retry)
    await this.db.execute(
      `UPDATE work_items SET error = $2 WHERE id = $1`,
      [worker.workItemId, `Worker stuck: ${reason}`]
    );
  }

  /**
   * Check for stale workers
   *
   * Finds workers that haven't sent a heartbeat within the threshold.
   * Returns workers that may need to be killed or investigated.
   *
   * @returns Array of stale workers
   */
  async healthCheck(): Promise<Worker[]> {
    return this.db.query<Worker>(
      `SELECT * FROM workers
       WHERE status IN ('starting', 'running')
       AND last_heartbeat < NOW() - INTERVAL '${this.config.staleThresholdSeconds} seconds'`
    );
  }

  /**
   * Kill a worker container
   *
   * Stops the Docker container and updates worker status.
   * Releases file locks and updates work item.
   *
   * @param workerId - The worker ID to kill
   * @param reason - Reason for killing
   */
  async kill(workerId: string, reason: string): Promise<void> {
    // Get worker
    const worker = await this.db.getWorker(workerId);
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }

    // Kill Docker container if we have a container ID
    if (worker.containerId) {
      try {
        const container = this.docker.getContainer(worker.containerId);
        await container.stop({ t: 10 }); // 10 second grace period
      } catch (err) {
        // Container might already be stopped or removed
        console.warn(`Failed to stop container ${worker.containerId}:`, err);
      }
    }

    // Update worker status
    await this.db.execute(
      `UPDATE workers
       SET status = 'killed', completed_at = NOW(), error = $2
       WHERE id = $1`,
      [workerId, `Killed: ${reason}`]
    );

    // Update work item (back to queued for retry, or failed if max iterations)
    const workItem = await this.db.getWorkItem(worker.workItemId);
    if (workItem && workItem.iteration < workItem.maxIterations) {
      await this.db.execute(
        `UPDATE work_items SET status = 'queued', worker_id = NULL, error = $2 WHERE id = $1`,
        [worker.workItemId, `Worker killed: ${reason}`]
      );
    } else {
      await this.db.execute(
        `UPDATE work_items SET status = 'failed', error = $2 WHERE id = $1`,
        [worker.workItemId, `Worker killed (max iterations): ${reason}`]
      );
    }

    // Release all file locks
    await this.conflictDetector.releaseAllLocks(workerId);

    // Record worker done with rate limiter
    await this.rateLimiter.recordWorkerDone();
  }

  /**
   * List all workers
   *
   * Returns all workers ordered by started_at descending.
   *
   * @returns Array of all workers
   */
  async list(): Promise<Worker[]> {
    return this.db.query<Worker>(
      `SELECT * FROM workers ORDER BY started_at DESC`
    );
  }

  /**
   * Get worker statistics
   *
   * Returns counts by status and average metrics.
   *
   * @returns Worker statistics
   */
  async getStats(): Promise<WorkerStatsResponse> {
    // Get total count
    const totalResult = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM workers`
    );
    const total = parseInt(totalResult?.count ?? "0", 10);

    // Get count by status
    const statusRows = await this.db.query<{
      status: WorkerStatus;
      count: string;
    }>(`SELECT status, COUNT(*) as count FROM workers GROUP BY status`);

    const byStatus: Record<WorkerStatus, number> = {
      starting: 0,
      running: 0,
      completed: 0,
      failed: 0,
      stuck: 0,
      killed: 0,
    };

    for (const row of statusRows) {
      byStatus[row.status] = parseInt(row.count, 10);
    }

    // Get average iterations for completed workers
    const avgIterResult = await this.db.queryOne<{ avg: string | null }>(
      `SELECT AVG(iteration) as avg FROM workers WHERE status = 'completed'`
    );
    const avgIterations = avgIterResult?.avg ? parseFloat(avgIterResult.avg) : 0;

    // Get average duration from metrics
    const avgDurationResult = await this.db.queryOne<{ avg: string | null }>(
      `SELECT AVG(duration) as avg FROM worker_metrics`
    );
    const avgDuration = avgDurationResult?.avg ? parseFloat(avgDurationResult.avg) : 0;

    return { total, byStatus, avgIterations, avgDuration };
  }
}
