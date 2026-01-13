import { describe, it, expect, mock } from "bun:test";
import { LintCheck } from "../src/checks/lint-check.js";
import type { PRContext } from "@factory/shared";
import type { LintConfig } from "../src/config.js";

// Create a mock PR context
function createContext(): PRContext {
  return {
    owner: "test-owner",
    repo: "test-repo",
    prNumber: 123,
    commits: [
      {
        sha: "abc123",
        message: "Test commit",
        author: "test@example.com",
      },
    ],
    branch: "feature/test",
    baseBranch: "main",
    labels: ["ai-generated"],
    description: "Test PR",
    changedFiles: ["src/file.ts"],
  };
}

describe("LintCheck", () => {
  it("should return skipped when disabled", async () => {
    const config: LintConfig = {
      enabled: false,
      required: true,
      timeout: 60000,
      tools: [],
      failureThreshold: 0,
    };

    const check = new LintCheck(config);
    const result = await check.run(createContext(), "/tmp");

    expect(result.status).toBe("skipped");
    expect(result.summary).toContain("disabled");
  });

  it("should return success when no violations found", async () => {
    // Mock runLintTools to return empty results
    mock.module("../src/lint-runner.js", () => ({
      runLintTools: mock(async () => [
        {
          tool: "eslint",
          exitCode: 0,
          success: true,
          errors: [],
          warnings: [],
          stdout: "[]",
          stderr: "",
        },
      ]),
    }));

    const config: LintConfig = {
      enabled: true,
      required: true,
      timeout: 60000,
      tools: [
        {
          name: "eslint",
          command: "npx eslint . --format json",
          enabled: true,
        },
      ],
      failureThreshold: 0,
    };

    const check = new LintCheck(config);
    const result = await check.run(createContext(), "/tmp");

    expect(result.status).toBe("success");
    expect(result.summary).toContain("passed");
  });

  it("should return failure when violations exceed threshold", async () => {
    mock.module("../src/lint-runner.js", () => ({
      runLintTools: mock(async () => [
        {
          tool: "eslint",
          exitCode: 1,
          success: true,
          errors: [
            {
              file: "src/file.ts",
              line: 10,
              column: 5,
              message: "Variable is unused",
              rule: "no-unused-vars",
              severity: "error" as const,
            },
          ],
          warnings: [],
          stdout: "",
          stderr: "",
        },
      ]),
    }));

    const config: LintConfig = {
      enabled: true,
      required: true,
      timeout: 60000,
      tools: [
        {
          name: "eslint",
          command: "npx eslint . --format json",
          enabled: true,
        },
      ],
      failureThreshold: 0, // Any error fails
    };

    const check = new LintCheck(config);
    const result = await check.run(createContext(), "/tmp");

    expect(result.status).toBe("failure");
    expect(result.summary).toContain("1 error");
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0].message).toBe("Variable is unused");
  });

  it("should respect failureThreshold", async () => {
    mock.module("../src/lint-runner.js", () => ({
      runLintTools: mock(async () => [
        {
          tool: "eslint",
          exitCode: 1,
          success: true,
          errors: [
            {
              file: "src/file.ts",
              line: 10,
              column: 5,
              message: "Error 1",
              severity: "error" as const,
            },
          ],
          warnings: [],
          stdout: "",
          stderr: "",
        },
      ]),
    }));

    const config: LintConfig = {
      enabled: true,
      required: true,
      timeout: 60000,
      tools: [
        {
          name: "eslint",
          command: "npx eslint . --format json",
          enabled: true,
        },
      ],
      failureThreshold: 5, // Allow up to 4 errors
    };

    const check = new LintCheck(config);
    const result = await check.run(createContext(), "/tmp");

    // 1 error < 5 threshold, should succeed
    expect(result.status).toBe("success");
  });

  it("should aggregate results from multiple tools", async () => {
    mock.module("../src/lint-runner.js", () => ({
      runLintTools: mock(async () => [
        {
          tool: "eslint",
          exitCode: 1,
          success: true,
          errors: [
            {
              file: "src/file1.ts",
              message: "Error from eslint",
              severity: "error" as const,
            },
          ],
          warnings: [],
          stdout: "",
          stderr: "",
        },
        {
          tool: "prettier",
          exitCode: 1,
          success: false,
          errors: [
            {
              file: "src/file2.ts",
              message: "File needs formatting",
              severity: "error" as const,
            },
          ],
          warnings: [],
          stdout: "",
          stderr: "",
        },
      ]),
    }));

    const config: LintConfig = {
      enabled: true,
      required: true,
      timeout: 60000,
      tools: [
        {
          name: "eslint",
          command: "npx eslint . --format json",
          enabled: true,
        },
        {
          name: "prettier",
          command: "npx prettier --check .",
          enabled: true,
        },
      ],
      failureThreshold: 0,
    };

    const check = new LintCheck(config);
    const result = await check.run(createContext(), "/tmp");

    expect(result.status).toBe("failure");
    expect(result.errors).toHaveLength(2);
    expect(result.summary).toContain("2 errors");
  });

  it("should include warnings in summary", async () => {
    mock.module("../src/lint-runner.js", () => ({
      runLintTools: mock(async () => [
        {
          tool: "eslint",
          exitCode: 0,
          success: true,
          errors: [],
          warnings: [
            {
              file: "src/file.ts",
              message: "Warning message",
              severity: "warning" as const,
            },
          ],
          stdout: "",
          stderr: "",
        },
      ]),
    }));

    const config: LintConfig = {
      enabled: true,
      required: true,
      timeout: 60000,
      tools: [
        {
          name: "eslint",
          command: "npx eslint . --format json",
          enabled: true,
        },
      ],
      failureThreshold: 0,
    };

    const check = new LintCheck(config);
    const result = await check.run(createContext(), "/tmp");

    // No errors, so should succeed even with warnings
    expect(result.status).toBe("success");
    expect(result.warnings).toHaveLength(1);
    expect(result.summary).toContain("passed");
  });

  it("should handle timeout", async () => {
    mock.module("../src/lint-runner.js", () => ({
      runLintTools: mock(
        async () =>
          new Promise((resolve) => {
            // Never resolve to simulate timeout
          })
      ),
    }));

    const config: LintConfig = {
      enabled: true,
      required: true,
      timeout: 100, // Very short timeout
      tools: [
        {
          name: "eslint",
          command: "npx eslint . --format json",
          enabled: true,
        },
      ],
      failureThreshold: 0,
    };

    const check = new LintCheck(config);
    const result = await check.run(createContext(), "/tmp");

    expect(result.status).toBe("error");
    expect(result.summary).toContain("error");
    expect(result.details).toContain("timed out");
  });

  it("should return correct check name", () => {
    const config: LintConfig = {
      enabled: true,
      required: true,
      timeout: 60000,
      tools: [],
      failureThreshold: 0,
    };

    const check = new LintCheck(config);
    expect(check.getName()).toBe("lint");
  });

  it("should respect required flag", () => {
    const requiredConfig: LintConfig = {
      enabled: true,
      required: true,
      timeout: 60000,
      tools: [],
      failureThreshold: 0,
    };

    const optionalConfig: LintConfig = {
      enabled: true,
      required: false,
      timeout: 60000,
      tools: [],
      failureThreshold: 0,
    };

    const requiredCheck = new LintCheck(requiredConfig);
    const optionalCheck = new LintCheck(optionalConfig);

    expect(requiredCheck.isRequired()).toBe(true);
    expect(optionalCheck.isRequired()).toBe(false);
  });
});
