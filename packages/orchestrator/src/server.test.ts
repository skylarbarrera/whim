/**
 * Server API Tests
 */

import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import request from "supertest";
import { createServer, type ServerDependencies } from "./server.js";
import type { WorkItem, Worker, WhimMetrics, Learning } from "@whim/shared";

// Helper to create mock work item
function createWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "work-123",
    repo: "owner/repo",
    branch: "whim/work-123",
    spec: "# Test Spec",
    description: null,
    type: "execution",
    priority: "medium",
    status: "queued",
    workerId: null,
    iteration: 0,
    maxIterations: 10,
    retryCount: 0,
    nextRetryAt: null,
    prNumber: null,
    parentWorkItemId: null,
    verificationPassed: null,
    source: null,
    sourceRef: null,
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
      requeue: mock(() => Promise.resolve(createWorkItem({ status: "queued" }))),
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
      getSummary: mock((): Promise<WhimMetrics> =>
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

    db: {
      getReviewsByWorkItem: mock(() => Promise.resolve([])),
      getReviewByPR: mock(() => Promise.resolve(null)),
      query: mock(() => Promise.resolve([])),
    } as unknown as ServerDependencies["db"],

    specGenManager: {
      start: mock(() => {}),
      isGenerating: mock(() => false),
      getStatus: mock(() => ({ inProgress: false, attempt: 0 })),
      getInFlightCount: mock(() => 0),
      getInFlightIds: mock(() => []),
    } as unknown as ServerDependencies["specGenManager"],
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

    it("POST /api/work accepts description instead of spec", async () => {
      const deps = createMockDeps();
      (deps.queue.add as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve(createWorkItem({ status: "generating", spec: null, branch: null, description: "Add a feature" }))
      );
      const app = createServer(deps);

      const res = await request(app)
        .post("/api/work")
        .send({ repo: "owner/repo", description: "Add a feature" });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe("work-123");
      expect(res.body.status).toBe("generating");
      expect(deps.queue.add).toHaveBeenCalled();
    });

    it("POST /api/work rejects both spec and description", async () => {
      const app = createServer(createMockDeps());

      const res = await request(app)
        .post("/api/work")
        .send({ repo: "owner/repo", spec: "# Do something", description: "Add a feature" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid request body");
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("POST /api/work rejects neither spec nor description", async () => {
      const app = createServer(createMockDeps());

      const res = await request(app)
        .post("/api/work")
        .send({ repo: "owner/repo" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid request body");
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("POST /api/work accepts source and sourceRef", async () => {
      const deps = createMockDeps();
      const app = createServer(deps);

      const res = await request(app)
        .post("/api/work")
        .send({
          repo: "owner/repo",
          spec: "# Do something",
          source: "github",
          sourceRef: "issue:42"
        });

      expect(res.status).toBe(201);
      expect(deps.queue.add).toHaveBeenCalled();
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
        .send({ repo: "owner/repo", files: ["file1.ts", "file2.ts"] });

      expect(res.status).toBe(200);
      expect(res.body.acquired).toBe(true);
      expect(deps.conflicts.acquireLocks).toHaveBeenCalledWith("worker-123", "owner/repo", ["file1.ts", "file2.ts"]);
    });

    it("POST /api/worker/:id/lock returns blocked files", async () => {
      const deps = createMockDeps();
      (deps.conflicts.acquireLocks as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({ acquired: [], blocked: ["file1.ts"] })
      );
      const app = createServer(deps);

      const res = await request(app)
        .post("/api/worker/worker-123/lock")
        .send({ repo: "owner/repo", files: ["file1.ts"] });

      expect(res.status).toBe(200);
      expect(res.body.acquired).toBe(false);
      expect(res.body.blockedFiles).toEqual(["file1.ts"]);
    });

    it("POST /api/worker/:id/unlock releases locks", async () => {
      const deps = createMockDeps();
      const app = createServer(deps);

      const res = await request(app)
        .post("/api/worker/worker-123/unlock")
        .send({ repo: "owner/repo", files: ["file1.ts"] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(deps.conflicts.releaseLocks).toHaveBeenCalledWith("worker-123", "owner/repo", ["file1.ts"]);
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
    it("GET /api/status returns whim status", async () => {
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

    it("GET /api/queue?type=execution filters for execution items", async () => {
      const deps = createMockDeps();
      const executionItem = createWorkItem({ type: "execution" });
      (deps.queue.list as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve([executionItem]));
      const app = createServer(deps);

      const res = await request(app).get("/api/queue?type=execution");

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(deps.queue.list).toHaveBeenCalledWith("execution");
    });

    it("GET /api/queue?type=verification filters for verification items", async () => {
      const deps = createMockDeps();
      const verificationItem = createWorkItem({ type: "verification", prNumber: 42, parentWorkItemId: "parent-123" });
      (deps.queue.list as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve([verificationItem]));
      const app = createServer(deps);

      const res = await request(app).get("/api/queue?type=verification");

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].type).toBe("verification");
      expect(deps.queue.list).toHaveBeenCalledWith("verification");
    });

    it("GET /api/queue?type=invalid returns 400 error", async () => {
      const deps = createMockDeps();
      const app = createServer(deps);

      const res = await request(app).get("/api/queue?type=invalid");

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid type parameter");
    });

    it("POST /api/work/:id/requeue requeues failed work item", async () => {
      const deps = createMockDeps();
      const requeuedItem = createWorkItem({ status: "queued", error: null });
      (deps.queue.requeue as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve(requeuedItem));
      const app = createServer(deps);

      const res = await request(app).post("/api/work/work-123/requeue");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("queued");
      expect(deps.queue.requeue).toHaveBeenCalledWith("work-123");
    });

    it("POST /api/work/:id/requeue returns 404 for non-existent work item", async () => {
      const deps = createMockDeps();
      (deps.queue.requeue as ReturnType<typeof mock>).mockImplementation(() => {
        throw new Error("Work item not found: work-999");
      });
      const app = createServer(deps);

      const res = await request(app).post("/api/work/work-999/requeue");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("POST /api/work/:id/requeue returns 400 for non-requeueable status", async () => {
      const deps = createMockDeps();
      (deps.queue.requeue as ReturnType<typeof mock>).mockImplementation(() => {
        throw new Error("Cannot requeue work item with status: in_progress");
      });
      const app = createServer(deps);

      const res = await request(app).post("/api/work/work-123/requeue");

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_STATE");
    });

    it("GET /api/metrics returns whim metrics", async () => {
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
