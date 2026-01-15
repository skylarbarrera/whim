import { describe, expect, it, beforeEach, afterEach, spyOn, mock } from "bun:test";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import { EventEmitter } from "node:events";

// Store original readFileSync for restoration
const originalReadFileSync = fs.readFileSync;

// Variable to hold mock spec content for each test
let mockSpecContent: string = "";

// Mock fs.readFileSync at module level
spyOn(fs, "readFileSync").mockImplementation(((path: string, encoding?: string) => {
  if (typeof path === "string" && path.endsWith("SPEC.md")) {
    return mockSpecContent;
  }
  return originalReadFileSync(path, encoding as any);
}) as typeof fs.readFileSync);

// Import after mocking
import { RalphSpecGenerator, type GenerateMetadata } from "./spec-gen.js";

/**
 * Mock ChildProcess for testing
 */
class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter() as any;
  stderr = new EventEmitter() as any;
  stdin = null as any;
  stdio = [null, this.stdout, this.stderr, null, null] as any;
  killed = false;
  pid = 12345;
  exitCode = null;
  signalCode = null;
  spawnargs: string[] = [];
  spawnfile = "";
  connected = false;

  kill(_signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    return true;
  }

  simulateSuccess() {
    this.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          event: "spec_generation_complete",
          specPath: "/tmp/SPEC.md",
          taskCount: 3,
          validationPassed: true,
          violations: 0,
          timestamp: new Date().toISOString(),
        }) + "\n"
      )
    );

    setImmediate(() => {
      this.emit("close", 0);
    });
  }

  simulateFailure(error: string) {
    this.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          event: "spec_generation_failed",
          error,
          timestamp: new Date().toISOString(),
        }) + "\n"
      )
    );

    setImmediate(() => {
      this.emit("close", 1);
    });
  }

  simulateTimeout() {
    // Don't emit any close event - let the timeout handler catch it
  }
}

