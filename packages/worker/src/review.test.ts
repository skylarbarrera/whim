import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  generateDiff,
  readSpec,
  reviewCode,
  reviewPullRequest,
} from "./review.js";

describe("review", () => {
  const testDir = join("/tmp", "review-test-" + Date.now());
  let originalApiKey: string | undefined;
  let originalReviewEnabled: string | undefined;

  beforeEach(async () => {
    // Set up test environment
    originalApiKey = process.env.ANTHROPIC_API_KEY;
    originalReviewEnabled = process.env.AI_REVIEW_ENABLED;
    process.env.ANTHROPIC_API_KEY = "test-api-key";
    process.env.AI_REVIEW_ENABLED = "true";

    // Create test directory
    await mkdir(testDir, { recursive: true });

    // Initialize git repo
    execSync("git init", { cwd: testDir, stdio: "pipe" });
    execSync('git config user.email "test@example.com"', {
      cwd: testDir,
      stdio: "pipe",
    });
    execSync('git config user.name "Test User"', {
      cwd: testDir,
      stdio: "pipe",
    });

    // Create main branch with initial commit
    await writeFile(join(testDir, "README.md"), "# Test Repo\n");
    execSync("git add .", { cwd: testDir, stdio: "pipe" });
    execSync('git commit -m "Initial commit"', { cwd: testDir, stdio: "pipe" });
    execSync("git branch -M main", { cwd: testDir, stdio: "pipe" });

    // Create origin remote (point to self for testing)
    execSync(`git remote add origin ${testDir}`, { cwd: testDir, stdio: "pipe" });
    execSync("git fetch origin", { cwd: testDir, stdio: "pipe" });
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });

    // Restore environment
    if (originalApiKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }

    if (originalReviewEnabled !== undefined) {
      process.env.AI_REVIEW_ENABLED = originalReviewEnabled;
    } else {
      delete process.env.AI_REVIEW_ENABLED;
    }
  });

  describe("generateDiff", () => {
    it("should generate diff between origin/main and HEAD", async () => {
      // Make a change on a new branch
      execSync("git checkout -b test-branch", { cwd: testDir, stdio: "pipe" });
      await writeFile(join(testDir, "test.txt"), "Hello world\n");
      execSync("git add .", { cwd: testDir, stdio: "pipe" });
      execSync('git commit -m "Add test file"', {
        cwd: testDir,
        stdio: "pipe",
      });

      const diff = generateDiff(testDir);

      expect(diff).toContain("test.txt");
      expect(diff).toContain("Hello world");
      expect(diff).toContain("+++");
      expect(diff).toContain("---");
    });

    it("should return empty string when no changes", () => {
      // No changes from origin/main
      const diff = generateDiff(testDir);
      expect(diff).toBe("");
    });

    it("should throw error if base ref not found", async () => {
      // Create a repo without origin
      const isolatedDir = join("/tmp", "isolated-" + Date.now());
      await mkdir(isolatedDir, { recursive: true });
      execSync("git init", { cwd: isolatedDir, stdio: "pipe" });
      execSync('git config user.email "test@example.com"', {
        cwd: isolatedDir,
        stdio: "pipe",
      });
      execSync('git config user.name "Test User"', {
        cwd: isolatedDir,
        stdio: "pipe",
      });

      expect(() => generateDiff(isolatedDir)).toThrow(/Could not find a valid base ref/);

      await rm(isolatedDir, { recursive: true, force: true });
    });
  });

  describe("readSpec", () => {
    it("should read SPEC.md from repo root", async () => {
      const specContent = "# Test Spec\n\nThis is a test spec.";
      await writeFile(join(testDir, "SPEC.md"), specContent);

      const result = readSpec(testDir);
      expect(result).toBe(specContent);
    });

    it("should throw error if SPEC.md not found", () => {
      expect(() => readSpec(testDir)).toThrow(/SPEC.md not found/);
    });
  });

  describe("reviewCode", () => {
    it("should throw error if ANTHROPIC_API_KEY not set", async () => {
      delete process.env.ANTHROPIC_API_KEY;

      const diff = "diff --git a/test.txt b/test.txt\n+Hello";
      const spec = "# Spec";

      await expect(reviewCode(diff, spec)).rejects.toThrow(
        /ANTHROPIC_API_KEY environment variable is required/
      );
    });

    // Note: Tests that require mocking the Anthropic SDK are skipped
    // They would require integration tests with a real API key
  });

  describe("reviewPullRequest", () => {
    it("should return null if AI_REVIEW_ENABLED is false", async () => {
      process.env.AI_REVIEW_ENABLED = "false";

      const result = await reviewPullRequest(testDir);
      expect(result).toBeNull();
    });

    it("should return null if config.enabled is false", async () => {
      const result = await reviewPullRequest(testDir, { enabled: false });
      expect(result).toBeNull();
    });

    it("should return null if no changes detected", async () => {
      await writeFile(join(testDir, "SPEC.md"), "# Spec");

      const result = await reviewPullRequest(testDir);
      expect(result).toBeNull();
    });

    it("should return null on error and not throw", async () => {
      // SPEC.md doesn't exist, should fail gracefully
      execSync("git checkout -b error-branch", { cwd: testDir, stdio: "pipe" });
      await writeFile(join(testDir, "test.txt"), "test");
      execSync("git add .", { cwd: testDir, stdio: "pipe" });
      execSync('git commit -m "test"', { cwd: testDir, stdio: "pipe" });

      const result = await reviewPullRequest(testDir);
      expect(result).toBeNull();
    });
  });
});
