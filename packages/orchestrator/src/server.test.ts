/**
 * Server API Tests
 */

import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import request from "supertest";
import { createServer, type ServerDependencies } from "./server.js";
import type { WorkItem, Worker, FactoryMetrics, Learning } from "@factory/shared";

// Helper to create mock work item
function createWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "work-123",
    repo: "owner/repo",
    branch: "factory/work-123",
    spec: "# Test Spec",
    priority: "medium",
    status: "queued",
    workerId: null,
    iteration: 0,
    maxIterations: 10,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    completedAt: null,
    error: null,
    prUrl: null,
    metadata: {},
    ...overrides,
  };
}

// Helper to create mock worker
function createWorker(overrides: Partial<Worker> = {}): Worker {
  return {
    id: "worker-123",
    workItemId: "work-123",
    status: "running",
    iteration: 1,
    lastHeartbeat: new Date("2024-01-01"),
    startedAt: new Date("2024-01-01"),
    completedAt: null,
    containerId: "container-123",
    error: null,
    ...overrides,
  };
}

// Create mock dependencies
function createMockDeps(): ServerDependencies {
  return {
    queue: {
      add: mock(() => Promise.resolve(createWorkItem())),
      get: mock(() => Promise.resolve(createWorkItem())),
      cancel: mock(() => Promise.resolve(true)),
      list: mock(() => Promise.resolve([createWorkItem()])),
      getStats: mock(() =>
        Promise.resolve({
          total: 1,
          byStatus: { queued: 1, assigned: 0, in_progress: 0, completed: 0, failed: 0, cancelled: 0 },
          byPriority: { low: 0, medium: 1, high: 0, critical: 0 },
        })
      ),
    } as unknown as ServerDependencies["queue"],

    workers: {
      register: mock(() =>
        Promise.resolve({
          worker: createWorker(),
          workItem: createWorkItem({ status: "in_progress", workerId: "worker-123" }),
        })
      ),
      heartbeat: mock(() => Promise.resolve()),
      complete: mock(() => Promise.resolve()),
      fail: mock(() => Promise.resolve()),
      stuck: mock(() => Promise.resolve()),
      list: mock(() => Promise.resolve([createWorker()])),
      kill: mock(() => Promise.resolve()),
    } as unknown as ServerDependencies["workers"],

    conflicts: {
      acquireLocks: mock(() => Promise.resolve({ acquired: ["file.ts"], blocked: [] })),
      releaseLocks: mock(() => Promise.resolve()),
    } as unknown as ServerDependencies["conflicts"],

    rateLimiter: {
      getStatus: mock(() =>
        Promise.resolve({
          iterationsToday: 10,
          dailyBudget: 200,
          lastSpawn: new Date("2024-01-01"),
          cooldownSeconds: 60,
          activeWorkers: 1,
          maxWorkers: 2,
          canSpawn: true,
        })
      ),
    } as unknown as ServerDependencies["rateLimiter"],

    metrics: {
      getSummary: mock((): Promise<FactoryMetrics> =>
        Promise.resolve({
          activeWorkers: 1,
          queuedItems: 5,
          completedToday: 10,
          failedToday: 2,
          iterationsToday: 50,
          dailyBudget: 200,
          avgCompletionTime: 30000,
          successRate: 0.83,
        })
      ),
      getLearnings: mock((): Promise<Learning[]> =>
        Promise.resolve([
          {
            id: "learning-1",
            repo: "owner/repo",
            spec: "Test spec",
            content: "Learned something",
            embedding: null,
            createdAt: new Date("2024-01-01"),
            workItemId: "work-123",
          },
        ])
      ),
    } as unknown as ServerDependencies["metrics"],
  };
}

