/**
 * MetricsCollector Tests
 * Uses mock database to test metrics collection and aggregation
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { MetricsCollector } from "./metrics.js";
import type { Database } from "./db.js";
import type { WorkerMetrics, Learning } from "@factory/shared";

/**
 * Mock Database for testing metrics operations
 */
class MockDatabase {
  workers: Array<{ status: string; iteration: number }> = [];
  workItems: Array<{
    status: string;
    completedAt: Date | null;
    updatedAt: Date;
  }> = [];
  metrics: WorkerMetrics[] = [];
  learnings: Array<Learning> = [];

  async query<T>(text: string, values?: unknown[]): Promise<T[]> {
    // Handle worker_metrics SELECT
    if (text.includes("FROM worker_metrics") && text.includes("ORDER BY timestamp")) {
      return this.metrics as T[];
    }

    // Handle learnings SELECT
    if (text.includes("FROM learnings")) {
      let filtered = [...this.learnings];

      // Apply repo filter
      if (values && text.includes("repo = $")) {
        const repoIndex = text.indexOf("repo = $");
        const paramNum = parseInt(text[repoIndex + 8]!, 10);
        const repo = values[paramNum - 1] as string;
        filtered = filtered.filter((l) => l.repo === repo);
      }

      // Apply spec filter
      if (values && text.includes("spec ILIKE")) {
        const specIndex = text.indexOf("spec ILIKE $");
        const paramNum = parseInt(text[specIndex + 12]!, 10);
        const spec = (values[paramNum - 1] as string).replace(/%/g, "");
        filtered = filtered.filter((l) =>
          l.spec.toLowerCase().includes(spec.toLowerCase())
        );
      }

      // Apply limit
      const limitMatch = text.match(/LIMIT (\d+)/);
      if (limitMatch) {
        filtered = filtered.slice(0, parseInt(limitMatch[1]!, 10));
      }

      return filtered as T[];
    }

    return [];
  }

  async queryOne<T>(text: string, values?: unknown[]): Promise<T | null> {
    // Handle COUNT(*) for active workers
    if (text.includes("COUNT(*)") && text.includes("FROM workers") && text.includes("starting")) {
      const count = this.workers.filter(
        (w) => w.status === "starting" || w.status === "running"
      ).length;
      return { count: count.toString() } as T;
    }

    // Handle COUNT(*) for queued work items
    if (text.includes("COUNT(*)") && text.includes("FROM work_items") && text.includes("queued")) {
      const count = this.workItems.filter((w) => w.status === "queued").length;
      return { count: count.toString() } as T;
    }

    // Handle COUNT(*) for completed today
    if (text.includes("COUNT(*)") && text.includes("completed") && text.includes("CURRENT_DATE")) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const count = this.workItems.filter(
        (w) => w.status === "completed" && w.completedAt && w.completedAt >= today
      ).length;
      return { count: count.toString() } as T;
    }