describe("RalphSpecGenerator", () => {
  let generator: RalphSpecGenerator;
  let mockProc: MockChildProcess;

  beforeEach(() => {
    mockProc = new MockChildProcess();
    spyOn(cp, "spawn").mockImplementation(() => mockProc as any);
    mockSpecContent = ""; // Reset spec content

    generator = new RalphSpecGenerator({
      timeoutMs: 1000,
      workDir: "/tmp/test",
    });
  });

  describe("generate", () => {
    it("should generate spec from description", async () => {
      const testSpec = "# Test Spec\n\nThis is a test spec.";
      mockSpecContent = testSpec;

      const description = "Build a new feature";
      const metadata: GenerateMetadata = {
        source: "github",
        sourceRef: "issue:42",
        title: "Build a new feature",
      };

      const promise = generator.generate(description, metadata);
      mockProc.simulateSuccess();

      const result = await promise;

      expect(result.spec).toBe(testSpec);
      expect(result.title).toBe("Build a new feature");
      expect(result.branch).toBe("ai/github-issue-42-build-a-new-feature");
      expect(result.metadata.source).toBe("github");
      expect(result.metadata.sourceRef).toBe("issue:42");
      expect(result.metadata.generatedAt).toBeDefined();
    });

    it("should extract title from spec if not provided", async () => {
      const testSpec = "# Extracted Title\n\nContent here.";
      mockSpecContent = testSpec;

      const promise = generator.generate("Build something");
      mockProc.simulateSuccess();

      const result = await promise;

      expect(result.title).toBe("Extracted Title");
    });

    it("should use fallback title if spec has no heading", async () => {
      mockSpecContent = "No heading here.";

      const promise = generator.generate("Build something");
      mockProc.simulateSuccess();

      const result = await promise;

      expect(result.title).toBe("Generated Task");
    });

    it("should throw error on spec generation failure", async () => {
      const promise = generator.generate("Build something");
      mockProc.simulateFailure("LLM API error");

      await expect(promise).rejects.toThrow("LLM API error");
    });

    it("should timeout if ralph takes too long", async () => {
      const promise = generator.generate("Build something");
      mockProc.simulateTimeout();

      await expect(promise).rejects.toThrow("Timeout after 1s");
    });
  });

  describe("branch naming", () => {
    beforeEach(() => {
      mockSpecContent = "# Test\n\nContent";
    });

    it("should generate branch with source and sourceRef", async () => {
      const metadata: GenerateMetadata = {
        source: "github",
        sourceRef: "issue:42",
        title: "Add User Authentication",
      };

      const promise = generator.generate("description", metadata);
      mockProc.simulateSuccess();

      const result = await promise;

      expect(result.branch).toBe("ai/github-issue-42-add-user-authentication");
    });

    it("should sanitize sourceRef with colons", async () => {
      const metadata: GenerateMetadata = {
        source: "linear",
        sourceRef: "LIN:123",
        title: "Fix Bug",
      };

      const promise = generator.generate("description", metadata);
      mockProc.simulateSuccess();

      const result = await promise;

      expect(result.branch).toBe("ai/linear-lin-123-fix-bug");
    });

    it("should sanitize sourceRef with special characters", async () => {
      const metadata: GenerateMetadata = {
        source: "jira",
        sourceRef: "PROJ-123!@#$%",
        title: "Update API",
      };

      const promise = generator.generate("description", metadata);
      mockProc.simulateSuccess();

      const result = await promise;

      expect(result.branch).toBe("ai/jira-proj-123-update-api");
    });

    it("should use timestamp when no source provided", async () => {
      const metadata: GenerateMetadata = {
        title: "Build Feature",
      };

      const promise = generator.generate("description", metadata);
      mockProc.simulateSuccess();

      const result = await promise;

      // Branch should match pattern: ai/YYYYMMDDHHmmss-build-feature
      expect(result.branch).toMatch(/^ai\/\d{14}-build-feature$/);
    });

    it("should handle long titles by truncating slug", async () => {
      const metadata: GenerateMetadata = {
        source: "github",
        sourceRef: "issue:1",
        title: "This is a very long title that should be truncated to fit within the branch name length limit",
      };

      const promise = generator.generate("description", metadata);
      mockProc.simulateSuccess();

      const result = await promise;

      // Slug should be truncated to 40 chars
      expect(result.branch.length).toBeLessThanOrEqual(60);
      expect(result.branch).toMatch(/^ai\/github-issue-1-this-is-a-very-long-title-that-should-be$/);
    });

    it("should handle title with special characters", async () => {
      const metadata: GenerateMetadata = {
        source: "api",
        sourceRef: "task-1",
        title: "Fix bug in @user/module's function!",
      };

      const promise = generator.generate("description", metadata);
      mockProc.simulateSuccess();

      const result = await promise;

      expect(result.branch).toBe("ai/api-task-1-fix-bug-in-user-module-s-function");
    });

    it("should use generic slug when no title provided", async () => {
      const metadata: GenerateMetadata = {
        source: "slack",
        sourceRef: "msg-123",
      };

      const promise = generator.generate("description", metadata);
      mockProc.simulateSuccess();

      const result = await promise;

      expect(result.branch).toBe("ai/slack-msg-123-task");
    });
  });

  describe("spawn arguments", () => {
    beforeEach(() => {
      mockSpecContent = "# Test\n\nContent";
    });

    it("should pass correct arguments to ralph", async () => {
      const description = "Build something";
      const promise = generator.generate(description);

      // Check spawn was called
      expect(cp.spawn).toHaveBeenCalled();
      const calls = (cp.spawn as any).mock.calls;

      expect(calls).toBeDefined();
      // Get the last call (there may be multiple from previous tests)
      const lastCall = calls[calls.length - 1];
      expect(lastCall[0]).toBe("ralph");
      expect(lastCall[1]).toEqual([
        "spec",
        "--headless",
        "--timeout",
        "1",
        "--cwd",
        "/tmp/test",
        description,
      ]);

      mockProc.simulateSuccess();
      await promise;
    });
  });
});
