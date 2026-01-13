// @ts-ignore - Node.js types may not be available in all environments
import { spawn } from "child_process";
import type { CheckError, CheckWarning } from "@factory/shared";

// Type declarations for Node.js globals
declare const process: { env: Record<string, string | undefined> };
declare const Buffer: any;

/**
 * Result from running a lint tool
 */
export interface LintResult {
  /** Tool name */
  tool: string;
  /** Exit code */
  exitCode: number;
  /** Whether the tool ran successfully (exit code 0 or 1 for eslint) */
  success: boolean;
  /** Errors found by the linter */
  errors: CheckError[];
  /** Warnings found by the linter */
  warnings: CheckWarning[];
  /** Raw stdout */
  stdout: string;
  /** Raw stderr */
  stderr: string;
}

/**
 * ESLint JSON output format
 */
interface ESLintResult {
  filePath: string;
  messages: Array<{
    ruleId: string | null;
    severity: 1 | 2; // 1 = warning, 2 = error
    message: string;
    line: number;
    column: number;
  }>;
  errorCount: number;
  warningCount: number;
}

/**
 * Execute a lint tool and parse the results
 *
 * @param tool - Tool name (e.g., "eslint", "prettier")
 * @param command - Command to execute (e.g., "npx eslint . --format json")
 * @param workdir - Working directory where the repo is checked out
 * @param timeout - Maximum execution time in milliseconds
 * @returns LintResult with errors and warnings
 */
export async function runLintTool(
  tool: string,
  command: string,
  workdir: string,
  timeout: number
): Promise<LintResult> {
  return new Promise((resolve) => {
    // Parse command into parts
    const parts = command.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // Spawn the process
    const proc = spawn(cmd, args, {
      cwd: workdir,
      shell: true,
      env: { ...process.env },
    });

    // Set up timeout
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, timeout);

    // Collect stdout
    proc.stdout?.on("data", (data: any) => {
      stdout += data.toString();
    });

    // Collect stderr
    proc.stderr?.on("data", (data: any) => {
      stderr += data.toString();
    });

    // Handle process exit
    proc.on("close", (code: number | null) => {
      clearTimeout(timer);

      if (timedOut) {
        resolve({
          tool,
          exitCode: -1,
          success: false,
          errors: [
            {
              message: `Lint tool '${tool}' timed out after ${timeout}ms`,
              severity: "error",
            },
          ],
          warnings: [],
          stdout,
          stderr,
        });
        return;
      }

      // Parse output based on tool
      const { errors, warnings } = parseOutput(tool, stdout, stderr);

      resolve({
        tool,
        exitCode: code || 0,
        success: code === 0 || (tool === "eslint" && code === 1), // eslint exits 1 on violations
        errors,
        warnings,
        stdout,
        stderr,
      });
    });

    // Handle spawn errors
    proc.on("error", (err: Error) => {
      clearTimeout(timer);
      resolve({
        tool,
        exitCode: -1,
        success: false,
        errors: [
          {
            message: `Failed to run lint tool '${tool}': ${err.message}`,
            severity: "error",
          },
        ],
        warnings: [],
        stdout,
        stderr,
      });
    });
  });
}

/**
 * Parse lint tool output to structured errors and warnings
 */
function parseOutput(
  tool: string,
  stdout: string,
  stderr: string
): { errors: CheckError[]; warnings: CheckWarning[] } {
  const errors: CheckError[] = [];
  const warnings: CheckWarning[] = [];

  try {
    if (tool === "eslint") {
      // ESLint outputs JSON with --format json
      const results = JSON.parse(stdout) as ESLintResult[];

      for (const result of results) {
        const file = result.filePath;

        for (const msg of result.messages) {
          const violation = {
            file,
            line: msg.line,
            column: msg.column,
            message: msg.message,
            rule: msg.ruleId || undefined,
          };

          if (msg.severity === 2) {
            errors.push({ ...violation, severity: "error" });
          } else {
            warnings.push({ ...violation, severity: "warning" });
          }
        }
      }
    } else if (tool === "prettier") {
      // Prettier outputs list of files that need formatting
      // Each line is a file path
      const lines = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      for (const file of lines) {
        errors.push({
          file,
          message: "File needs formatting",
          rule: "prettier",
          severity: "error",
        });
      }
    } else {
      // Generic parser for unknown tools
      // Look for lines with file:line:column format
      const pattern = /^(.+?):(\d+):(\d+):\s*(.+)$/;
      const lines = (stdout + "\n" + stderr).split("\n");

      for (const line of lines) {
        const match = pattern.exec(line);
        if (match && match[1] && match[2] && match[3] && match[4]) {
          errors.push({
            file: match[1],
            line: parseInt(match[2], 10),
            column: parseInt(match[3], 10),
            message: match[4],
            severity: "error",
          });
        }
      }

      // If no structured output found, create a generic error
      if (errors.length === 0 && stderr.length > 0) {
        errors.push({
          message: stderr.trim(),
          severity: "error",
        });
      }
    }
  } catch (err) {
    // If parsing fails, create a generic error
    errors.push({
      message: `Failed to parse ${tool} output: ${
        err instanceof Error ? err.message : String(err)
      }`,
      severity: "error",
    });
  }

  return { errors, warnings };
}

/**
 * Run multiple lint tools in parallel
 *
 * @param tools - List of tool configurations
 * @param workdir - Working directory
 * @param timeout - Timeout per tool
 * @returns Array of LintResults
 */
export async function runLintTools(
  tools: Array<{ name: string; command: string; enabled: boolean }>,
  workdir: string,
  timeout: number
): Promise<LintResult[]> {
  const enabledTools = tools.filter((t) => t.enabled);

  const promises = enabledTools.map((tool) =>
    runLintTool(tool.name, tool.command, workdir, timeout)
  );

  return Promise.all(promises);
}
