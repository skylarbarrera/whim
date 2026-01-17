import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { runVerificationWorker } from "./verification-worker.js";

describe("Verification Worker", () => {
  let mockFetch: ReturnType<typeof spyOn>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    mockFetch = spyOn(global, "fetch");
  });

  afterEach(() => {
    process.env = originalEnv;
    mockFetch.mockRestore();
  });

  describe("Environment validation", () => {
    it("should require ORCHESTRATOR_URL", async () => {
      delete process.env.ORCHESTRATOR_URL;
      process.env.WORKER_ID = "test-worker";
      process.env.WORK_ITEM = JSON.stringify({
        id: "test-id",
        repo: "owner/repo",
        branch: "feat/test",
        prNumber: 42,
      });
      process.env.GITHUB_TOKEN = "test-token";

      await expect(runVerificationWorker()).rejects.toThrow(
        "ORCHESTRATOR_URL environment variable is required"
      );
    });

    it("should require WORKER_ID", async () => {
      process.env.ORCHESTRATOR_URL = "http://localhost:3000";
      delete process.env.WORKER_ID;
      process.env.WORK_ITEM = JSON.stringify({
        id: "test-id",
        repo: "owner/repo",
        branch: "feat/test",
        prNumber: 42,
      });
      process.env.GITHUB_TOKEN = "test-token";

      await expect(runVerificationWorker()).rejects.toThrow(
        "WORKER_ID environment variable is required"
      );
    });

    it("should require WORK_ITEM", async () => {
      process.env.ORCHESTRATOR_URL = "http://localhost:3000";
      process.env.WORKER_ID = "test-worker";
      delete process.env.WORK_ITEM;
      process.env.GITHUB_TOKEN = "test-token";

      await expect(runVerificationWorker()).rejects.toThrow(
        "WORK_ITEM environment variable is required"
      );
    });

    it("should require valid JSON in WORK_ITEM", async () => {
      process.env.ORCHESTRATOR_URL = "http://localhost:3000";
      process.env.WORKER_ID = "test-worker";
      process.env.WORK_ITEM = "not valid json";
      process.env.GITHUB_TOKEN = "test-token";

      await expect(runVerificationWorker()).rejects.toThrow(
        "WORK_ITEM must be valid JSON"
      );
    });

    it("should require GITHUB_TOKEN", async () => {
      process.env.ORCHESTRATOR_URL = "http://localhost:3000";
      process.env.WORKER_ID = "test-worker";
      process.env.WORK_ITEM = JSON.stringify({
        id: "test-id",
        repo: "owner/repo",
        branch: "feat/test",
        prNumber: 42,
      });
      delete process.env.GITHUB_TOKEN;

      await expect(runVerificationWorker()).rejects.toThrow(
        "GITHUB_TOKEN environment variable is required"
      );
    });

    it("should require branch in work item", async () => {
      process.env.ORCHESTRATOR_URL = "http://localhost:3000";
      process.env.WORKER_ID = "test-worker";
      process.env.WORK_ITEM = JSON.stringify({
        id: "test-id",
        repo: "owner/repo",
        branch: null,
        prNumber: 42,
      });
      process.env.GITHUB_TOKEN = "test-token";

      await expect(runVerificationWorker()).rejects.toThrow(
        "Work item must have a branch for verification"
      );
    });

    it("should require prNumber in work item", async () => {
      process.env.ORCHESTRATOR_URL = "http://localhost:3000";
      process.env.WORKER_ID = "test-worker";
      process.env.WORK_ITEM = JSON.stringify({
        id: "test-id",
        repo: "owner/repo",
        branch: "feat/test",
        prNumber: null,
      });
      process.env.GITHUB_TOKEN = "test-token";

      await expect(runVerificationWorker()).rejects.toThrow(
        "Work item must have a prNumber for verification"
      );
    });
  });

  describe("Type guards", () => {
    it("should validate verification-ready work items", async () => {
      const { isVerificationReady } = await import("./types.js");

      const validItem = {
        id: "test",
        repo: "owner/repo",
        branch: "feat/test",
        prNumber: 42,
      } as unknown;

      expect(isVerificationReady(validItem)).toBe(true);
    });

    it("should reject work items without branch", async () => {
      const { isVerificationReady } = await import("./types.js");

      const invalidItem = {
        id: "test",
        repo: "owner/repo",
        branch: null,
        prNumber: 42,
      } as unknown;

      expect(isVerificationReady(invalidItem)).toBe(false);
    });

    it("should reject work items without prNumber", async () => {
      const { isVerificationReady } = await import("./types.js");

      const invalidItem = {
        id: "test",
        repo: "owner/repo",
        branch: "feat/test",
        prNumber: null,
      } as unknown;

      expect(isVerificationReady(invalidItem)).toBe(false);
    });
  });
});
