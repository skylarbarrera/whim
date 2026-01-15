/**
 * @whim/orchestrator
 *
 * Main entry point for the Whim Orchestrator service.
 * Manages work queue, worker lifecycle, and API endpoints.
 */

// Re-export spec generation for use by other services
export * from "./spec-gen.js";

import Docker from "dockerode";
import { createDatabase, type Database } from "./db.js";
import { createRedisClient, type RedisClient } from "./redis.js";
import { QueueManager } from "./queue.js";
import { RateLimiter } from "./rate-limits.js";
import { ConflictDetector } from "./conflicts.js";
import { WorkerManager } from "./workers.js";
import { MetricsCollector } from "./metrics.js";
import { createServer } from "./server.js";

/**
 * Configuration loaded from environment variables
 */
interface OrchestratorConfig {
  /** HTTP server port */
  port: number;
  /** Main loop interval in milliseconds */
  loopIntervalMs: number;
  /** Enable verbose logging */
  verbose: boolean;
}

/**
 * Load configuration from environment variables
 */
function loadConfig(): OrchestratorConfig {
  return {
    port: parseInt(process.env.PORT ?? "3000", 10),
    loopIntervalMs: parseInt(process.env.LOOP_INTERVAL_MS ?? "5000", 10),
    verbose: process.env.VERBOSE === "true",
  };
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Logger with timestamp
 */
function log(message: string, ...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, ...args);
}

/**
 * Run the main orchestrator loop
 *
 * This loop runs continuously and:
 * 1. Checks for stale workers and kills them
 * 2. Spawns new workers for queued items when capacity is available
 */
async function runMainLoop(
  queue: QueueManager,
  workers: WorkerManager,
  config: OrchestratorConfig
): Promise<void> {
  log("Starting main loop");

  while (true) {
    try {
      log("Loop iteration starting...");
      // 1. Health check: find and kill stale workers
      const staleWorkers = await workers.healthCheck();
      log(`Health check done, ${staleWorkers.length} stale workers`);
      for (const staleWorker of staleWorkers) {
        log(`Killing stale worker: ${staleWorker.id}`);
        await workers.kill(staleWorker.id, "heartbeat timeout");
      }

      // 2. Spawn workers for queued items when capacity is available
      // Re-check capacity before each spawn to respect rate limits
      while (await workers.hasCapacity()) {
        const workItem = await queue.getNext();
        if (!workItem) {
          // No more queued items
          log("No queued items, waiting...");
          break;
        }

        log(`Spawning worker for work item: ${workItem.id} (${workItem.repo})`);
        const { workerId, containerId } = await workers.spawn(workItem);
        log(`Spawned worker ${workerId} in container ${containerId.slice(0, 12)}`);
      }
    } catch (error) {
      log("Error in main loop:", error);
    }

    // 3. Sleep before next iteration
    await sleep(config.loopIntervalMs);
  }
}

/**
 * Graceful shutdown handler
 */
function setupGracefulShutdown(
  db: Database,
  redis: RedisClient,
  httpServer: { close: (cb: () => void) => void }
): void {
  const shutdown = async (signal: string) => {
    log(`Received ${signal}, shutting down gracefully...`);

    // Close HTTP server
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    log("HTTP server closed");

    // Close database connection
    await db.disconnect();
    log("Database disconnected");

    // Close Redis connection
    await redis.disconnect();
    log("Redis disconnected");

    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const config = loadConfig();

  log("Starting Whim Orchestrator...");
  log(`Configuration: port=${config.port}, loopInterval=${config.loopIntervalMs}ms`);

  // Initialize database client
  log("Connecting to PostgreSQL...");
  const db = createDatabase();
  await db.connect();
  log("PostgreSQL connected");

  // Initialize Redis client
  log("Connecting to Redis...");
  const redis = createRedisClient();
  await redis.connect();
  log("Redis connected");

  // Initialize Docker client
  const docker = new Docker();

  // Initialize components
  const queue = new QueueManager(db);
  const rateLimiter = new RateLimiter(redis, {
    // Use DB as source of truth for active worker count (prevents counter drift)
    getActiveWorkerCount: async () => {
      const result = await db.queryOne<{ count: string }>(
        `SELECT COUNT(*) as count FROM workers WHERE status IN ('starting', 'running')`
      );
      return parseInt(result?.count ?? "0", 10);
    },
  });
  const conflicts = new ConflictDetector(db);
  const workers = new WorkerManager(db, rateLimiter, conflicts, docker);
  const metrics = new MetricsCollector(db);

  // Create Express server
  const app = createServer({
    queue,
    workers,
    conflicts,
    rateLimiter,
    metrics,
    db,
  });

  // Start HTTP server
  const server = app.listen(config.port, () => {
    log(`HTTP server listening on port ${config.port}`);
  });

  // Handle server errors
  server.on("error", (error) => {
    log("HTTP server error:", error);
    process.exit(1);
  });

  // Setup graceful shutdown (after server is created)
  setupGracefulShutdown(db, redis, server);

  // Start the main orchestrator loop (runs forever)
  await runMainLoop(queue, workers, config);
}

// Run the main function
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
