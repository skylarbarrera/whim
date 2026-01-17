/**
 * Express API Server
 *
 * Provides REST API endpoints for the Whim orchestrator.
 * All endpoints return JSON and use consistent error handling.
 */

import express, { type Request, type Response, type NextFunction } from "express";
import type { QueueManager } from "./queue.js";
import type { WorkerManager } from "./workers.js";
import type { ConflictDetector } from "./conflicts.js";
import type { RateLimiter } from "./rate-limits.js";
import type { MetricsCollector } from "./metrics.js";
import type { Database } from "./db.js";
import type { SpecGenerationManager } from "./spec-generation.js";
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
  WorkItemType,
} from "@whim/shared";

/**
 * Dependencies required by the server
 */
export interface ServerDependencies {
  queue: QueueManager;
  workers: WorkerManager;
  conflicts: ConflictDetector;
  rateLimiter: RateLimiter;
  metrics: MetricsCollector;
  db: Database;
  specGenManager: SpecGenerationManager;
}

/**
 * Type guard for AddWorkItemRequest
 */
// Validation constants
const MAX_REPO_LENGTH = 200;
const MAX_BRANCH_LENGTH = 250;
const MAX_SPEC_LENGTH = 100_000;  // 100KB
const MAX_DESCRIPTION_LENGTH = 50_000;  // 50KB
const MAX_SOURCE_LENGTH = 50;
const MAX_SOURCE_REF_LENGTH = 200;
const REPO_PATTERN = /^[a-zA-Z0-9][-a-zA-Z0-9]*\/[a-zA-Z0-9._-]+$/;