    // Handle COUNT(*) for failed today
    if (text.includes("COUNT(*)") && text.includes("failed") && text.includes("CURRENT_DATE")) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const count = this.workItems.filter(
        (w) => w.status === "failed" && w.updatedAt >= today
      ).length;
      return { count: count.toString() } as T;
    }

    // Handle COUNT(*) for total completed
    if (text.includes("COUNT(*)") && text.includes("completed") && !text.includes("CURRENT_DATE")) {
      const count = this.workItems.filter((w) => w.status === "completed").length;
      return { count: count.toString() } as T;
    }

    // Handle COUNT(*) for total failed
    if (text.includes("COUNT(*)") && text.includes("failed") && !text.includes("CURRENT_DATE")) {
      const count = this.workItems.filter((w) => w.status === "failed").length;
      return { count: count.toString() } as T;
    }

    // Handle SUM(iteration) for iterations today
    if (text.includes("SUM(iteration)")) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const sum = this.metrics
        .filter((m) => m.timestamp >= today)
        .reduce((acc, m) => acc + m.iteration, 0);
      return { sum: sum.toString() } as T;
    }

    // Handle AVG(duration)
    if (text.includes("AVG(duration)")) {
      if (this.metrics.length === 0) {
        return { avg: null } as T;
      }
      const avg =
        this.metrics.reduce((acc, m) => acc + m.duration, 0) / this.metrics.length;
      return { avg: avg.toString() } as T;
    }

    return null;
  }

  // Test helpers
  _addWorker(status: string, iteration: number = 0): void {
    this.workers.push({ status, iteration });
  }

  _addWorkItem(
    status: string,
    completedAt: Date | null = null,
    updatedAt: Date = new Date()
  ): void {
    this.workItems.push({ status, completedAt, updatedAt });
  }

  _addMetrics(metrics: Partial<WorkerMetrics>): void {
    this.metrics.push({
      id: `metric-${this.metrics.length + 1}`,
      workerId: "worker-1",
      workItemId: "work-item-1",
      iteration: 1,
      tokensIn: 1000,
      tokensOut: 500,
      duration: 60000,
      filesModified: 5,
      testsRun: 10,
      testsPassed: 10,
      timestamp: new Date(),
      ...metrics,
    });
  }

  _addLearning(learning: Partial<Learning>): void {
    this.learnings.push({
      id: `learning-${this.learnings.length + 1}`,
      repo: "owner/repo",
      spec: "# Test Spec",
      content: "Test learning content",
      embedding: null,
      createdAt: new Date(),
      workItemId: null,
      ...learning,
    });
  }

  _clear(): void {
    this.workers = [];
    this.workItems = [];
    this.metrics = [];
    this.learnings = [];
  }
}

