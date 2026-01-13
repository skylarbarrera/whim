/**
 * Express API Server
 *
 * Provides REST API endpoints for the AI Software Factory orchestrator.
 * All endpoints return JSON and use consistent error handling.
 */

import express, { type Request, type Response, type NextFunction } from "express";
import type { QueueManager } from "./queue.js";
import type { WorkerManager } from "./workers.js";
import type { ConflictDetector } from "./conflicts.js";
import type { RateLimiter } from "./rate-limits.js";
import type { MetricsCollector } from "./metrics.js";
import type {
  AddWorkItemRequest,
  WorkerRegisterRequest,
  WorkerHeartbeatRequest,
  WorkerLockRequest,
  WorkerCompleteRequest,
  WorkerFailRequest,
  WorkerStuckRequest,
  ErrorResponse,
  StatusResponse,
} from "@factory/shared";

/**
 * Dependencies required by the server
 */
export interface ServerDependencies {
  queue: QueueManager;
  workers: WorkerManager;
  conflicts: ConflictDetector;
  rateLimiter: RateLimiter;
  metrics: MetricsCollector;
  db: {
    query<T>(text: string, values?: unknown[]): Promise<T[]>;
    queryOne<T>(text: string, values?: unknown[]): Promise<T | null>;
    execute(text: string, values?: unknown[]): Promise<{ rowCount: number }>;
  };
}

/**
 * Type guard for AddWorkItemRequest
 */
function isValidAddWorkItemRequest(body: unknown): body is AddWorkItemRequest {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;
  if (typeof obj.repo !== "string" || obj.repo.length === 0) return false;
  if (typeof obj.spec !== "string" || obj.spec.length === 0) return false;
  if (obj.branch !== undefined && typeof obj.branch !== "string") return false;
  if (obj.priority !== undefined && !["low", "medium", "high", "critical"].includes(obj.priority as string)) return false;
  if (obj.maxIterations !== undefined && (typeof obj.maxIterations !== "number" || obj.maxIterations < 1)) return false;
  return true;
}

/**
 * Type guard for WorkerRegisterRequest
 */
function isValidWorkerRegisterRequest(body: unknown): body is WorkerRegisterRequest {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;
  return typeof obj.workItemId === "string" && obj.workItemId.length > 0;
}

/**
 * Type guard for WorkerHeartbeatRequest
 */
function isValidWorkerHeartbeatRequest(body: unknown): body is WorkerHeartbeatRequest {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;
  return typeof obj.iteration === "number" && obj.iteration >= 0;
}

/**
 * Type guard for WorkerLockRequest
 */
function isValidWorkerLockRequest(body: unknown): body is WorkerLockRequest {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;
  return Array.isArray(obj.files) && obj.files.every((f) => typeof f === "string");
}

/**
 * Type guard for WorkerCompleteRequest
 */
function isValidWorkerCompleteRequest(body: unknown): body is WorkerCompleteRequest {
  // WorkerCompleteRequest has all optional fields
  if (typeof body !== "object" || body === null) return false;
  return true;
}

/**
 * Type guard for WorkerFailRequest
 */
function isValidWorkerFailRequest(body: unknown): body is WorkerFailRequest {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;
  return typeof obj.error === "string" && typeof obj.iteration === "number";
}

/**
 * Type guard for WorkerStuckRequest
 */
function isValidWorkerStuckRequest(body: unknown): body is WorkerStuckRequest {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;
  return typeof obj.reason === "string" && typeof obj.attempts === "number";
}

/**
 * Create error response
 */
function errorResponse(error: string, code?: string, details?: Record<string, unknown>): ErrorResponse {
  return { error, code, details };
}

/**
 * Async handler wrapper for Express routes
 * Catches async errors and passes them to Express error handler
 */
