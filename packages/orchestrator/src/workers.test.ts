/**
 * WorkerManager Tests
 * Uses mock dependencies to test worker lifecycle management
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { WorkerManager } from "./workers.js";
import type { Database } from "./db.js";
import type { RateLimiter } from "./rate-limits.js";
import type { ConflictDetector } from "./conflicts.js";
import type Docker from "dockerode";
import type { Worker, WorkItem, WorkerStatus } from "@whim/shared";

/**
 * Mock Database for testing worker operations
 */
class MockDatabase {
  workers: Map<string, Worker> = new Map();
  workItems: Map<string, WorkItem> = new Map();
  metrics: Array<Record<string, unknown>> = [];
  private idCounter = 0;

  async query<T>(text: string, values?: unknown[]): Promise<T[]> {
    // Handle SELECT workers with status filter for healthCheck
    if (text.includes("FROM workers") && text.includes("status IN")) {
      const results: Worker[] = [];
      const thresholdMatch = text.match(/INTERVAL '(\d+) seconds'/);
      const thresholdSeconds = thresholdMatch?.[1] ? parseInt(thresholdMatch[1], 10) : 60;
      const threshold = new Date(Date.now() - thresholdSeconds * 1000);

      for (const worker of this.workers.values()) {
        if (
          (worker.status === "starting" || worker.status === "running") &&
          worker.lastHeartbeat < threshold
        ) {
          results.push(worker);
        }
      }
      return results as T[];
    }

    // Handle SELECT all workers (list)
    if (text.includes("SELECT * FROM workers ORDER BY")) {
      return Array.from(this.workers.values()).sort(
        (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
      ) as T[];
    }

    // Handle GROUP BY status for stats
    if (text.includes("GROUP BY status")) {
      const counts = new Map<string, number>();
      for (const worker of this.workers.values()) {
        counts.set(worker.status, (counts.get(worker.status) ?? 0) + 1);
      }
      return Array.from(counts.entries()).map(([status, count]) => ({
        status,
        count: count.toString(),
      })) as T[];
    }

    return [];
  }

  async queryOne<T>(text: string, values?: unknown[]): Promise<T | null> {
    // Handle COUNT(*) for total
    if (text.includes("COUNT(*)") && text.includes("FROM workers")) {
      return { count: this.workers.size.toString() } as T;
    }

    // Handle AVG(iteration)
    if (text.includes("AVG(iteration)")) {
      let sum = 0;
      let count = 0;
      for (const worker of this.workers.values()) {
        if (worker.status === "completed") {
          sum += worker.iteration;
          count++;
        }
      }
      return { avg: count > 0 ? (sum / count).toString() : null } as T;
    }

    // Handle AVG(duration)
    if (text.includes("AVG(duration)")) {
      if (this.metrics.length === 0) return { avg: null } as T;
      const sum = this.metrics.reduce((acc, m) => acc + (m.duration as number), 0);
      return { avg: (sum / this.metrics.length).toString() } as T;
    }

    // Handle SELECT worker by work_item_id
    if (text.includes("work_item_id = $1") && values) {
      const workItemId = values[0] as string;
      for (const worker of this.workers.values()) {
        if (
          worker.workItemId === workItemId &&
          (worker.status === "starting" || worker.status === "running")
        ) {
          return worker as T;
        }
      }
      return null;
    }

    return null;
  }

  async execute(text: string, values?: unknown[]): Promise<{ rowCount: number }> {
    // Handle INSERT INTO workers
    if (text.includes("INSERT INTO workers") && values) {
      const id = values[0] as string;
      const workItemId = values[1] as string;
      const status = text.includes("'starting'") ? "starting" : "running";

      this.workers.set(id, {
        id,
        workItemId,
        status: status as WorkerStatus,
        iteration: 0,
        lastHeartbeat: new Date(),
        startedAt: new Date(),
        completedAt: null,
        containerId: null,
        error: null,
      });
      return { rowCount: 1 };
    }

    // Handle UPDATE workers SET container_id
    if (text.includes("UPDATE workers SET container_id") && values) {
      const containerId = values[0] as string;
      const id = values[1] as string;
      const worker = this.workers.get(id);
      if (worker) {
        worker.containerId = containerId;
      }
      return { rowCount: worker ? 1 : 0 };
    }

    // Handle UPDATE workers SET status = 'running'
    if (text.includes("UPDATE workers SET status = 'running'") && values) {
      const id = values[0] as string;
      const worker = this.workers.get(id);
      if (worker) {
        worker.status = "running";
        worker.lastHeartbeat = new Date();
      }
      return { rowCount: worker ? 1 : 0 };
    }

    // Handle UPDATE workers heartbeat
    if (text.includes("UPDATE workers") && text.includes("last_heartbeat = NOW()") && values) {
      const id = values[0] as string;
      const iteration = values[1] as number;
      const worker = this.workers.get(id);
      if (worker && (worker.status === "starting" || worker.status === "running")) {
        worker.lastHeartbeat = new Date();
        worker.iteration = iteration;
        worker.status = "running";
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    }

    // Handle UPDATE workers SET status = 'completed'
    if (text.includes("SET status = 'completed'") && values) {
      const id = values[0] as string;
      const worker = this.workers.get(id);
      if (worker) {
        worker.status = "completed";
        worker.completedAt = new Date();
      }
      return { rowCount: worker ? 1 : 0 };
    }

    // Handle UPDATE workers SET status = 'failed'
    if (text.includes("SET status = 'failed'") && text.includes("FROM workers") === false && values) {
      const id = values[0] as string;
      const worker = this.workers.get(id);
      if (worker) {
        worker.status = "failed";
        worker.completedAt = new Date();
        worker.error = values[1] as string;
        worker.iteration = values[2] as number;
      }
      return { rowCount: worker ? 1 : 0 };
    }

    // Handle UPDATE workers SET status = 'stuck'
    if (text.includes("SET status = 'stuck'") && values) {
      const id = values[0] as string;
      const worker = this.workers.get(id);
      if (worker) {
        worker.status = "stuck";
        worker.error = values[1] as string;
      }
      return { rowCount: worker ? 1 : 0 };
    }

    // Handle UPDATE workers SET status = 'killed'
    if (text.includes("SET status = 'killed'") && values) {
      const id = values[0] as string;
      const worker = this.workers.get(id);
      if (worker) {
        worker.status = "killed";
        worker.completedAt = new Date();
        worker.error = values[1] as string;
      }
      return { rowCount: worker ? 1 : 0 };
    }

    // Handle UPDATE work_items
    if (text.includes("UPDATE work_items") && values) {
      const id = values[0] as string;
      const workItem = this.workItems.get(id);
      if (workItem) {
        if (text.includes("status = 'in_progress'")) {
          workItem.status = "in_progress";
          workItem.workerId = values[0] as string;
        }
        if (text.includes("status = 'completed'")) {
          workItem.status = "completed";
          workItem.completedAt = new Date();
          workItem.prUrl = values[1] as string | null;
        }
        if (text.includes("status = 'failed'")) {
          workItem.status = "failed";
          workItem.error = values[1] as string;
        }
        if (text.includes("status = 'queued'")) {
          workItem.status = "queued";
          workItem.workerId = null;
        }
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    }

    // Handle INSERT INTO worker_metrics
    if (text.includes("INSERT INTO worker_metrics") && values) {
      this.metrics.push({
        workerId: values[0],
        workItemId: values[1],
        iteration: values[2],
        tokensIn: values[3],
        tokensOut: values[4],
        duration: values[5],
        filesModified: values[6],
        testsRun: values[7],
        testsPassed: values[8],
      });
      return { rowCount: 1 };
    }

    return { rowCount: 0 };
  }

  async getWorker(id: string): Promise<Worker | null> {
    return this.workers.get(id) ?? null;
  }

  async getWorkItem(id: string): Promise<WorkItem | null> {
    return this.workItems.get(id) ?? null;
  }

  // Test helpers
  _setWorker(worker: Worker): void {
    this.workers.set(worker.id, worker);
  }

  _setWorkItem(workItem: WorkItem): void {
    this.workItems.set(workItem.id, workItem);
  }

  _clear(): void {
    this.workers.clear();
    this.workItems.clear();
    this.metrics = [];
  }
}

/**
 * Mock RateLimiter
 */
class MockRateLimiter {
  private _canSpawn = true;
  spawns = 0;
  workersDone = 0;
  iterations = 0;

  async canSpawnWorker(): Promise<boolean> {
    return this._canSpawn;
  }

  async recordSpawn(): Promise<void> {
    this.spawns++;
  }

  async recordWorkerDone(): Promise<void> {
    this.workersDone++;
  }

  async recordIteration(): Promise<void> {
    this.iterations++;
  }

  _setCanSpawn(value: boolean): void {
    this._canSpawn = value;
  }
}

/**
 * Mock ConflictDetector
 */
class MockConflictDetector {
  releasedAll: string[] = [];

  async releaseAllLocks(workerId: string): Promise<void> {
    this.releasedAll.push(workerId);
  }
}

/**
 * Mock Docker
 */
class MockDocker {
  containers: Map<string, { stopped: boolean }> = new Map();
  private idCounter = 0;

  async createContainer(options: unknown): Promise<{
    id: string;
    start: () => Promise<void>;
  }> {
    this.idCounter++;
    const id = `container-${this.idCounter}`;
    this.containers.set(id, { stopped: false });
    return {
      id,
      start: async () => {},
    };
  }

  getContainer(id: string): { stop: (options?: { t: number }) => Promise<void> } {
    return {
      stop: async () => {
        const container = this.containers.get(id);
        if (container) {
          container.stopped = true;
        }
      },
    };
  }
}

// Test fixtures
const createWorkItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: "work-item-1",
  repo: "owner/repo",
  branch: "whim/abc123",
  spec: "# Test Spec",
  priority: "medium",
  status: "queued",
  workerId: null,
  iteration: 0,
  maxIterations: 10,
  retryCount: 0,
  nextRetryAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null,
  error: null,
  prUrl: null,
  metadata: {},
  ...overrides,
});

const createWorker = (overrides: Partial<Worker> = {}): Worker => ({
  id: "worker-1",
  workItemId: "work-item-1",
  status: "running",
  iteration: 1,
  lastHeartbeat: new Date(),
  startedAt: new Date(),
  completedAt: null,
  containerId: "container-1",
  error: null,
  ...overrides,
});

describe("WorkerManager", () => {
  let mockDb: MockDatabase;
  let mockRateLimiter: MockRateLimiter;
  let mockConflictDetector: MockConflictDetector;
  let mockDocker: MockDocker;
  let manager: WorkerManager;

  beforeEach(() => {
    mockDb = new MockDatabase();
    mockRateLimiter = new MockRateLimiter();
    mockConflictDetector = new MockConflictDetector();
    mockDocker = new MockDocker();

    manager = new WorkerManager(
      mockDb as unknown as Database,
      mockRateLimiter as unknown as RateLimiter,
      mockConflictDetector as unknown as ConflictDetector,
      mockDocker as unknown as Docker,
      { staleThresholdSeconds: 60 }
    );
  });

  describe("hasCapacity", () => {
    test("returns true when rate limiter allows", async () => {
      mockRateLimiter._setCanSpawn(true);
      expect(await manager.hasCapacity()).toBe(true);
    });

    test("returns false when rate limiter denies", async () => {
      mockRateLimiter._setCanSpawn(false);
      expect(await manager.hasCapacity()).toBe(false);
    });
  });

  describe("spawn", () => {
    test("creates worker and spawns container", async () => {
      const workItem = createWorkItem();
      mockDb._setWorkItem(workItem);

      const result = await manager.spawn(workItem);

      expect(result.workerId).toBeDefined();
      expect(result.containerId).toBeDefined();
      expect(mockRateLimiter.spawns).toBe(1);
    });

    test("updates worker with container ID", async () => {
      const workItem = createWorkItem();
      mockDb._setWorkItem(workItem);

      const result = await manager.spawn(workItem);

      const worker = await mockDb.getWorker(result.workerId);
      expect(worker?.containerId).toBe(result.containerId);
    });
  });

  describe("register", () => {
    test("creates new worker for work item", async () => {
      const workItem = createWorkItem();
      mockDb._setWorkItem(workItem);

      const result = await manager.register(workItem.id);

      expect(result.worker).toBeDefined();
      expect(result.worker.status).toBe("running");
      expect(result.workItem.id).toBe(workItem.id);
    });

    test("reuses existing worker if found", async () => {
      const workItem = createWorkItem();
      const existingWorker = createWorker({
        status: "starting",
        workItemId: workItem.id,
      });
      mockDb._setWorkItem(workItem);
      mockDb._setWorker(existingWorker);

      const result = await manager.register(workItem.id);

      expect(result.worker.id).toBe(existingWorker.id);
      expect(result.worker.status).toBe("running");
    });

    test("throws if work item not found", async () => {
      await expect(manager.register("nonexistent")).rejects.toThrow(
        "work item not found"
      );
    });
  });

  describe("heartbeat", () => {
    test("updates worker heartbeat and iteration", async () => {
      const worker = createWorker({ status: "running" });
      mockDb._setWorker(worker);

      await manager.heartbeat(worker.id, { iteration: 5 });

      const updated = await mockDb.getWorker(worker.id);
      expect(updated?.iteration).toBe(5);
      expect(mockRateLimiter.iterations).toBe(1);
    });

    test("throws for inactive worker", async () => {
      const worker = createWorker({ status: "completed" });
      mockDb._setWorker(worker);

      await expect(
        manager.heartbeat(worker.id, { iteration: 1 })
      ).rejects.toThrow("Worker not found or not active");
    });

    test("throws for unknown worker", async () => {
      await expect(
        manager.heartbeat("unknown", { iteration: 1 })
      ).rejects.toThrow("Worker not found or not active");
    });
  });

  describe("complete", () => {
    test("updates worker and work item status", async () => {
      const workItem = createWorkItem({ status: "in_progress" });
      const worker = createWorker({ workItemId: workItem.id });
      mockDb._setWorkItem(workItem);
      mockDb._setWorker(worker);

      await manager.complete(worker.id, { prUrl: "https://github.com/pr/1" });

      const updatedWorker = await mockDb.getWorker(worker.id);
      expect(updatedWorker?.status).toBe("completed");
      expect(mockConflictDetector.releasedAll).toContain(worker.id);
      expect(mockRateLimiter.workersDone).toBe(1);
    });

    test("records metrics if provided", async () => {
      const workItem = createWorkItem({ status: "in_progress" });
      const worker = createWorker({ workItemId: workItem.id });
      mockDb._setWorkItem(workItem);
      mockDb._setWorker(worker);

      await manager.complete(worker.id, {
        metrics: {
          tokensIn: 1000,
          tokensOut: 500,
          duration: 60000,
          filesModified: 5,
          testsRun: 10,
          testsPassed: 10,
          testsFailed: 0,
          testStatus: "passed",
        },
      });

      expect(mockDb.metrics).toHaveLength(1);
      expect(mockDb.metrics[0]!.tokensIn).toBe(1000);
    });

    test("throws for unknown worker", async () => {
      await expect(manager.complete("unknown", {})).rejects.toThrow(
        "Worker not found"
      );
    });
  });

  describe("fail", () => {
    test("updates worker and work item with error", async () => {
      const workItem = createWorkItem({ status: "in_progress" });
      const worker = createWorker({ workItemId: workItem.id });
      mockDb._setWorkItem(workItem);
      mockDb._setWorker(worker);

      await manager.fail(worker.id, "Build failed", 3);

      const updatedWorker = await mockDb.getWorker(worker.id);
      expect(updatedWorker?.status).toBe("failed");
      expect(updatedWorker?.error).toBe("Build failed");
      expect(updatedWorker?.iteration).toBe(3);
      expect(mockConflictDetector.releasedAll).toContain(worker.id);
      expect(mockRateLimiter.workersDone).toBe(1);
    });

    test("throws for unknown worker", async () => {
      await expect(manager.fail("unknown", "error", 1)).rejects.toThrow(
        "Worker not found"
      );
    });
  });

  describe("stuck", () => {
    test("updates worker status to stuck", async () => {
      const workItem = createWorkItem({ status: "in_progress" });
      const worker = createWorker({ workItemId: workItem.id });
      mockDb._setWorkItem(workItem);
      mockDb._setWorker(worker);

      await manager.stuck(worker.id, "Cannot resolve conflict", 5);

      const updatedWorker = await mockDb.getWorker(worker.id);
      expect(updatedWorker?.status).toBe("stuck");
      expect(updatedWorker?.error).toContain("Cannot resolve conflict");
    });

    test("throws for unknown worker", async () => {
      await expect(
        manager.stuck("unknown", "reason", 1)
      ).rejects.toThrow("Worker not found");
    });
  });

  describe("healthCheck", () => {
    test("returns stale workers", async () => {
      const staleTime = new Date(Date.now() - 120000); // 2 minutes ago
      const freshTime = new Date();

      mockDb._setWorker(
        createWorker({
          id: "stale-worker",
          status: "running",
          lastHeartbeat: staleTime,
        })
      );
      mockDb._setWorker(
        createWorker({
          id: "fresh-worker",
          status: "running",
          lastHeartbeat: freshTime,
        })
      );
      mockDb._setWorker(
        createWorker({
          id: "completed-worker",
          status: "completed",
          lastHeartbeat: staleTime,
        })
      );

      const staleWorkers = await manager.healthCheck();

      expect(staleWorkers).toHaveLength(1);
      expect(staleWorkers[0]!.id).toBe("stale-worker");
    });

    test("returns empty array when no stale workers", async () => {
      mockDb._setWorker(
        createWorker({
          status: "running",
          lastHeartbeat: new Date(),
        })
      );

      const staleWorkers = await manager.healthCheck();

      expect(staleWorkers).toHaveLength(0);
    });
  });

  describe("kill", () => {
    test("stops container and updates status", async () => {
      const workItem = createWorkItem({
        status: "in_progress",
        iteration: 1,
        maxIterations: 10,
      });
      const worker = createWorker({
        workItemId: workItem.id,
        containerId: "container-1",
      });
      mockDb._setWorkItem(workItem);
      mockDb._setWorker(worker);
      mockDocker.containers.set("container-1", { stopped: false });

      await manager.kill(worker.id, "Stale worker");

      const updatedWorker = await mockDb.getWorker(worker.id);
      expect(updatedWorker?.status).toBe("killed");
      expect(mockConflictDetector.releasedAll).toContain(worker.id);
      expect(mockRateLimiter.workersDone).toBe(1);
    });

    test("handles missing container gracefully", async () => {
      const workItem = createWorkItem({ status: "in_progress" });
      const worker = createWorker({
        workItemId: workItem.id,
        containerId: null,
      });
      mockDb._setWorkItem(workItem);
      mockDb._setWorker(worker);

      // Should not throw
      await manager.kill(worker.id, "No container");

      const updatedWorker = await mockDb.getWorker(worker.id);
      expect(updatedWorker?.status).toBe("killed");
    });

    test("throws for unknown worker", async () => {
      await expect(manager.kill("unknown", "reason")).rejects.toThrow(
        "Worker not found"
      );
    });
  });

  describe("list", () => {
    test("returns all workers ordered by started_at", async () => {
      const older = createWorker({
        id: "older",
        startedAt: new Date(Date.now() - 60000),
      });
      const newer = createWorker({
        id: "newer",
        startedAt: new Date(),
      });
      mockDb._setWorker(older);
      mockDb._setWorker(newer);

      const workers = await manager.list();

      expect(workers).toHaveLength(2);
      expect(workers[0]!.id).toBe("newer");
      expect(workers[1]!.id).toBe("older");
    });

    test("returns empty array when no workers", async () => {
      const workers = await manager.list();
      expect(workers).toEqual([]);
    });
  });

  describe("getStats", () => {
    test("returns correct statistics", async () => {
      mockDb._setWorker(createWorker({ id: "w1", status: "running" }));
      mockDb._setWorker(
        createWorker({ id: "w2", status: "completed", iteration: 5 })
      );
      mockDb._setWorker(
        createWorker({ id: "w3", status: "completed", iteration: 3 })
      );
      mockDb._setWorker(createWorker({ id: "w4", status: "failed" }));
      mockDb.metrics.push({ duration: 1000 }, { duration: 2000 });

      const stats = await manager.getStats();

      expect(stats.total).toBe(4);
      expect(stats.byStatus.running).toBe(1);
      expect(stats.byStatus.completed).toBe(2);
      expect(stats.byStatus.failed).toBe(1);
      expect(stats.avgIterations).toBe(4); // (5 + 3) / 2
      expect(stats.avgDuration).toBe(1500); // (1000 + 2000) / 2
    });

    test("handles empty stats", async () => {
      const stats = await manager.getStats();

      expect(stats.total).toBe(0);
      expect(stats.avgIterations).toBe(0);
      expect(stats.avgDuration).toBe(0);
    });
  });
});
