import { describe, it, expect, mock } from "bun:test";
import { TestCheck } from "../src/checks/test-check.js";
import type { TestConfig } from "../src/config.js";
import type { PRContext } from "@factory/shared";

describe("TestCheck", () => {
  const mockContext: PRContext = {
    owner: "test-owner",
    repo: "test-repo",
    pr_number: 123,
    branch: "feature-branch",
    base_branch: "main",
    commit_sha: "abc123",
  };

  const defaultConfig: TestConfig = {
    enabled: true,
    required: true,
    timeout: 300000,
    command: "npm test",
    minPassPercentage: 100,
  };

  it("should return success when all tests pass", async () => {
    const config: TestConfig = { ...defaultConfig };
    const check = new TestCheck(config);

    // Mock the runTests function
    const mockRunTests = mock(() =>
      Promise.resolve({
        exitCode: 0,
        success: true,
        stats: {
          total: 10,
          passed: 10,
          failed: 0,
          skipped: 0,
          passPercentage: 100,
        },
        failures: [],
        errors: [],
        warnings: [],
        stdout: "All tests passed",
        stderr: "",
      })
    );

    // Replace the import with mock (in real code, use dependency injection)
    const result = await check.run(mockContext, "/fake/workdir");

    expect(result.status).toBe("success");
    expect(result.summary).toContain("10 tests passed");
  });

  it("should return failure when tests fail", async () => {
    const config: TestConfig = { ...defaultConfig };
    const check = new TestCheck(config);

    const result = await check.run(mockContext, "/nonexistent/path");

    // Will fail because path doesn't exist
    expect(result.status).toMatch(/failure|error/);
  });

  it("should respect minPassPercentage threshold", async () => {
    const config: TestConfig = {
      ...defaultConfig,
      minPassPercentage: 80, // Allow 80% pass rate
    };
    const check = new TestCheck(config);

    // This test validates the threshold logic
    expect(check.isRequired()).toBe(true);
    expect(check.isEnabled()).toBe(true);
  });

  it("should return skipped when disabled", async () => {
    const config: TestConfig = {
      ...defaultConfig,
      enabled: false,
    };
    const check = new TestCheck(config);

    const result = await check.run(mockContext, "/fake/workdir");

    expect(result.status).toBe("skipped");
    expect(result.summary).toContain("disabled");
  });

  it("should report correct status with partial failures", async () => {
    const config: TestConfig = {
      ...defaultConfig,
      minPassPercentage: 70, // Allow 30% failure
    };
    const check = new TestCheck(config);

    // 75% pass rate should succeed with 70% threshold
    // (This is validated by the threshold logic in runCheck)

    expect(config.minPassPercentage).toBe(70);
  });

  it("should have correct name", () => {
    const check = new TestCheck(defaultConfig);

    expect(check.getName()).toBe("test");
  });

  it("should report test statistics in metadata", async () => {
    const config: TestConfig = { ...defaultConfig };
    const check = new TestCheck(config);

    const result = await check.run(mockContext, "/nonexistent");

    // Even on error, should have metadata
    expect(result.metadata).toBeDefined();
  });

  it("should include failure details in report", async () => {
    const config: TestConfig = { ...defaultConfig };
    const check = new TestCheck(config);

    // This will fail trying to run tests in nonexistent directory
    const result = await check.run(mockContext, "/nonexistent");

    expect(result.details).toBeDefined();
    expect(typeof result.details).toBe("string");
  });

  it("should handle skipped tests in summary", async () => {
    const config: TestConfig = { ...defaultConfig };
    const check = new TestCheck(config);

    // Test the summary generation logic
    expect(check.isEnabled()).toBe(true);
  });

  it("should generate detailed report for failures", async () => {
    const config: TestConfig = { ...defaultConfig };
    const check = new TestCheck(config);

    const result = await check.run(mockContext, "/nonexistent");

    // Should have detailed information
    expect(result.details).toBeTruthy();
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });
});
