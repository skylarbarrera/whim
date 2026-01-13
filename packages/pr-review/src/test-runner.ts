// @ts-ignore - Node.js types may not be available in all environments
import { spawn } from "child_process";
import type { CheckError, CheckWarning } from "@factory/shared";

// Type declarations for Node.js globals
declare const process: { env: Record<string, string | undefined> };
declare const Buffer: any;

/**
 * Test execution statistics
 */
export interface TestStats {
  /** Total tests found */
  total: number;
  /** Tests that passed */
  passed: number;
  /** Tests that failed */
  failed: number;
  /** Tests that were skipped */
  skipped: number;
  /** Pass percentage (0-100) */
  passPercentage: number;
}

/**
 * Information about a failed test
 */
export interface TestFailure {
  /** Test name or description */
  name: string;
  /** Error message */
  message: string;
  /** Stack trace if available */
  stack?: string;
  /** File where test is located */
  file?: string;
  /** Line number in file */
  line?: number;
}

/**
 * Result from running tests
 */
export interface TestResult {
  /** Exit code */
  exitCode: number;
  /** Whether tests ran successfully (exit code 0) */
  success: boolean;
  /** Test execution statistics */
  stats: TestStats;
  /** List of test failures */
  failures: TestFailure[];
  /** Errors encountered (not test failures) */
  errors: CheckError[];
  /** Warnings if any */
  warnings: CheckWarning[];
  /** Raw stdout */
  stdout: string;
  /** Raw stderr */
  stderr: string;
}

/**
 * Execute test command and parse the results
 *
 * @param command - Test command to execute (e.g., "npm test", "bun test")
 * @param workdir - Working directory where the repo is checked out
 * @param timeout - Maximum execution time in milliseconds
 * @returns TestResult with statistics and failures
 */