describe("MetricsCollector", () => {
  let mockDb: MockDatabase;
  let collector: MetricsCollector;

  beforeEach(() => {
    mockDb = new MockDatabase();
    collector = new MetricsCollector(mockDb as unknown as Database, 200);
  });

  describe("getSummary", () => {
    test("returns correct aggregate metrics", async () => {
      // Add test data
      mockDb._addWorker("running");
      mockDb._addWorker("starting");
      mockDb._addWorker("completed");

      mockDb._addWorkItem("queued");
      mockDb._addWorkItem("queued");
      mockDb._addWorkItem("completed", new Date());
      mockDb._addWorkItem("failed", null, new Date());

      mockDb._addMetrics({ duration: 60000, iteration: 5, timestamp: new Date() });
      mockDb._addMetrics({ duration: 40000, iteration: 3, timestamp: new Date() });

      const summary = await collector.getSummary();

      expect(summary.activeWorkers).toBe(2);
      expect(summary.queuedItems).toBe(2);
      expect(summary.completedToday).toBe(1);
      expect(summary.failedToday).toBe(1);
      expect(summary.iterationsToday).toBe(8); // 5 + 3
      expect(summary.dailyBudget).toBe(200);
      expect(summary.avgCompletionTime).toBe(50000); // (60000 + 40000) / 2
      expect(summary.successRate).toBe(0.5); // 1 completed / (1 + 1)
    });

    test("handles empty database", async () => {
      const summary = await collector.getSummary();

      expect(summary.activeWorkers).toBe(0);
      expect(summary.queuedItems).toBe(0);
      expect(summary.completedToday).toBe(0);
      expect(summary.failedToday).toBe(0);
      expect(summary.iterationsToday).toBe(0);
      expect(summary.dailyBudget).toBe(200);
      expect(summary.avgCompletionTime).toBe(0);
      expect(summary.successRate).toBe(0);
    });

    test("success rate is 1.0 when all completed", async () => {
      mockDb._addWorkItem("completed", new Date());
      mockDb._addWorkItem("completed", new Date());
      mockDb._addWorkItem("completed", new Date());

      const summary = await collector.getSummary();

      expect(summary.successRate).toBe(1);
    });

    test("success rate is 0 when all failed", async () => {
      mockDb._addWorkItem("failed");
      mockDb._addWorkItem("failed");

      const summary = await collector.getSummary();

      expect(summary.successRate).toBe(0);
    });
  });

  describe("getAll", () => {
    test("returns all worker metrics", async () => {
      mockDb._addMetrics({ id: "m1", tokensIn: 1000 });
      mockDb._addMetrics({ id: "m2", tokensIn: 2000 });
      mockDb._addMetrics({ id: "m3", tokensIn: 3000 });

      const metrics = await collector.getAll();

      expect(metrics).toHaveLength(3);
    });

    test("returns empty array when no metrics", async () => {
      const metrics = await collector.getAll();

      expect(metrics).toEqual([]);
    });
  });

  describe("getLearnings", () => {
    test("returns all learnings when no filters", async () => {
      mockDb._addLearning({ content: "Learning 1" });
      mockDb._addLearning({ content: "Learning 2" });
      mockDb._addLearning({ content: "Learning 3" });

      const learnings = await collector.getLearnings();

      expect(learnings).toHaveLength(3);
    });

    test("returns empty array when no learnings", async () => {
      const learnings = await collector.getLearnings();

      expect(learnings).toEqual([]);
    });

    test("filters by repo", async () => {
      mockDb._addLearning({ repo: "owner/repo1", content: "Learning 1" });
      mockDb._addLearning({ repo: "owner/repo2", content: "Learning 2" });
      mockDb._addLearning({ repo: "owner/repo1", content: "Learning 3" });

      const learnings = await collector.getLearnings({ repo: "owner/repo1" });

      expect(learnings).toHaveLength(2);
      expect(learnings.every((l) => l.repo === "owner/repo1")).toBe(true);
    });

    test("filters by spec (partial match)", async () => {
      mockDb._addLearning({ spec: "# Add Feature X" });
      mockDb._addLearning({ spec: "# Fix Bug Y" });
      mockDb._addLearning({ spec: "# Add Feature Z" });

      const learnings = await collector.getLearnings({ spec: "Feature" });

      expect(learnings).toHaveLength(2);
      expect(learnings.every((l) => l.spec.includes("Feature"))).toBe(true);
    });

    test("respects limit", async () => {
      mockDb._addLearning({ content: "Learning 1" });
      mockDb._addLearning({ content: "Learning 2" });
      mockDb._addLearning({ content: "Learning 3" });
      mockDb._addLearning({ content: "Learning 4" });
      mockDb._addLearning({ content: "Learning 5" });

      const learnings = await collector.getLearnings({ limit: 3 });

      expect(learnings).toHaveLength(3);
    });

    test("combines multiple filters", async () => {
      mockDb._addLearning({ repo: "owner/repo1", spec: "# Add Feature X" });
      mockDb._addLearning({ repo: "owner/repo1", spec: "# Fix Bug Y" });
      mockDb._addLearning({ repo: "owner/repo2", spec: "# Add Feature Z" });
      mockDb._addLearning({ repo: "owner/repo1", spec: "# Add Feature W" });

      const learnings = await collector.getLearnings({
        repo: "owner/repo1",
        spec: "Feature",
      });

      expect(learnings).toHaveLength(2);
      expect(
        learnings.every(
          (l) => l.repo === "owner/repo1" && l.spec.includes("Feature")
        )
      ).toBe(true);
    });

    test("combines filters with limit", async () => {
      mockDb._addLearning({ repo: "owner/repo1", spec: "# Feature 1" });
      mockDb._addLearning({ repo: "owner/repo1", spec: "# Feature 2" });
      mockDb._addLearning({ repo: "owner/repo1", spec: "# Feature 3" });
      mockDb._addLearning({ repo: "owner/repo1", spec: "# Feature 4" });

      const learnings = await collector.getLearnings({
        repo: "owner/repo1",
        spec: "Feature",
        limit: 2,
      });

      expect(learnings).toHaveLength(2);
    });
  });
});
