import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  validateEnvironment,
  cloneRepository,
  checkoutBranch,
  exec,
} from "./shared-worker.js";

describe("validateEnvironment", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return valid environment when all variables are present", () => {
    process.env.ORCHESTRATOR_URL = "http://localhost:3000";
    process.env.WORKER_ID = "worker-123";
    process.env.WORK_ITEM = JSON.stringify({
      id: "item-1",
      repo: "owner/repo",
      status: "queued",
      priority: "medium",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    process.env.GITHUB_TOKEN = "ghp_test123";
    process.env.WORK_DIR = "/custom/workspace";

    const env = validateEnvironment();

    expect(env.orchestratorUrl).toBe("http://localhost:3000");
    expect(env.workerId).toBe("worker-123");
    expect(env.workItem.id).toBe("item-1");
    expect(env.workItem.repo).toBe("owner/repo");
    expect(env.githubToken).toBe("ghp_test123");
    expect(env.workDir).toBe("/custom/workspace");
  });

  it("should use default work directory when not specified", () => {
    process.env.ORCHESTRATOR_URL = "http://localhost:3000";
    process.env.WORKER_ID = "worker-123";
    process.env.WORK_ITEM = JSON.stringify({
      id: "item-1",
      repo: "owner/repo",
      status: "queued",
      priority: "medium",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    process.env.GITHUB_TOKEN = "ghp_test123";
    delete process.env.WORK_DIR;

    const env = validateEnvironment();

    expect(env.workDir).toBe("/workspace");
  });

  it("should throw error when ORCHESTRATOR_URL is missing", () => {
    delete process.env.ORCHESTRATOR_URL;
    process.env.WORKER_ID = "worker-123";
    process.env.WORK_ITEM = JSON.stringify({ id: "item-1", repo: "owner/repo" });
    process.env.GITHUB_TOKEN = "ghp_test123";

    expect(() => validateEnvironment()).toThrow("ORCHESTRATOR_URL environment variable is required");
  });

  it("should throw error when WORKER_ID is missing", () => {
    process.env.ORCHESTRATOR_URL = "http://localhost:3000";
    delete process.env.WORKER_ID;
    process.env.WORK_ITEM = JSON.stringify({ id: "item-1", repo: "owner/repo" });
    process.env.GITHUB_TOKEN = "ghp_test123";

    expect(() => validateEnvironment()).toThrow("WORKER_ID environment variable is required");
  });

  it("should throw error when WORK_ITEM is missing", () => {
    process.env.ORCHESTRATOR_URL = "http://localhost:3000";
    process.env.WORKER_ID = "worker-123";
    delete process.env.WORK_ITEM;
    process.env.GITHUB_TOKEN = "ghp_test123";

    expect(() => validateEnvironment()).toThrow("WORK_ITEM environment variable is required");
  });

  it("should throw error when WORK_ITEM is invalid JSON", () => {
    process.env.ORCHESTRATOR_URL = "http://localhost:3000";
    process.env.WORKER_ID = "worker-123";
    process.env.WORK_ITEM = "not-valid-json";
    process.env.GITHUB_TOKEN = "ghp_test123";

    expect(() => validateEnvironment()).toThrow("WORK_ITEM must be valid JSON");
  });

  it("should throw error when GITHUB_TOKEN is missing", () => {
    process.env.ORCHESTRATOR_URL = "http://localhost:3000";
    process.env.WORKER_ID = "worker-123";
    process.env.WORK_ITEM = JSON.stringify({ id: "item-1", repo: "owner/repo" });
    delete process.env.GITHUB_TOKEN;

    expect(() => validateEnvironment()).toThrow("GITHUB_TOKEN environment variable is required");
  });
});

describe("exec", () => {
  it("should execute command and return output", async () => {
    const result = await exec("echo", ["hello world"]);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("hello world");
    expect(result.stderr).toBe("");
  });

  it("should return non-zero exit code on failure", async () => {
    const result = await exec("ls", ["/nonexistent-path-12345"]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("No such file or directory");
  });

  it("should execute command in specified working directory", async () => {
    const result = await exec("pwd", [], { cwd: "/tmp" });

    expect(result.code).toBe(0);
    // macOS has /private/tmp symlinked to /tmp
    expect(result.stdout.trim()).toMatch(/\/(private\/)?tmp/);
  });
});

describe("cloneRepository", () => {
  it("should throw error with descriptive message on clone failure", async () => {
    // Use invalid token to force clone failure
    await expect(
      cloneRepository("owner/nonexistent-repo-12345", "invalid-token", "/tmp/test-clone")
    ).rejects.toThrow(/Failed to clone repo owner\/nonexistent-repo-12345/);
  });
});

describe("checkoutBranch", () => {
  it("should throw error with descriptive message on checkout failure", async () => {
    // Create a temporary git repo
    const testDir = "/tmp/checkout-test-" + Date.now();
    await exec("mkdir", ["-p", testDir]);
    await exec("git", ["init"], { cwd: testDir });

    // Try to checkout non-existent branch
    await expect(
      checkoutBranch(testDir, "nonexistent-branch")
    ).rejects.toThrow(/Failed to checkout branch nonexistent-branch/);

    // Cleanup
    await exec("rm", ["-rf", testDir]);
  });

  it("should successfully checkout existing branch", async () => {
    // Create a temporary git repo with a branch
    const testDir = "/tmp/checkout-test-" + Date.now();
    await exec("mkdir", ["-p", testDir]);
    await exec("git", ["init"], { cwd: testDir });
    await exec("git", ["config", "user.name", "Test"], { cwd: testDir });
    await exec("git", ["config", "user.email", "test@example.com"], { cwd: testDir });
    await exec("git", ["commit", "--allow-empty", "-m", "Initial commit"], { cwd: testDir });
    await exec("git", ["checkout", "-b", "test-branch"], { cwd: testDir });
    await exec("git", ["checkout", "master"], { cwd: testDir });

    // Should not throw
    await expect(checkoutBranch(testDir, "test-branch")).resolves.toBeUndefined();

    // Verify we're on the correct branch
    const result = await exec("git", ["branch", "--show-current"], { cwd: testDir });
    expect(result.stdout.trim()).toBe("test-branch");

    // Cleanup
    await exec("rm", ["-rf", testDir]);
  });
});
