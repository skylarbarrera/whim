/**
 * WorkerManager - Manages worker lifecycle
 *
 * Handles spawning Docker containers, worker registration, heartbeats,
 * completion, failure, and health checks for whim workers.
 */

import { v4 as uuid } from "uuid";
import type Docker from "dockerode";
import type { Database } from "./db.js";
import type { RateLimiter } from "./rate-limits.js";
import type { ConflictDetector } from "./conflicts.js";
import type { QueueManager } from "./queue.js";
import type {
  Worker,
  WorkerStatus,
  WorkItem,
  WorkerStatsResponse,
  WorkerHeartbeatRequest,
  WorkerCompleteRequest,
} from "@whim/shared";

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
    private queue: QueueManager,
    config?: Partial<WorkerManagerConfig>
  ) {
    this.config = {
      workerImage: config?.workerImage ?? process.env.WORKER_IMAGE ?? "whim-worker:latest",
      orchestratorUrl: config?.orchestratorUrl ?? process.env.ORCHESTRATOR_URL ?? "http://whim-orchestrator:3000",
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
   * If container creation fails, rolls back database changes.
   * Records the spawn with the rate limiter.
   *
   * @param workItem - The work item to process
   * @param mode - Worker mode: 'execution' (default) or 'verification'
   * @returns The worker ID and container ID
   */
  async spawn(workItem: WorkItem, mode: 'execution' | 'verification' = 'execution'): Promise<SpawnResult> {
    const workerId = uuid();

    // Create worker record
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

    // Spawn Docker container - if this fails, rollback DB changes
    let container: { id: string; start: () => Promise<void> };
    try {
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

      const envVars = [
        `WORKER_ID=${workerId}`,
        `WORK_ITEM=${JSON.stringify(workItem)}`,
        `ORCHESTRATOR_URL=${workerOrchestratorUrl}`,
        `GITHUB_TOKEN=${process.env.GITHUB_TOKEN ?? ""}`,
        `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ?? ""}`,
        // Pass through mock mode for testing lifecycle without Claude
        `MOCK_RALPH=${process.env.MOCK_RALPH ?? ""}`,
        `MOCK_FAIL=${process.env.MOCK_FAIL ?? ""}`,
        `MOCK_STUCK=${process.env.MOCK_STUCK ?? ""}`,
      ];

      // Add WORKER_MODE for verification workers
      if (mode === 'verification') {
        envVars.push('WORKER_MODE=verification');
      }

      container = await this.docker.createContainer({
        Image: this.config.workerImage,
        Env: envVars,
        HostConfig: {
          AutoRemove: false,  // Keep for debugging
          NetworkMode: "whim-network",
          // Resource limits to prevent runaway containers
          Memory: 4 * 1024 * 1024 * 1024,  // 4GB memory limit
          MemorySwap: 4 * 1024 * 1024 * 1024,  // No swap (same as memory)
          NanoCpus: 2 * 1e9,  // 2 CPU cores
          PidsLimit: 256,  // Max 256 processes
        },
      });

      await container.start();
    } catch (error) {
      // Rollback: delete worker record and reset work item status
      // Wrap in try/catch to ensure original error is always thrown
      try {
        await this.db.execute(`DELETE FROM workers WHERE id = $1`, [workerId]);
        await this.db.execute(
          `UPDATE work_items SET worker_id = NULL, status = 'queued' WHERE id = $1`,
          [workItem.id]
        );
      } catch (rollbackError) {
        console.error(`Rollback failed for worker ${workerId}:`, rollbackError);
        // Continue to throw original error
      }
      throw error;
    }

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

    // Get work item to determine type-specific completion logic
    const workItem = await this.db.getWorkItem(worker.workItemId);
    if (!workItem) {
      throw new Error(`Work item not found: ${worker.workItemId}`);
    }

    // Update worker status
    await this.db.execute(
      `UPDATE workers SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [workerId]
    );

    if (workItem.type === 'verification') {
      // Verification item completion
      // Store verification result on the verification work item
      await this.db.execute(
        `UPDATE work_items
         SET status = 'completed', completed_at = NOW(), verification_passed = $2
         WHERE id = $1`,
        [worker.workItemId, data.verificationPassed ?? null]
      );

      // Update parent execution item metadata with verification status
      if (workItem.parentWorkItemId) {
        const verificationStatus = JSON.stringify({
          passed: data.verificationPassed ?? null,
          verificationWorkItemId: workItem.id,
          completedAt: new Date().toISOString()
        });
        await this.db.execute(
          `UPDATE work_items
           SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{verificationStatus}', $2::jsonb)
           WHERE id = $1`,
          [workItem.parentWorkItemId, verificationStatus]
        );
        console.log(`Updated parent work item ${workItem.parentWorkItemId} with verification status: ${data.verificationPassed}`);
      }
    } else {
      // Execution item completion
      // Update work item with prUrl and prNumber
      await this.db.execute(
        `UPDATE work_items
         SET status = 'completed', completed_at = NOW(), pr_url = $2, pr_number = $3
         WHERE id = $1`,
        [worker.workItemId, data.prUrl ?? null, data.prNumber ?? null]
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

      // Create verification work item if verification is enabled
      if (data.verificationEnabled && data.prNumber && worker.workItemId) {
        try {
          await this.queue.addVerificationWorkItem(workItem, data.prNumber);
          console.log(`Created verification work item for execution item ${worker.workItemId}`);
        } catch (error) {
          // Log but don't fail if verification work item creation fails
          console.error(`Failed to create verification work item for ${workerId}:`, error);
        }
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

    // Get work item to determine retry strategy
    const workItem = await this.db.getWorkItem(worker.workItemId);
    if (!workItem) {
      throw new Error(`Work item not found: ${worker.workItemId}`);
    }

    // Per-type retry logic
    if (workItem.type === 'verification') {
      // Verification: immediate retry up to max attempts
      const maxRetries = parseInt(process.env.VERIFICATION_MAX_RETRIES || '3', 10);
      const newRetryCount = workItem.retryCount + 1;

      if (newRetryCount > maxRetries) {
        // Max retries exceeded - mark as permanently failed
        await this.db.execute(
          `UPDATE work_items
           SET status = 'failed', error = $2, retry_count = $3, iteration = $4
           WHERE id = $1`,
          [worker.workItemId, `Verification failed (max retries ${maxRetries}): ${error}`, newRetryCount, iteration]
        );
      } else {
        // Immediate requeue (no backoff for verification)
        await this.db.execute(
          `UPDATE work_items
           SET status = 'queued', worker_id = NULL, error = $2, retry_count = $3, iteration = $4
           WHERE id = $1`,
          [worker.workItemId, `Verification failed (retry ${newRetryCount}/${maxRetries}): ${error}`, newRetryCount, iteration]
        );
      }
    } else {
      // Execution: exponential backoff
      const maxRetries = 3;
      const newRetryCount = workItem.retryCount + 1;

      if (newRetryCount > maxRetries) {
        // Max retries exceeded - mark as permanently failed
        await this.db.execute(
          `UPDATE work_items
           SET status = 'failed', error = $2, retry_count = $3, iteration = $4
           WHERE id = $1`,
          [worker.workItemId, `Execution failed (max retries ${maxRetries}): ${error}`, newRetryCount, iteration]
        );
      } else {
        // Calculate exponential backoff: 1min, 5min, 30min
        const backoffMinutes = [1, 5, 30][Math.min(newRetryCount - 1, 2)] ?? 30;
        await this.db.execute(
          `UPDATE work_items
           SET status = 'queued', worker_id = NULL, error = $2,
               retry_count = $3, next_retry_at = NOW() + INTERVAL '1 minute' * $4, iteration = $5
           WHERE id = $1`,
          [worker.workItemId, `Execution failed (retry ${newRetryCount}/${maxRetries}): ${error}`, newRetryCount, backoffMinutes, iteration]
        );
      }
    }

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

    // Release file locks so other workers aren't blocked
    await this.conflictDetector.releaseAllLocks(workerId);
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
       AND last_heartbeat < NOW() - INTERVAL '1 second' * $1`,
      [this.config.staleThresholdSeconds]
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
        // Capture last logs for debugging before killing
        try {
          const logs = await container.logs({
            stdout: true,
            stderr: true,
            tail: 50,  // Last 50 lines
          });
          console.log(`[Worker ${workerId}] Last logs before kill:\n${logs.toString()}`);
        } catch {
          // Log capture is best-effort
        }
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

    // Update work item with retry backoff
    const workItem = await this.db.getWorkItem(worker.workItemId);
    const maxRetries = 3;

    if (workItem) {
      const newRetryCount = workItem.retryCount + 1;

      if (newRetryCount > maxRetries) {
        // Max retries exceeded - mark as permanently failed
        await this.db.execute(
          `UPDATE work_items SET status = 'failed', error = $2, retry_count = $3 WHERE id = $1`,
          [worker.workItemId, `Worker killed (max retries ${maxRetries}): ${reason}`, newRetryCount]
        );
      } else if (workItem.iteration >= workItem.maxIterations) {
        // Max iterations exceeded - mark as failed
        await this.db.execute(
          `UPDATE work_items SET status = 'failed', error = $2 WHERE id = $1`,
          [worker.workItemId, `Worker killed (max iterations): ${reason}`]
        );
      } else {
        // Calculate exponential backoff: 1min, 5min, 30min
        const backoffMinutes = [1, 5, 30][Math.min(newRetryCount - 1, 2)] ?? 30;
        await this.db.execute(
          `UPDATE work_items
           SET status = 'queued', worker_id = NULL, error = $2,
               retry_count = $3, next_retry_at = NOW() + INTERVAL '1 minute' * $4
           WHERE id = $1`,
          [worker.workItemId, `Worker killed: ${reason} (retry ${newRetryCount}/${maxRetries})`, newRetryCount, backoffMinutes]
        );
      }
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

  /**
   * Get container logs for a worker
   *
   * Fetches the logs from the Docker container associated with a worker.
   * Returns the most recent N lines (default 1000).
   *
   * @param workerId - The worker ID
   * @param lines - Number of lines to fetch (default 1000)
   * @returns Array of log lines
   */
  async getLogs(workerId: string, lines: number = 1000): Promise<string[]> {
    // Get worker to find container ID
    const worker = await this.db.getWorker(workerId);
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }

    if (!worker.containerId) {
      throw new Error(`Worker ${workerId} has no container ID`);
    }

    try {
      // Get container
      const container = this.docker.getContainer(worker.containerId);

      // Check if container exists
      const containerInfo = await container.inspect();

      // Get logs
      const logStream = await container.logs({
        stdout: true,
        stderr: true,
        tail: lines,
        timestamps: false,
      });

      // Convert buffer to string and split into lines
      const logString = logStream.toString('utf-8');
      const logLines = logString.split('\n').filter(line => line.trim().length > 0);

      return logLines;
    } catch (error) {
      // If container doesn't exist or error accessing logs, return empty array
      if ((error as any).statusCode === 404) {
        throw new Error(`Container not found for worker ${workerId}`);
      }
      throw error;
    }
  }
}
