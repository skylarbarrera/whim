import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { OrchestratorClient } from "./client.js";

describe("OrchestratorClient", () => {
  let client: OrchestratorClient;
  let mockFetch: ReturnType<typeof spyOn>;

  beforeEach(() => {
    client = new OrchestratorClient({
      baseUrl: "http://localhost:3000",
      workerId: "worker-123",
    });

    mockFetch = spyOn(global, "fetch");
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  describe("constructor", () => {
    it("should strip trailing slash from baseUrl", () => {
      const c = new OrchestratorClient({
        baseUrl: "http://localhost:3000/",
        workerId: "test",
      });
      expect(c.baseUrl).toBe("http://localhost:3000");
    });

    it("should store workerId", () => {
      expect(client.workerId).toBe("worker-123");
    });
  });

  describe("heartbeat", () => {
    it("should POST to /api/worker/:id/heartbeat", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      );

      await client.heartbeat(5, "running", { in: 100, out: 50 });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/worker/worker-123/heartbeat",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            iteration: 5,
            status: "running",
            tokensIn: 100,
            tokensOut: 50,
          }),
        })
      );
    });

    it("should handle heartbeat without tokens", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      );

      await client.heartbeat(1);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            iteration: 1,
            status: undefined,
            tokensIn: undefined,
            tokensOut: undefined,
          }),
        })
      );
    });
  });

  describe("lockFile", () => {
    it("should POST files to lock endpoint", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ acquired: true }), { status: 200 })
      );

      const result = await client.lockFile(["src/index.ts", "src/utils.ts"]);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/worker/worker-123/lock",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ files: ["src/index.ts", "src/utils.ts"] }),
        })
      );
      expect(result.acquired).toBe(true);
    });

    it("should return conflict info when lock fails", async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ acquired: false, conflictingWorker: "other-worker" }),
          { status: 200 }
        )
      );

      const result = await client.lockFile(["src/index.ts"]);

      expect(result.acquired).toBe(false);
      expect(result.conflictingWorker).toBe("other-worker");
    });
  });

  describe("complete", () => {
    it("should POST completion data", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      );

      await client.complete(
        "https://github.com/owner/repo/pull/1",
        {
          tokensIn: 1000,
          tokensOut: 500,
          duration: 60000,
          filesModified: 3,
          testsRun: 10,
          testsPassed: 10,
          testsFailed: 0,
          testStatus: "passed",
        },
        [{ content: "Learned something", spec: "spec text" }]
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/worker/worker-123/complete",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("https://github.com/owner/repo/pull/1"),
        })
      );
    });
  });

  describe("fail", () => {
    it("should POST failure data", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      );

      await client.fail("Test failed", 3);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/worker/worker-123/fail",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ error: "Test failed", iteration: 3 }),
        })
      );
    });
  });

  describe("stuck", () => {
    it("should POST stuck data", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      );

      await client.stuck("Cannot resolve dependency", 5);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/worker/worker-123/stuck",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            reason: "Cannot resolve dependency",
            attempts: 5,
          }),
        })
      );
    });
  });

  describe("getLearnings", () => {
    it("should GET learnings for repo", async () => {
      const mockLearnings = [
        { id: "1", content: "learning 1", repo: "owner/repo" },
        { id: "2", content: "learning 2", repo: "owner/repo" },
      ];
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(mockLearnings), { status: 200 })
      );

      const result = await client.getLearnings("owner/repo");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/learnings?repo=owner%2Frepo",
        expect.objectContaining({ method: "GET" })
      );
      expect(result).toHaveLength(2);
    });
  });

  describe("error handling", () => {
    it("should throw on non-ok response", async () => {
      mockFetch.mockResolvedValue(
        new Response("Not found", { status: 404 })
      );

      await expect(client.heartbeat(1)).rejects.toThrow("Request failed: 404");
    });
  });
});
