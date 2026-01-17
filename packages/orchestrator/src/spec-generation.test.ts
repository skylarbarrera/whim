/**
 * Tests for Background Spec Generation Manager
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { SpecGenerationManager } from "./spec-generation.js";
import type { WorkItem } from "@whim/shared";
import type { Database } from "./db.js";

describe("SpecGenerationManager", () => {
  let manager: SpecGenerationManager;
  let mockDb: Database;
  let mockGenerate: ReturnType<typeof mock>;

  beforeEach(() => {
    // Create mock database
    mockDb = {
      execute: mock(() => Promise.resolve({ rowCount: 1 })),
    } as unknown as Database;

    // Create manager - we'll mock the generator's generate method after construction
    manager = new SpecGenerationManager(mockDb);

    // Mock the generator's generate method
    mockGenerate = mock((_description: string, metadata?: { source?: string; sourceRef?: string }) => {
      return Promise.resolve({
        title: "Test Title",
        spec: "# Test Spec\n\nTest content",
        branch: "ai/test-branch",
        metadata: {
          source: metadata?.source,
          sourceRef: metadata?.sourceRef,
          generatedAt: new Date().toISOString(),
        },
      });
    });

    // Replace the generator's generate method
    (manager as unknown as { generator: { generate: typeof mockGenerate } }).generator.generate = mockGenerate;
  });

  afterEach(() => {
    mockGenerate?.mockClear();
    (mockDb.execute as ReturnType<typeof mock>)?.mockClear();
  });

  describe("start", () => {
    it("should start generation for work item with description", async () => {
      const workItem: WorkItem = {
        id: "test-123",
        repo: "owner/repo",
        description: "Add user authentication",
        spec: null,
        branch: null,
        type: "execution",
        status: "generating",
        priority: "medium",
        workerId: null,
        iteration: 0,
        maxIterations: 50,
        retryCount: 0,
        nextRetryAt: null,
        prUrl: null,
        prNumber: null,
        parentWorkItemId: null,
        verificationPassed: null,
        source: null,
        sourceRef: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        error: null,
        metadata: {},
      };

      manager.start(workItem);

      expect(manager.isGenerating(workItem.id)).toBe(true);
      expect(manager.getStatus(workItem.id)).toEqual({
        inProgress: true,
        attempt: 1,
      });

      // Wait for async generation to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockGenerate).toHaveBeenCalledTimes(1);
      expect(mockGenerate).toHaveBeenCalledWith(
        "Add user authentication",
        expect.objectContaining({
          source: undefined,
          sourceRef: undefined,
          title: undefined,
        })
      );

      expect(mockDb.execute).toHaveBeenCalled();
      const call = (mockDb.execute as ReturnType<typeof mock>).mock.calls[0];
      expect(call?.[0]).toContain("UPDATE work_items");
      expect(call?.[1]).toContain("# Test Spec\n\nTest content");
      expect(call?.[1]).toContain("ai/test-branch");
      expect(call?.[1]).toContain("test-123");
    });

    it("should include source and sourceRef in metadata", async () => {
      const workItem: WorkItem = {
        id: "test-456",
        repo: "owner/repo",
        description: "Fix login bug",
        spec: null,
        branch: null,
        type: "execution",
        status: "generating",
        priority: "high",
        workerId: null,
        iteration: 0,
        maxIterations: 50,
        retryCount: 0,
        nextRetryAt: null,
        prUrl: null,
        prNumber: null,
        parentWorkItemId: null,
        verificationPassed: null,
        source: "github",
        sourceRef: "issue:42",
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        error: null,
        metadata: {},
      };

      manager.start(workItem);

      // Wait for generation
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockGenerate).toHaveBeenCalledWith(
        "Fix login bug",
        expect.objectContaining({
          source: "github",
          sourceRef: "issue:42",
        })
      );
    });

    it("should not start if already generating", () => {
      const workItem: WorkItem = {
        id: "test-789",
        repo: "owner/repo",
        description: "Test task",
        spec: null,
        branch: null,
        type: "execution",
        status: "generating",
        priority: "medium",
        workerId: null,
        iteration: 0,
        maxIterations: 50,
        retryCount: 0,
        nextRetryAt: null,
        prUrl: null,
        prNumber: null,
        parentWorkItemId: null,
        verificationPassed: null,
        source: null,
        sourceRef: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        error: null,
        metadata: {},
      };

      manager.start(workItem);
      manager.start(workItem); // Second call should be ignored

      expect(manager.getInFlightCount()).toBe(1);
    });

    it("should handle work item without description", () => {
      const workItem: WorkItem = {
        id: "test-999",
        repo: "owner/repo",
        description: null,
        spec: "# Existing Spec",
        branch: "ai/test",
        type: "execution",
        status: "queued",
        priority: "medium",
        workerId: null,
        iteration: 0,
        maxIterations: 50,
        retryCount: 0,
        nextRetryAt: null,
        prUrl: null,
        prNumber: null,
        parentWorkItemId: null,
        verificationPassed: null,
        source: null,
        sourceRef: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        error: null,
        metadata: {},
      };

      manager.start(workItem);

      expect(manager.isGenerating(workItem.id)).toBe(false);
      expect(mockGenerate).not.toHaveBeenCalled();
    });
  });

  describe("retry logic", () => {
    beforeEach(() => {
      // Set SPEC_MAX_ATTEMPTS for testing
      process.env.SPEC_MAX_ATTEMPTS = "3";
    });

    it("should retry on failure up to max attempts", async () => {
      const workItem: WorkItem = {
        id: "retry-test",
        repo: "owner/repo",
        description: "Test retry",
        spec: null,
        branch: null,
        type: "execution",
        status: "generating",
        priority: "medium",
        workerId: null,
        iteration: 0,
        maxIterations: 50,
        retryCount: 0,
        nextRetryAt: null,
        prUrl: null,
        prNumber: null,
        parentWorkItemId: null,
        verificationPassed: null,
        source: null,
        sourceRef: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        error: null,
        metadata: {},
      };

      // Fail twice, succeed on third attempt
      let callCount = 0;
      mockGenerate = mock((): Promise<{ title: string; spec: string; branch: string; metadata: { generatedAt: string } }> => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error("Temporary failure"));
        }
        return Promise.resolve({
          title: "Test Retry",
          spec: "# Test Retry\n\nRetried...",
          branch: "ai/test-retry",
          metadata: { generatedAt: new Date().toISOString() },
        });
      });
      (manager as unknown as { generator: { generate: typeof mockGenerate } }).generator.generate = mockGenerate;

      manager.start(workItem);

      // Wait for retries
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(mockGenerate).toHaveBeenCalledTimes(3);

      // Check that the work item was updated successfully
      const successCalls = (mockDb.execute as ReturnType<typeof mock>).mock.calls.filter(
        (call: unknown[]) => (call[0] as string).includes("status = 'queued'")
      );
      expect(successCalls.length).toBeGreaterThan(0);
    });

    it("should mark as failed after max attempts", async () => {
      const workItem: WorkItem = {
        id: "fail-test",
        repo: "owner/repo",
        description: "Test failure",
        spec: null,
        branch: null,
        type: "execution",
        status: "generating",
        priority: "medium",
        workerId: null,
        iteration: 0,
        maxIterations: 50,
        retryCount: 0,
        nextRetryAt: null,
        prUrl: null,
        prNumber: null,
        parentWorkItemId: null,
        verificationPassed: null,
        source: null,
        sourceRef: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        error: null,
        metadata: {},
      };

      // Always fail
      mockGenerate = mock(() => Promise.reject(new Error("Persistent failure")));
      (manager as unknown as { generator: { generate: typeof mockGenerate } }).generator.generate = mockGenerate;

      manager.start(workItem);

      // Wait for all retries
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(mockGenerate).toHaveBeenCalledTimes(3); // Max attempts

      // Check that the work item was marked as failed
      const failCalls = (mockDb.execute as ReturnType<typeof mock>).mock.calls.filter(
        (call: unknown[]) => (call[0] as string).includes("status = 'failed'")
      );
      expect(failCalls.length).toBeGreaterThan(0);

      expect(manager.isGenerating("fail-test")).toBe(false);
    });
  });

  describe("status tracking", () => {
    it("should track multiple concurrent generations", () => {
      const workItem1: WorkItem = {
        id: "concurrent-1",
        repo: "owner/repo",
        description: "Task 1",
        spec: null,
        branch: null,
        type: "execution",
        status: "generating",
        priority: "medium",
        workerId: null,
        iteration: 0,
        maxIterations: 50,
        retryCount: 0,
        nextRetryAt: null,
        prUrl: null,
        prNumber: null,
        parentWorkItemId: null,
        verificationPassed: null,
        source: null,
        sourceRef: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        error: null,
        metadata: {},
      };

      const workItem2: WorkItem = {
        ...workItem1,
        id: "concurrent-2",
        description: "Task 2",
      };

      manager.start(workItem1);
      manager.start(workItem2);

      expect(manager.getInFlightCount()).toBe(2);
      expect(manager.getInFlightIds()).toContain("concurrent-1");
      expect(manager.getInFlightIds()).toContain("concurrent-2");
    });

    it("should return correct status for non-generating item", () => {
      const status = manager.getStatus("non-existent");

      expect(status).toEqual({
        inProgress: false,
        attempt: 0,
      });
    });
  });
});
