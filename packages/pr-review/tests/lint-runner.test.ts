import { describe, it, expect, mock } from "bun:test";
import { spawn } from "child_process";
import { runLintTool, runLintTools } from "../src/lint-runner.js";
import { EventEmitter } from "events";

// Mock child_process.spawn
mock.module("child_process", () => ({
  spawn: mock(() => {
    const mockProcess = new EventEmitter();
    (mockProcess as any).stdout = new EventEmitter();
    (mockProcess as any).stderr = new EventEmitter();
    (mockProcess as any).kill = mock(() => {});
    return mockProcess;
  }),
}));

describe("LintRunner", () => {
  it("should parse ESLint JSON output", async () => {
    const eslintOutput = JSON.stringify([
      {
        filePath: "/path/to/file.ts",
        messages: [
          {
            ruleId: "no-unused-vars",
            severity: 2,
            message: "Variable is unused",
            line: 10,
            column: 5,
          },
          {
            ruleId: "no-console",
            severity: 1,
            message: "Unexpected console statement",
            line: 20,
            column: 3,
          },
        ],
        errorCount: 1,
        warningCount: 1,
      },
    ]);

    // Mock spawn to return eslint output
    const mockSpawn = spawn as any;
    mockSpawn.mockImplementation(() => {
      const proc = new EventEmitter();
      (proc as any).stdout = new EventEmitter();
      (proc as any).stderr = new EventEmitter();
      (proc as any).kill = mock(() => {});

      setTimeout(() => {
        (proc as any).stdout.emit("data", eslintOutput);
        proc.emit("close", 1); // eslint exits with 1 on violations
      }, 10);

      return proc;
    });

    const result = await runLintTool("eslint", "npx eslint . --format json", "/tmp", 5000);

    expect(result.tool).toBe("eslint");
    expect(result.exitCode).toBe(1);
    expect(result.success).toBe(true); // eslint with exit code 1 is success (violations found)
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe("Variable is unused");
    expect(result.errors[0].rule).toBe("no-unused-vars");
    expect(result.errors[0].line).toBe(10);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toBe("Unexpected console statement");
    expect(result.warnings[0].rule).toBe("no-console");
  });

  it("should parse Prettier text output", async () => {
    const prettierOutput = "/path/to/file1.ts\n/path/to/file2.ts\n";

    const mockSpawn = spawn as any;
    mockSpawn.mockImplementation(() => {
      const proc = new EventEmitter();
      (proc as any).stdout = new EventEmitter();
      (proc as any).stderr = new EventEmitter();
      (proc as any).kill = mock(() => {});

      setTimeout(() => {
        (proc as any).stdout.emit("data", prettierOutput);
        proc.emit("close", 1); // prettier exits with 1 when files need formatting
      }, 10);

      return proc;
    });

    const result = await runLintTool("prettier", "npx prettier --check .", "/tmp", 5000);

    expect(result.tool).toBe("prettier");
    expect(result.exitCode).toBe(1);
    expect(result.success).toBe(false); // prettier with exit code 1 is failure
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].file).toBe("/path/to/file1.ts");
    expect(result.errors[0].message).toBe("File needs formatting");
    expect(result.errors[1].file).toBe("/path/to/file2.ts");
  });

  it("should handle timeout", async () => {
    const mockSpawn = spawn as any;
    mockSpawn.mockImplementation(() => {
      const proc = new EventEmitter();
      (proc as any).stdout = new EventEmitter();
      (proc as any).stderr = new EventEmitter();
      (proc as any).kill = mock(() => {
        proc.emit("close", -1);
      });

      // Don't emit close event to simulate hanging process
      return proc;
    });

    const result = await runLintTool("eslint", "npx eslint .", "/tmp", 100);

    expect(result.exitCode).toBe(-1);
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("timed out");
  });

  it("should handle spawn errors", async () => {
    const mockSpawn = spawn as any;
    mockSpawn.mockImplementation(() => {
      const proc = new EventEmitter();
      (proc as any).stdout = new EventEmitter();
      (proc as any).stderr = new EventEmitter();
      (proc as any).kill = mock(() => {});

      setTimeout(() => {
        proc.emit("error", new Error("Command not found"));
      }, 10);

      return proc;
    });

    const result = await runLintTool("eslint", "npx eslint .", "/tmp", 5000);

    expect(result.exitCode).toBe(-1);
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("Command not found");
  });

  it("should run multiple lint tools in parallel", async () => {
    const mockSpawn = spawn as any;
    mockSpawn.mockImplementation(() => {
      const proc = new EventEmitter();
      (proc as any).stdout = new EventEmitter();
      (proc as any).stderr = new EventEmitter();
      (proc as any).kill = mock(() => {});

      setTimeout(() => {
        proc.emit("close", 0);
      }, 10);

      return proc;
    });

    const tools = [
      { name: "eslint", command: "npx eslint .", enabled: true },
      { name: "prettier", command: "npx prettier --check .", enabled: true },
    ];

    const results = await runLintTools(tools, "/tmp", 5000);

    expect(results).toHaveLength(2);
    expect(results[0].tool).toBe("eslint");
    expect(results[1].tool).toBe("prettier");
  });

  it("should skip disabled tools", async () => {
    const tools = [
      { name: "eslint", command: "npx eslint .", enabled: true },
      { name: "prettier", command: "npx prettier --check .", enabled: false },
    ];

    const mockSpawn = spawn as any;
    mockSpawn.mockImplementation(() => {
      const proc = new EventEmitter();
      (proc as any).stdout = new EventEmitter();
      (proc as any).stderr = new EventEmitter();
      (proc as any).kill = mock(() => {});

      setTimeout(() => {
        proc.emit("close", 0);
      }, 10);

      return proc;
    });

    const results = await runLintTools(tools, "/tmp", 5000);

    expect(results).toHaveLength(1);
    expect(results[0].tool).toBe("eslint");
  });

  it("should handle malformed ESLint JSON output", async () => {
    const mockSpawn = spawn as any;
    mockSpawn.mockImplementation(() => {
      const proc = new EventEmitter();
      (proc as any).stdout = new EventEmitter();
      (proc as any).stderr = new EventEmitter();
      (proc as any).kill = mock(() => {});

      setTimeout(() => {
        (proc as any).stdout.emit("data", "invalid json {");
        proc.emit("close", 1);
      }, 10);

      return proc;
    });

    const result = await runLintTool("eslint", "npx eslint . --format json", "/tmp", 5000);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("Failed to parse");
  });
});