describe("Server", () => {
  describe("Health Check", () => {
    it("GET /health returns ok", async () => {
      const app = createServer(createMockDeps());
      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok" });
    });
  });

  describe("Work Item Routes", () => {
    it("POST /api/work creates work item", async () => {
      const deps = createMockDeps();
      const app = createServer(deps);

      const res = await request(app)
        .post("/api/work")
        .send({ repo: "owner/repo", spec: "# Do something" });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe("work-123");
      expect(res.body.status).toBe("queued");
      expect(deps.queue.add).toHaveBeenCalled();
    });

    it("POST /api/work validates request body", async () => {
      const app = createServer(createMockDeps());

      const res = await request(app).post("/api/work").send({ repo: "" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid request body");
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("GET /api/work/:id returns work item", async () => {
      const deps = createMockDeps();
      const app = createServer(deps);

      const res = await request(app).get("/api/work/work-123");

      expect(res.status).toBe(200);
      expect(res.body.id).toBe("work-123");
      expect(deps.queue.get).toHaveBeenCalledWith("work-123");
    });

    it("GET /api/work/:id returns 404 for missing item", async () => {
      const deps = createMockDeps();
      (deps.queue.get as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve(null));
      const app = createServer(deps);

      const res = await request(app).get("/api/work/missing");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("POST /api/work/:id/cancel cancels work item", async () => {
      const deps = createMockDeps();
      const app = createServer(deps);

      const res = await request(app).post("/api/work/work-123/cancel");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(deps.queue.cancel).toHaveBeenCalledWith("work-123");
    });

    it("POST /api/work/:id/cancel returns 400 for non-cancellable item", async () => {
      const deps = createMockDeps();
      (deps.queue.cancel as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve(false));
      const app = createServer(deps);

      const res = await request(app).post("/api/work/work-123/cancel");

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_STATE");
    });
  });

  describe("Worker Routes", () => {
    it("POST /api/worker/register registers worker", async () => {
      const deps = createMockDeps();
      const app = createServer(deps);

      const res = await request(app)
        .post("/api/worker/register")
        .send({ workItemId: "work-123" });

      expect(res.status).toBe(201);
      expect(res.body.workerId).toBe("worker-123");
      expect(res.body.workItem).toBeDefined();
      expect(deps.workers.register).toHaveBeenCalledWith("work-123");
    });

    it("POST /api/worker/:id/heartbeat updates heartbeat", async () => {
      const deps = createMockDeps();
      const app = createServer(deps);

      const res = await request(app)
        .post("/api/worker/worker-123/heartbeat")
        .send({ iteration: 3 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(deps.workers.heartbeat).toHaveBeenCalledWith("worker-123", { iteration: 3 });
    });

    it("POST /api/worker/:id/lock acquires locks", async () => {
      const deps = createMockDeps();
      const app = createServer(deps);

      const res = await request(app)
        .post("/api/worker/worker-123/lock")
        .send({ files: ["file1.ts", "file2.ts"] });

      expect(res.status).toBe(200);
      expect(res.body.acquired).toBe(true);
      expect(deps.conflicts.acquireLocks).toHaveBeenCalledWith("worker-123", ["file1.ts", "file2.ts"]);
    });

    it("POST /api/worker/:id/lock returns blocked files", async () => {
      const deps = createMockDeps();
      (deps.conflicts.acquireLocks as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({ acquired: [], blocked: ["file1.ts"] })
      );
      const app = createServer(deps);

      const res = await request(app)
        .post("/api/worker/worker-123/lock")
        .send({ files: ["file1.ts"] });

      expect(res.status).toBe(200);
      expect(res.body.acquired).toBe(false);
      expect(res.body.blockedFiles).toEqual(["file1.ts"]);
    });

    it("POST /api/worker/:id/unlock releases locks", async () => {
      const deps = createMockDeps();
      const app = createServer(deps);

      const res = await request(app)
        .post("/api/worker/worker-123/unlock")
        .send({ files: ["file1.ts"] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(deps.conflicts.releaseLocks).toHaveBeenCalledWith("worker-123", ["file1.ts"]);
    });

    it("POST /api/worker/:id/complete marks worker complete", async () => {
      const deps = createMockDeps();
      const app = createServer(deps);

      const res = await request(app)
        .post("/api/worker/worker-123/complete")
        .send({ prUrl: "https://github.com/owner/repo/pull/1" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(deps.workers.complete).toHaveBeenCalled();
    });

    it("POST /api/worker/:id/fail marks worker failed", async () => {
      const deps = createMockDeps();
      const app = createServer(deps);

      const res = await request(app)
        .post("/api/worker/worker-123/fail")
        .send({ error: "Something went wrong", iteration: 5 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(deps.workers.fail).toHaveBeenCalledWith("worker-123", "Something went wrong", 5);
    });

    it("POST /api/worker/:id/stuck marks worker stuck", async () => {
      const deps = createMockDeps();
      const app = createServer(deps);

      const res = await request(app)
        .post("/api/worker/worker-123/stuck")
        .send({ reason: "Tests keep failing", attempts: 3 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(deps.workers.stuck).toHaveBeenCalledWith("worker-123", "Tests keep failing", 3);
    });
  });

  describe("Management Routes", () => {
    it("GET /api/status returns factory status", async () => {
      const deps = createMockDeps();
      const app = createServer(deps);

      const res = await request(app).get("/api/status");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("healthy");
      expect(res.body.workers.active).toBe(1);
      expect(res.body.workers.maxWorkers).toBe(2);
      expect(res.body.rateLimits.dailyBudget).toBe(200);
    });

    it("GET /api/workers lists workers", async () => {
      const deps = createMockDeps();
      const app = createServer(deps);

      const res = await request(app).get("/api/workers");

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].id).toBe("worker-123");
    });

    it("POST /api/workers/:id/kill kills worker", async () => {
      const deps = createMockDeps();
      const app = createServer(deps);

      const res = await request(app)
        .post("/api/workers/worker-123/kill")
        .send({ reason: "Testing kill" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(deps.workers.kill).toHaveBeenCalledWith("worker-123", "Testing kill");
    });

    it("GET /api/queue returns queue items and stats", async () => {
      const deps = createMockDeps();
      const app = createServer(deps);

      const res = await request(app).get("/api/queue");

      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();
      expect(res.body.stats).toBeDefined();
      expect(res.body.stats.total).toBe(1);
    });

    it("GET /api/metrics returns factory metrics", async () => {
      const deps = createMockDeps();
      const app = createServer(deps);

      const res = await request(app).get("/api/metrics");

      expect(res.status).toBe(200);
      expect(res.body.activeWorkers).toBe(1);
      expect(res.body.successRate).toBe(0.83);
    });

    it("GET /api/learnings returns learnings", async () => {
      const deps = createMockDeps();
      const app = createServer(deps);

      const res = await request(app).get("/api/learnings");

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].content).toBe("Learned something");
    });

    it("GET /api/learnings accepts query params", async () => {
      const deps = createMockDeps();
      const app = createServer(deps);

      const res = await request(app)
        .get("/api/learnings")
        .query({ repo: "owner/repo", limit: 10 });

      expect(res.status).toBe(200);
      expect(deps.metrics.getLearnings).toHaveBeenCalledWith({
        repo: "owner/repo",
        limit: 10,
      });
    });
  });

  describe("Error Handling", () => {
    it("returns 404 for unknown routes", async () => {
      const app = createServer(createMockDeps());

      const res = await request(app).get("/api/unknown");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("returns 500 for internal errors", async () => {
      const deps = createMockDeps();
      (deps.queue.get as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.reject(new Error("Database error"))
      );
      const app = createServer(deps);

      const res = await request(app).get("/api/work/work-123");

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_ERROR");
      expect(res.body.error).toBe("Database error");
    });
  });
});
