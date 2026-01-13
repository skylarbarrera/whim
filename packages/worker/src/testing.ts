import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Result of running tests
 */
export interface TestResult {
  status: "passed" | "failed" | "timeout" | "skipped" | "error";
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  duration: number;
  stdout: string;
  stderr: string;
  error?: string;
}

/**
 * Options for running tests
 */
export interface TestOptions {
  /** Timeout in milliseconds (default: 5 minutes) */
  timeout?: number;
  /** Command to run (default: "npm test") */
  command?: string;
  /** Arguments for the command */
  args?: string[];
}

const DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a project has a test script defined
 */
export async function hasTestScript(repoDir: string): Promise<boolean> {
  try {
    const packageJsonPath = join(repoDir, "package.json");
    await access(packageJsonPath);
    const content = await readFile(packageJsonPath, "utf-8");
    const pkg = JSON.parse(content);
    return !!(pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1');
  } catch {
    return false;
  }
}

/**
 * Parse test output to extract counts
 * Supports Jest, Vitest, and common test runners
 */
export function parseTestOutput(stdout: string, stderr: string): {
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
} {
  const output = stdout + "\n" + stderr;

  // Jest format: "Tests: X passed, Y total" or "X passed, Y failed, Z total"
  const jestMatch = output.match(/Tests:\s+(?:(\d+)\s+passed)?(?:,\s*)?(?:(\d+)\s+failed)?(?:,\s*)?(\d+)\s+total/i);
  if (jestMatch) {
    const passed = parseInt(jestMatch[1] || "0", 10);
    const failed = parseInt(jestMatch[2] || "0", 10);
    const total = parseInt(jestMatch[3] || "0", 10);
    return { testsRun: total, testsPassed: passed, testsFailed: failed };
  }

  // Vitest format: "Tests  X passed (Y)" or "X passed | Y failed | Z total"
  const vitestMatch = output.match(/(\d+)\s+passed.*?(\d+)\s+failed.*?(\d+)\s+total/i) ||
                      output.match(/Tests\s+(\d+)\s+passed/i);
  if (vitestMatch) {
    if (vitestMatch[3] !== undefined) {
      return {
        testsRun: parseInt(vitestMatch[3], 10),
        testsPassed: parseInt(vitestMatch[1] ?? "0", 10),
        testsFailed: parseInt(vitestMatch[2] ?? "0", 10),
      };
    }
    const passed = parseInt(vitestMatch[1] ?? "0", 10);
    return { testsRun: passed, testsPassed: passed, testsFailed: 0 };
  }

  // Bun test format: "X pass, Y fail, Z total"
  const bunMatch = output.match(/(\d+)\s+pass.*?(\d+)\s+fail.*?(\d+)\s+total/i);
  if (bunMatch) {
    return {
      testsRun: parseInt(bunMatch[3] ?? "0", 10),
      testsPassed: parseInt(bunMatch[1] ?? "0", 10),
      testsFailed: parseInt(bunMatch[2] ?? "0", 10),
    };
  }

  // Generic: count "PASS" and "FAIL" occurrences
  const passCount = (output.match(/\bPASS\b/gi) || []).length;
  const failCount = (output.match(/\bFAIL\b/gi) || []).length;
  if (passCount > 0 || failCount > 0) {
    return {
      testsRun: passCount + failCount,
      testsPassed: passCount,
      testsFailed: failCount,
    };
  }

  // Fallback: no recognizable test output
  return { testsRun: 0, testsPassed: 0, testsFailed: 0 };
}

/**
 * Run tests in a repository with timeout
 */
export async function runTests(
  repoDir: string,
  options: TestOptions = {}
): Promise<TestResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const command = options.command ?? "npm";
  const args = options.args ?? ["test"];

  // Check if tests are available
  if (command === "npm" && args[0] === "test") {
    const hasTests = await hasTestScript(repoDir);
    if (!hasTests) {
      return {
        status: "skipped",
        testsRun: 0,
        testsPassed: 0,
        testsFailed: 0,
        duration: 0,
        stdout: "",
        stderr: "",
        error: "No test script defined in package.json",
      };
    }
  }

  const startTime = Date.now();
  let stdout = "";
  let stderr = "";
  let timedOut = false;

  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: repoDir,
      shell: true,
      env: {
        ...process.env,
        CI: "true", // Many test runners behave better with CI=true
        FORCE_COLOR: "0", // Disable colors for easier parsing
      },
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      // Force kill after 5 seconds if SIGTERM didn't work
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      }, 5000);
    }, timeout);

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timeoutHandle);
      const duration = Date.now() - startTime;

      if (timedOut) {
        resolve({
          status: "timeout",
          testsRun: 0,
          testsPassed: 0,
          testsFailed: 0,
          duration,
          stdout,
          stderr,
          error: `Test execution timed out after ${timeout}ms`,
        });
        return;
      }

      const parsed = parseTestOutput(stdout, stderr);

      if (code === 0) {
        resolve({
          status: "passed",
          ...parsed,
          duration,
          stdout,
          stderr,
        });
      } else {
        resolve({
          status: "failed",
          ...parsed,
          duration,
          stdout,
          stderr,
          error: `Tests exited with code ${code}`,
        });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeoutHandle);
      resolve({
        status: "error",
        testsRun: 0,
        testsPassed: 0,
        testsFailed: 0,
        duration: Date.now() - startTime,
        stdout,
        stderr,
        error: err.message,
      });
    });
  });
}