export async function runTests(
  command: string,
  workdir: string,
  timeout: number
): Promise<TestResult> {
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
          exitCode: -1,
          success: false,
          stats: {
            total: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            passPercentage: 0,
          },
          failures: [],
          errors: [
            {
              message: `Tests timed out after ${timeout}ms`,
              severity: "error",
            },
          ],
          warnings: [],
          stdout,
          stderr,
        });
        return;
      }

      // Parse output to extract test results
      const parseResult = parseTestOutput(stdout, stderr);

      resolve({
        exitCode: code || 0,
        success: code === 0,
        ...parseResult,
        stdout,
        stderr,
      });
    });

    // Handle spawn errors
    proc.on("error", (err: Error) => {
      clearTimeout(timer);
      resolve({
        exitCode: -1,
        success: false,
        stats: {
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          passPercentage: 0,
        },
        failures: [],
        errors: [
          {
            message: `Failed to run tests: ${err.message}`,
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
 * Parse test output to extract statistics and failures
 *
 * Supports Jest, Vitest, Bun test, and generic test output formats
 */
export function parseTestOutput(
  stdout: string,
  stderr: string
): {
  stats: TestStats;
  failures: TestFailure[];
  errors: CheckError[];
  warnings: CheckWarning[];
} {
  const errors: CheckError[] = [];
  const warnings: CheckWarning[] = [];
  const failures: TestFailure[] = [];

  let stats: TestStats = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    passPercentage: 0,
  };

  // Try to parse as Jest/Vitest JSON output first
  if (stdout.trim().startsWith("{") || stdout.trim().startsWith("[")) {
    try {
      const parsed = parseJSONTestOutput(stdout);
      if (parsed) {
        return { ...parsed, errors, warnings };
      }
    } catch {
      // Not JSON or malformed, continue with text parsing
    }
  }

  // Parse text output
  const allOutput = stdout + "\n" + stderr;

  // Jest text format: "Tests: 1 failed, 2 passed, 3 total"
  const jestMatch =
    /Tests:\s+(?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+passed,?\s*)?(?:(\d+)\s+skipped,?\s*)?(\d+)\s+total/i.exec(
      allOutput
    );
  if (jestMatch && jestMatch[4]) {
    const failed = parseInt(jestMatch[1] || "0", 10);
    const passed = parseInt(jestMatch[2] || "0", 10);
    const skipped = parseInt(jestMatch[3] || "0", 10);
    const total = parseInt(jestMatch[4], 10);

    stats = {
      total,
      passed,
      failed,
      skipped,
      passPercentage: total > 0 ? (passed / total) * 100 : 0,
    };

    // Extract failure details from Jest output
    failures.push(...extractJestFailures(allOutput));
  }
  // Vitest text format: "Test Files  1 passed | 1 failed (2)"
  else if (allOutput.match(/Test Files\s+\d+/i)) {
    const vitestStats = parseVitestText(allOutput);
    stats = vitestStats.stats;
    failures.push(...vitestStats.failures);
  }
  // Bun test format: "1 pass, 0 fail"
  else if (allOutput.match(/\d+\s+pass/i)) {
    const bunStats = parseBunTestOutput(allOutput);
    stats = bunStats.stats;
    failures.push(...bunStats.failures);
  }
  // Generic fallback: look for common patterns
  else {
    const genericStats = parseGenericTestOutput(allOutput);
    stats = genericStats.stats;
    failures.push(...genericStats.failures);
  }

  // If we couldn't parse any test results, create a generic error
  if (stats.total === 0 && stderr.length > 0) {
    errors.push({
      message: `Test execution error: ${stderr.trim()}`,
      severity: "error",
    });
  }

  return { stats, failures, errors, warnings };
}

/**
 * Parse Jest/Vitest JSON output
 */
function parseJSONTestOutput(output: string): {
  stats: TestStats;
  failures: TestFailure[];
} | null {
  try {
    const json = JSON.parse(output);

    // Jest JSON format
    if (json.numTotalTests !== undefined) {
      const total = json.numTotalTests || 0;
      const passed = json.numPassedTests || 0;
      const failed = json.numFailedTests || 0;
      const skipped = json.numPendingTests || 0;

      const failures: TestFailure[] = [];

      // Extract failure details
      if (json.testResults) {
        for (const file of json.testResults) {
          for (const test of file.assertionResults || []) {
            if (test.status === "failed") {
              failures.push({
                name: test.fullName || test.title,
                message: test.failureMessages?.[0] || "Test failed",
                file: file.name,
              });
            }
          }
        }
      }

      return {
        stats: {
          total,
          passed,
          failed,
          skipped,
          passPercentage: total > 0 ? (passed / total) * 100 : 0,
        },
        failures,
      };
    }

    // Vitest JSON format (similar to Jest)
    if (json.numTests !== undefined) {
      const total = json.numTests || 0;
      const passed = json.numPassedTests || 0;
      const failed = json.numFailedTests || 0;
      const skipped = json.numPendingTests || 0;

      return {
        stats: {
          total,
          passed,
          failed,
          skipped,
          passPercentage: total > 0 ? (passed / total) * 100 : 0,
        },
        failures: [], // TODO: extract from vitest JSON
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract failure details from Jest text output
 */
function extractJestFailures(output: string): TestFailure[] {
  const failures: TestFailure[] = [];
  const lines = output.split("\n");

  let inFailureBlock = false;
  let currentFailure: Partial<TestFailure> = {};

  for (const line of lines) {
    // Jest failure starts with "●" or "✕"
    if (line.match(/^\s*[●✕]/)) {
      if (currentFailure.name) {
        failures.push(currentFailure as TestFailure);
      }
      inFailureBlock = true;
      currentFailure = {
        name: line.replace(/^\s*[●✕]\s*/, "").trim(),
        message: "",
      };
    } else if (inFailureBlock && line.trim().length > 0) {
      // Collect error message lines
      if (!currentFailure.message) {
        currentFailure.message = line.trim();
      } else {
        currentFailure.message += "\n" + line.trim();
      }
    } else if (inFailureBlock && line.trim().length === 0) {
      inFailureBlock = false;
    }
  }

  if (currentFailure.name) {
    failures.push(currentFailure as TestFailure);
  }

  return failures;
}

/**
 * Parse Vitest text output
 */
function parseVitestText(
  output: string
): { stats: TestStats; failures: TestFailure[] } {
  const failures: TestFailure[] = [];

  // Extract test file stats: "Test Files  1 passed | 1 failed (2)"
  const fileMatch =
    /Test Files\s+(?:(\d+)\s+passed)?\s*\|?\s*(?:(\d+)\s+failed)?/i.exec(
      output
    );
  const passedFiles = parseInt(fileMatch?.[1] || "0", 10);
  const failedFiles = parseInt(fileMatch?.[2] || "0", 10);

  // Extract test stats: "Tests  5 passed | 2 failed (7)"
  const testMatch =
    /Tests\s+(?:(\d+)\s+passed)?\s*\|?\s*(?:(\d+)\s+failed)?\s*\((\d+)\)/i.exec(
      output
    );
  const passed = parseInt(testMatch?.[1] || "0", 10);
  const failed = parseInt(testMatch?.[2] || "0", 10);
  const total = parseInt(testMatch?.[3] || "0", 10);
  const skipped = total - passed - failed;

  // Extract failures
  const lines = output.split("\n");
  for (const line of lines) {
    if (line.match(/^\s*❯/)) {
      // Vitest failure marker
      failures.push({
        name: line.replace(/^\s*❯\s*/, "").trim(),
        message: "Test failed",
      });
    }
  }

  return {
    stats: {
      total,
      passed,
      failed,
      skipped: Math.max(0, skipped),
      passPercentage: total > 0 ? (passed / total) * 100 : 0,
    },
    failures,
  };
}

/**
 * Parse Bun test output
 */
function parseBunTestOutput(
  output: string
): { stats: TestStats; failures: TestFailure[] } {
  const failures: TestFailure[] = [];

  // Bun format: "1 pass, 0 fail" or "5 pass, 2 fail, 1 skip"
  const match =
    /(\d+)\s+pass(?:,\s*(\d+)\s+fail)?(?:,\s*(\d+)\s+skip)?/i.exec(output);
  if (match && match[1]) {
    const passed = parseInt(match[1], 10);
    const failed = parseInt(match[2] || "0", 10);
    const skipped = parseInt(match[3] || "0", 10);
    const total = passed + failed + skipped;

    return {
      stats: {
        total,
        passed,
        failed,
        skipped,
        passPercentage: total > 0 ? (passed / total) * 100 : 0,
      },
      failures,
    };
  }

  return {
    stats: {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      passPercentage: 0,
    },
    failures,
  };
}

/**
 * Generic test output parser for unknown test runners
 */
function parseGenericTestOutput(
  output: string
): { stats: TestStats; failures: TestFailure[] } {
  const failures: TestFailure[] = [];

  // Look for common patterns like:
  // - "passed: 5"
  // - "failed: 2"
  // - "total: 7"
  const passedMatch = /passed[:=\s]+(\d+)/i.exec(output);
  const failedMatch = /failed[:=\s]+(\d+)/i.exec(output);
  const totalMatch = /total[:=\s]+(\d+)/i.exec(output);
  const skippedMatch = /(?:skipped|pending)[:=\s]+(\d+)/i.exec(output);

  const passed = passedMatch && passedMatch[1] ? parseInt(passedMatch[1], 10) : 0;
  const failed = failedMatch && failedMatch[1] ? parseInt(failedMatch[1], 10) : 0;
  const total = totalMatch && totalMatch[1]
    ? parseInt(totalMatch[1], 10)
    : passed + failed;
  const skipped = skippedMatch && skippedMatch[1] ? parseInt(skippedMatch[1], 10) : 0;

  return {
    stats: {
      total,
      passed,
      failed,
      skipped,
      passPercentage: total > 0 ? (passed / total) * 100 : 0,
    },
    failures,
  };
}