function isValidAddWorkItemRequest(body: unknown): body is AddWorkItemRequest {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;
  // Repo validation: required, format, length
  if (typeof obj.repo !== "string" || obj.repo.length === 0) return false;
  if (obj.repo.length > MAX_REPO_LENGTH) return false;
  if (!REPO_PATTERN.test(obj.repo)) return false;

  // Spec XOR description validation: exactly one required
  const hasSpec = typeof obj.spec === "string" && obj.spec.length > 0;
  const hasDescription = typeof obj.description === "string" && obj.description.length > 0;
  if (hasSpec && hasDescription) return false;  // Both provided - invalid
  if (!hasSpec && !hasDescription) return false;  // Neither provided - invalid

  // Spec validation: if provided, check length
  if (hasSpec && (obj.spec as string).length > MAX_SPEC_LENGTH) return false;

  // Description validation: if provided, check length
  if (hasDescription && (obj.description as string).length > MAX_DESCRIPTION_LENGTH) return false;

  // Branch validation: optional, length
  if (obj.branch !== undefined && typeof obj.branch !== "string") return false;
  if (typeof obj.branch === "string" && obj.branch.length > MAX_BRANCH_LENGTH) return false;

  // Priority validation
  if (obj.priority !== undefined && !["low", "medium", "high", "critical"].includes(obj.priority as string)) return false;

  // Max iterations validation
  if (obj.maxIterations !== undefined && (typeof obj.maxIterations !== "number" || obj.maxIterations < 1)) return false;

  // Source validation: optional, length
  if (obj.source !== undefined && (typeof obj.source !== "string" || obj.source.length > MAX_SOURCE_LENGTH)) return false;

  // Source ref validation: optional, length
  if (obj.sourceRef !== undefined && (typeof obj.sourceRef !== "string" || obj.sourceRef.length > MAX_SOURCE_REF_LENGTH)) return false;

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
  return (
    typeof obj.repo === "string" &&
    obj.repo.length > 0 &&
    Array.isArray(obj.files) &&
    obj.files.every((f) => typeof f === "string")
  );
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
  app.use(express.json({ limit: "1mb" }));  // Limit request body size

  // API Key authentication middleware
  const apiKey = process.env.API_KEY;
  if (apiKey) {
    app.use((req, res, next) => {
      // Skip auth for health check (for load balancers)
      if (req.path === "/health") {
        return next();
      }
      // Skip auth for worker endpoints (workers authenticate via WORKER_ID)
      if (req.path.startsWith("/api/worker/")) {
        return next();
      }
      // Check for API key in header
      const providedKey = req.headers["x-api-key"] ||
        req.headers.authorization?.replace("Bearer ", "");
      if (providedKey !== apiKey) {
        return res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      }
      next();
    });
  }

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

      // If work item has description (not spec), start background spec generation
      if (workItem.status === "generating") {
        deps.specGenManager.start(workItem);
      }

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

  /**
   * POST /api/work/:id/requeue - Requeue a failed/completed/cancelled work item
   */
  app.post(
    "/api/work/:id/requeue",
    asyncHandler<IdParams>(async (req, res) => {
      try {
        const workItem = await deps.queue.requeue(req.params.id);
        res.json(workItem);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        if (message.includes("not found")) {
          res.status(404).json(errorResponse(message, "NOT_FOUND"));
        } else if (message.includes("Cannot requeue")) {
          res.status(400).json(errorResponse(message, "INVALID_STATE"));
        } else {
          throw error;
        }
      }
    })
  );

  /**
   * GET /api/work/:id/verification - Get verification work item linked to an execution item
   */
  app.get(
    "/api/work/:id/verification",
    asyncHandler<IdParams>(async (req, res) => {
      // First check if the execution item exists
      const executionItem = await deps.queue.get(req.params.id);
      if (!executionItem) {
        res.status(404).json(errorResponse("Work item not found", "NOT_FOUND"));
        return;
      }

      // Only execution items can have linked verification items
      if (executionItem.type !== 'execution') {
        res.status(400).json(errorResponse("Only execution items have linked verification items", "INVALID_TYPE"));
        return;
      }

      const verificationItem = await deps.queue.getVerificationForExecution(req.params.id);
      if (!verificationItem) {
        res.status(404).json(errorResponse("No verification item found for this execution", "NOT_FOUND"));
        return;
      }

      res.json(verificationItem);
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

      const result = await deps.conflicts.acquireLocks(req.params.id, req.body.repo, req.body.files);
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

      await deps.conflicts.releaseLocks(req.params.id, req.body.repo, req.body.files);
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

      await deps.workers.fail(
        req.params.id,
        req.body.error,
        req.body.iteration,
        req.body.stack,
        req.body.category,
        req.body.context
      );
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
   * GET /api/status - Overall whim status
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
   * GET /api/workers/:id/logs - Get worker container logs
   */
  app.get(
    "/api/workers/:id/logs",
    asyncHandler<IdParams>(async (req, res) => {
      const lines = req.query.lines ? parseInt(req.query.lines as string, 10) : 1000;
      const logs = await deps.workers.getLogs(req.params.id, lines);
      res.json({ workerId: req.params.id, logs });
    })
  );

  /**
   * GET /api/queue - Queue contents and stats
   * Supports optional filters:
   *   ?type=execution|verification - filter by work item type
   *   ?status=failed|completed|all - include non-active items (default shows active only)
   */
  app.get(
    "/api/queue",
    asyncHandler(async (req, res) => {
      // Validate type query parameter
      const typeParam = req.query.type as string | undefined;
      let type: WorkItemType | undefined;

      if (typeParam) {
        if (typeParam !== 'execution' && typeParam !== 'verification') {
          res.status(400).json({
            error: 'Invalid type parameter. Must be "execution" or "verification"'
          });
          return;
        }
        type = typeParam as WorkItemType;
      }

      // Validate status query parameter
      const statusParam = req.query.status as string | undefined;
      const validStatuses = ['failed', 'completed', 'all', 'generating'];
      if (statusParam && !validStatuses.includes(statusParam)) {
        res.status(400).json({
          error: `Invalid status parameter. Must be one of: ${validStatuses.join(', ')}`
        });
        return;
      }

      const [items, stats] = await Promise.all([
        deps.queue.list(type, statusParam as 'failed' | 'completed' | 'all' | 'generating' | undefined),
        deps.queue.getStats()
      ]);
      res.json({ items, stats });
    })
  );

  /**
   * GET /api/metrics - Whim metrics
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

  /**
   * GET /api/reviews/work-item/:id - Get reviews for a work item
   */
  app.get(
    "/api/reviews/work-item/:id",
    asyncHandler(async (req, res) => {
      const workItemId = req.params.id;
      if (!workItemId) {
        res.status(400).json(errorResponse("Work item ID required", "INVALID_INPUT"));
        return;
      }
      const reviews = await deps.db.getReviewsByWorkItem(workItemId);
      res.json(reviews);
    })
  );

  /**
   * GET /api/reviews/pr/:number - Get review for a PR
   */
  app.get(
    "/api/reviews/pr/:number",
    asyncHandler(async (req, res) => {
      const numberParam = req.params.number;
      if (!numberParam) {
        res.status(400).json(errorResponse("PR number required", "INVALID_INPUT"));
        return;
      }
      const prNumber = parseInt(numberParam, 10);
      if (isNaN(prNumber)) {
        res.status(400).json(errorResponse("Invalid PR number", "INVALID_INPUT"));
        return;
      }
      const review = await deps.db.getReviewByPR(prNumber);
      if (!review) {
        res.status(404).json(errorResponse("Review not found", "NOT_FOUND"));
        return;
      }
      res.json(review);
    })
  );

  /**
   * GET /api/reviews - List all reviews
   */
  app.get(
    "/api/reviews",
    asyncHandler(async (req, res) => {
      // Get all reviews by querying all work items and their reviews
      // This is a simple implementation; for large datasets, add pagination
      const reviews = await deps.db.query(
        "SELECT * FROM pr_reviews ORDER BY review_timestamp DESC LIMIT 100"
      );
      res.json(reviews);
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
