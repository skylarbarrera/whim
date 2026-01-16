import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { OrchestratorClient } from "./client.js";

describe("OrchestratorClient", () => {
  let client: OrchestratorClient;
  let mockFetch: ReturnType<typeof spyOn>;

  beforeEach(() => {
    client = new OrchestratorClient({
      baseUrl: "http://localhost:3000",
      workerId: "worker-123",
      repo: "owner/repo",
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
        repo: "owner/repo",
      });
      expect(c.baseUrl).toBe("http://localhost:3000");
    });

    it("should store workerId", () => {
      expect(client.workerId).toBe("worker-123");
    });

    it("should store repo", () => {
      expect(client.repo).toBe("owner/repo");
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
    it("should POST files to lock endpoint with repo", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ acquired: true }), { status: 200 })
      );

      const result = await client.lockFile(["src/index.ts", "src/utils.ts"]);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/worker/worker-123/lock",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ repo: "owner/repo", files: ["src/index.ts", "src/utils.ts"] }),
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

    it("should include prNumber when provided", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      );

      await client.complete(
        "https://github.com/owner/repo/pull/42",
        undefined,
        undefined,
        42
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.prNumber).toBe(42);
    });

    it("should include verificationEnabled when provided", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      );

      await client.complete(
        "https://github.com/owner/repo/pull/1",
        undefined,
        undefined,
        undefined,
        undefined,
        true
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.verificationEnabled).toBe(true);
    });

    it("should include review data when provided", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      );

      const reviewData = {
        modelUsed: "claude-sonnet-4-20250514",
        findings: {
          specAlignment: {
            score: "aligned" as const,
            summary: "Code matches spec",
            gaps: [],
            extras: [],
          },
          codeQuality: {
            score: "good" as const,
            summary: "Code quality is good",
            concerns: [],
          },
          overallSummary: "Looks good",
        },
      };

      await client.complete(
        "https://github.com/owner/repo/pull/1",
        undefined,
        undefined,
        undefined,
        reviewData
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.review).toEqual(reviewData);
    });

    it("should include all optional completion fields when provided", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      );

      const metrics = {
        tokensIn: 1000,
        tokensOut: 500,
        duration: 60000,
        filesModified: 3,
        testsRun: 10,
        testsPassed: 10,
        testsFailed: 0,
        testStatus: "passed" as const,
      };

      const learnings = [{ content: "Learning 1", spec: "spec 1" }];

      const reviewData = {
        modelUsed: "claude-sonnet-4-20250514",
        findings: {
          specAlignment: {
            score: "aligned" as const,
            summary: "Code matches spec",
            gaps: [],
            extras: [],
          },
          codeQuality: {
            score: "good" as const,
            summary: "Code quality is good",
            concerns: [],
          },
          overallSummary: "Looks good",
        },
      };

      await client.complete(
        "https://github.com/owner/repo/pull/42",
        metrics,
        learnings,
        42,
        reviewData,
        true
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.prUrl).toBe("https://github.com/owner/repo/pull/42");
      expect(callBody.prNumber).toBe(42);
      expect(callBody.metrics).toEqual(metrics);
      expect(callBody.learnings).toEqual(learnings);
      expect(callBody.review).toEqual(reviewData);
      expect(callBody.verificationEnabled).toBe(true);
    });
  });

  describe("completeVerification", () => {
    it("should POST verification passed", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      );

      await client.completeVerification(true);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/worker/worker-123/complete",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ verificationPassed: true }),
        })
      );
    });

    it("should POST verification failed", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      );

      await client.completeVerification(false);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/worker/worker-123/complete",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ verificationPassed: false }),
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