function asyncHandler<P = Record<string, string>>(
  fn: (req: Request<P>, res: Response) => Promise<void>
) {
  return (req: Request<P>, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

/**
 * Route parameter types
 */
interface IdParams {
  id: string;
}

/**
 * Create Express server with all orchestrator endpoints
 *
 * @param deps - Server dependencies (queue, workers, etc.)
 * @returns Express application
 */
export function createServer(deps: ServerDependencies): express.Application {
  const app = express();

  // Middleware
  app.use(express.json());

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // ==========================================================================
  // Work Item Routes
  // ==========================================================================

  /**
   * POST /api/work - Add work item to queue
   */
  app.post(
    "/api/work",
    asyncHandler(async (req, res) => {
      if (!isValidAddWorkItemRequest(req.body)) {
        res.status(400).json(errorResponse("Invalid request body", "VALIDATION_ERROR"));
        return;
      }

      const workItem = await deps.queue.add(req.body);
      res.status(201).json({ id: workItem.id, status: workItem.status });
    })
  );

  /**
   * GET /api/work/:id - Get work item by ID
   */
  app.get(
    "/api/work/:id",
    asyncHandler<IdParams>(async (req, res) => {
      const workItem = await deps.queue.get(req.params.id);
      if (!workItem) {
        res.status(404).json(errorResponse("Work item not found", "NOT_FOUND"));
        return;
      }
      res.json(workItem);
    })
  );

  /**
   * POST /api/work/:id/cancel - Cancel work item
   */
  app.post(
    "/api/work/:id/cancel",
    asyncHandler<IdParams>(async (req, res) => {
      const cancelled = await deps.queue.cancel(req.params.id);
      if (!cancelled) {
        res.status(400).json(errorResponse("Cannot cancel work item (not queued or assigned)", "INVALID_STATE"));
        return;
      }
      res.json({ success: true });
    })
  );

  // ==========================================================================
  // Worker Routes
  // ==========================================================================

  /**
   * POST /api/worker/register - Worker self-registration
   */
  app.post(
    "/api/worker/register",
    asyncHandler(async (req, res) => {
      if (!isValidWorkerRegisterRequest(req.body)) {
        res.status(400).json(errorResponse("Invalid request body", "VALIDATION_ERROR"));
        return;
      }

      const { worker, workItem } = await deps.workers.register(req.body.workItemId);
      res.status(201).json({ workerId: worker.id, workItem });
    })
  );

  /**
   * POST /api/worker/:id/heartbeat - Worker heartbeat
   */
  app.post(
    "/api/worker/:id/heartbeat",
    asyncHandler<IdParams>(async (req, res) => {
      if (!isValidWorkerHeartbeatRequest(req.body)) {
        res.status(400).json(errorResponse("Invalid request body", "VALIDATION_ERROR"));
        return;
      }

      await deps.workers.heartbeat(req.params.id, req.body);
      res.json({ success: true });
    })
  );

  /**
   * POST /api/worker/:id/lock - Request file locks
   */
  app.post(
    "/api/worker/:id/lock",
    asyncHandler<IdParams>(async (req, res) => {
      if (!isValidWorkerLockRequest(req.body)) {
        res.status(400).json(errorResponse("Invalid request body", "VALIDATION_ERROR"));
        return;
      }

      const result = await deps.conflicts.acquireLocks(req.params.id, req.body.files);
      const acquired = result.blocked.length === 0;
      res.json({
        acquired,
        ...(result.blocked.length > 0 && { blockedFiles: result.blocked }),
      });
    })
  );

  /**
   * POST /api/worker/:id/unlock - Release file locks
   */
  app.post(
    "/api/worker/:id/unlock",
    asyncHandler<IdParams>(async (req, res) => {
      if (!isValidWorkerLockRequest(req.body)) {
        res.status(400).json(errorResponse("Invalid request body", "VALIDATION_ERROR"));
        return;
      }

      await deps.conflicts.releaseLocks(req.params.id, req.body.files);
      res.json({ success: true });
    })
  );

  /**
   * POST /api/worker/:id/complete - Worker completed
   */
  app.post(
    "/api/worker/:id/complete",
    asyncHandler<IdParams>(async (req, res) => {
      if (!isValidWorkerCompleteRequest(req.body)) {
        res.status(400).json(errorResponse("Invalid request body", "VALIDATION_ERROR"));
        return;
      }

      await deps.workers.complete(req.params.id, req.body);
      res.json({ success: true });
    })
  );

  /**
   * POST /api/worker/:id/fail - Worker failed
   */
  app.post(
    "/api/worker/:id/fail",
    asyncHandler<IdParams>(async (req, res) => {
      if (!isValidWorkerFailRequest(req.body)) {
        res.status(400).json(errorResponse("Invalid request body", "VALIDATION_ERROR"));
        return;
      }

      await deps.workers.fail(req.params.id, req.body.error, req.body.iteration);
      res.json({ success: true });
    })
  );

  /**
   * POST /api/worker/:id/stuck - Worker stuck
   */
  app.post(
    "/api/worker/:id/stuck",
    asyncHandler<IdParams>(async (req, res) => {
      if (!isValidWorkerStuckRequest(req.body)) {
        res.status(400).json(errorResponse("Invalid request body", "VALIDATION_ERROR"));
        return;
      }

      await deps.workers.stuck(req.params.id, req.body.reason, req.body.attempts);
      res.json({ success: true });
    })
  );

  // ==========================================================================
  // Management Routes
  // ==========================================================================

  /**
   * GET /api/status - Overall factory status
   */
  app.get(
    "/api/status",
    asyncHandler(async (_req, res) => {
      const rateLimitStatus = await deps.rateLimiter.getStatus();
      const queueItems = await deps.queue.list();

      // Find oldest queued item
      const queuedItems = queueItems.filter((item) => item.status === "queued");
      const oldestItem = queuedItems[queuedItems.length - 1];
      const oldest = oldestItem?.createdAt ?? null;

      const status: StatusResponse = {
        status: rateLimitStatus.canSpawn ? "healthy" : "degraded",
        workers: {
          active: rateLimitStatus.activeWorkers,
          maxWorkers: rateLimitStatus.maxWorkers,
        },
        queue: {
          size: queuedItems.length,
          oldest,
        },
        rateLimits: {
          iterationsToday: rateLimitStatus.iterationsToday,
          dailyBudget: rateLimitStatus.dailyBudget,
          lastSpawn: rateLimitStatus.lastSpawn,
          cooldownSeconds: rateLimitStatus.cooldownSeconds,
        },
      };

      res.json(status);
    })
  );

  /**
   * GET /api/workers - List all workers
   */
  app.get(
    "/api/workers",
    asyncHandler(async (_req, res) => {
      const workers = await deps.workers.list();
      res.json(workers);
    })
  );

  /**
   * POST /api/workers/:id/kill - Kill worker
   */
  app.post(
    "/api/workers/:id/kill",
    asyncHandler<IdParams>(async (req, res) => {
      const reason = (req.body as { reason?: string })?.reason ?? "Manual kill";
      await deps.workers.kill(req.params.id, reason);
      res.json({ success: true });
    })
  );

  /**
   * GET /api/queue - Queue contents and stats
   */
  app.get(
    "/api/queue",
    asyncHandler(async (_req, res) => {
      const [items, stats] = await Promise.all([deps.queue.list(), deps.queue.getStats()]);
      res.json({ items, stats });
    })
  );

  /**
   * GET /api/metrics - Factory metrics
   */
  app.get(
    "/api/metrics",
    asyncHandler(async (_req, res) => {
      const summary = await deps.metrics.getSummary();
      res.json(summary);
    })
  );

  /**
   * GET /api/learnings - Learnings with optional filters
   */
  app.get(
    "/api/learnings",
    asyncHandler(async (req, res) => {
      const options: { repo?: string; spec?: string; limit?: number } = {};

      if (typeof req.query.repo === "string") {
        options.repo = req.query.repo;
      }
      if (typeof req.query.spec === "string") {
        options.spec = req.query.spec;
      }
      if (typeof req.query.limit === "string") {
        const limit = parseInt(req.query.limit, 10);
        if (!isNaN(limit) && limit > 0) {
          options.limit = limit;
        }
      }

      const learnings = await deps.metrics.getLearnings(options);
      res.json(learnings);
    })
  );

  // ==========================================================================
  // PR Review API
  // ==========================================================================

  /**
   * GET /api/pr-reviews - List all PR reviews with optional filters
   */
  app.get(
    "/api/pr-reviews",
    asyncHandler(async (req, res) => {
      const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 50;
      const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) : 0;

      let query = `
        SELECT * FROM pr_reviews
        WHERE 1=1
      `;
      const values: unknown[] = [];
      let paramCount = 0;

      if (typeof req.query.repoOwner === "string") {
        paramCount++;
        query += ` AND repo_owner = $${paramCount}`;
        values.push(req.query.repoOwner);
      }

      if (typeof req.query.repoName === "string") {
        paramCount++;
        query += ` AND repo_name = $${paramCount}`;
        values.push(req.query.repoName);
      }

      if (typeof req.query.status === "string") {
        paramCount++;
        query += ` AND status = $${paramCount}`;
        values.push(req.query.status);
      }

      query += ` ORDER BY created_at DESC`;

      // Count total for pagination
      const countQuery = query.replace("SELECT *", "SELECT COUNT(*)");
      const countResult = await deps.db.queryOne<{ count: string }>(countQuery, values);
      const total = countResult ? parseInt(countResult.count, 10) : 0;

      // Add pagination
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      values.push(limit);
      paramCount++;
      query += ` OFFSET $${paramCount}`;
      values.push(offset);

      const reviews = await deps.db.query<any>(query, values);

      res.json({
        reviews,
        total,
        hasMore: offset + limit < total,
      });
    })
  );

  /**
   * GET /api/pr-reviews/:id - Get details for a specific PR review
   */
  app.get(
    "/api/pr-reviews/:id",
    asyncHandler(async (req, res) => {
      const { id } = req.params;

      const review = await deps.db.queryOne<any>(
        "SELECT * FROM pr_reviews WHERE id = $1",
        [id]
      );

      if (!review) {
        res.status(404).json(errorResponse("PR review not found", "NOT_FOUND"));
        return;
      }

      const checks = await deps.db.query<any>(
        "SELECT * FROM pr_review_checks WHERE review_id = $1 ORDER BY created_at ASC",
        [id]
      );

      res.json({
        review,
        checks,
      });
    })
  );

  /**
   * POST /api/pr-reviews/:id/override - Emergency override for a PR review
   */
  app.post(
    "/api/pr-reviews/:id/override",
    asyncHandler(async (req, res) => {
      const { id } = req.params;

      if (typeof req.body.reason !== "string" || req.body.reason.length === 0) {
        res.status(400).json(errorResponse("Override reason is required", "VALIDATION_ERROR"));
        return;
      }

      if (typeof req.body.user !== "string" || req.body.user.length === 0) {
        res.status(400).json(errorResponse("Override user is required", "VALIDATION_ERROR"));
        return;
      }

      const review = await deps.db.queryOne<any>(
        "SELECT * FROM pr_reviews WHERE id = $1",
        [id]
      );

      if (!review) {
        res.status(404).json(errorResponse("PR review not found", "NOT_FOUND"));
        return;
      }

      const updatedReview = await deps.db.queryOne<any>(
        `UPDATE pr_reviews
         SET merge_blocked = false,
             override_user = $2,
             override_reason = $3,
             override_at = NOW(),
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, req.body.user, req.body.reason]
      );

      res.json({
        success: true,
        review: updatedReview,
      });
    })
  );

  /**
   * POST /api/pr-reviews/:id/manual-review - Submit a manual review
   */
  app.post(
    "/api/pr-reviews/:id/manual-review",
    asyncHandler(async (req, res) => {
      const { id } = req.params;

      if (!["approve", "reject"].includes(req.body.action)) {
        res.status(400).json(errorResponse("Action must be 'approve' or 'reject'", "VALIDATION_ERROR"));
        return;
      }

      if (typeof req.body.comment !== "string" || req.body.comment.length === 0) {
        res.status(400).json(errorResponse("Comment is required", "VALIDATION_ERROR"));
        return;
      }

      if (typeof req.body.reviewer !== "string" || req.body.reviewer.length === 0) {
        res.status(400).json(errorResponse("Reviewer is required", "VALIDATION_ERROR"));
        return;
      }

      const review = await deps.db.queryOne<any>(
        "SELECT * FROM pr_reviews WHERE id = $1",
        [id]
      );

      if (!review) {
        res.status(404).json(errorResponse("PR review not found", "NOT_FOUND"));
        return;
      }

      // Create or update manual review check
      const checkStatus = req.body.action === "approve" ? "success" : "failure";
      const checkName = "manual-review";

      const existingCheck = await deps.db.queryOne<any>(
        "SELECT * FROM pr_review_checks WHERE review_id = $1 AND check_name = $2",
        [id, checkName]
      );

      let check;
      if (existingCheck) {
        check = await deps.db.queryOne<any>(
          `UPDATE pr_review_checks
           SET status = $3,
               summary = $4,
               details = $5,
               completed_at = NOW(),
               metadata = jsonb_set(metadata, '{reviewer}', to_jsonb($6::text))
           WHERE id = $1 AND review_id = $2
           RETURNING *`,
          [existingCheck.id, id, checkStatus, `Manual review: ${req.body.action}`, req.body.comment, req.body.reviewer]
        );
      } else {
        check = await deps.db.queryOne<any>(
          `INSERT INTO pr_review_checks
           (id, review_id, check_name, check_type, status, required, summary, details, error_count, warning_count, started_at, completed_at, metadata)
           VALUES (gen_random_uuid(), $1, $2, 'manual', $3, true, $4, $5, 0, 0, NOW(), NOW(), jsonb_build_object('reviewer', $6))
           RETURNING *`,
          [id, checkName, checkStatus, `Manual review: ${req.body.action}`, req.body.comment, req.body.reviewer]
        );
      }

      // Update review merge_blocked status based on all checks
      const allChecks = await deps.db.query<any>(
        "SELECT * FROM pr_review_checks WHERE review_id = $1 AND required = true",
        [id]
      );

      const anyFailed = allChecks.some((c: any) => c.status === "failure" || c.status === "error");
      const anyPending = allChecks.some((c: any) => c.status === "pending" || c.status === "running");

      const mergeBlocked = anyFailed || anyPending;

      await deps.db.execute(
        `UPDATE pr_reviews
         SET merge_blocked = $2,
             status = CASE
               WHEN $3 THEN 'failed'
               WHEN $4 THEN 'running'
               ELSE 'completed'
             END,
             updated_at = NOW()
         WHERE id = $1`,
        [id, mergeBlocked, anyFailed, anyPending]
      );

      const updatedReview = await deps.db.queryOne<any>(
        "SELECT * FROM pr_reviews WHERE id = $1",
        [id]
      );

      res.json({
        success: true,
        review: updatedReview,
        check,
      });
    })
  );

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json(errorResponse("Not found", "NOT_FOUND"));
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Server error:", err);
    res.status(500).json(errorResponse(err.message, "INTERNAL_ERROR"));
  });

  return app;
}
