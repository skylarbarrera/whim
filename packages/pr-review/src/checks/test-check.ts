import type { CheckResult, PRContext } from "@factory/shared";
import { BaseCheck } from "./base-check.js";
import type { TestConfig } from "../config.js";
import { runTests } from "../test-runner.js";

/**
 * Test check that runs configured test suite
 */
export class TestCheck extends BaseCheck {
  private testConfig: TestConfig;

  constructor(config: TestConfig) {
    super(config);
    this.testConfig = config;
  }

  getName(): string {
    return "test";
  }

  protected async runCheck(
    _context: PRContext,
    workdir: string
  ): Promise<CheckResult> {
    const startTime = Date.now();

    try {
      // Run the test command
      const result = await runTests(
        this.testConfig.command,
        workdir,
        this.testConfig.timeout
      );

      // Determine status based on pass percentage
      const meetsThreshold =
        result.stats.passPercentage >= this.testConfig.minPassPercentage;

      const status = result.success && meetsThreshold ? "success" : "failure";

      // Generate summary
      const summary = this.generateSummary(result);

      // Generate detailed report
      const details = this.generateDetails(result);

      const duration = Date.now() - startTime;

      return {
        status,
        summary,
        details,
        errors: result.errors,
        warnings: result.warnings,
        duration,
        metadata: {
          exitCode: result.exitCode,
          stats: result.stats,
          failureCount: result.failures.length,
          minPassPercentage: this.testConfig.minPassPercentage,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);

      return {
        status: "error",
        summary: "Test execution failed with error",
        details: message,
        duration,
        metadata: { error: message },
      };
    }
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(result: {
    success: boolean;
    stats: {
      total: number;
      passed: number;
      failed: number;
      skipped: number;
      passPercentage: number;
    };
    failures: unknown[];
  }): string {
    const { stats } = result;

    if (stats.total === 0) {
      return "No tests found or tests did not execute";
    }

    if (stats.failed === 0) {
      const parts = [`${stats.passed} test${stats.passed === 1 ? "" : "s"} passed`];

      if (stats.skipped > 0) {
        parts.push(`${stats.skipped} skipped`);
      }

      return parts.join(", ");
    }

    // Has failures
    const parts = [];

    if (stats.failed > 0) {
      parts.push(`${stats.failed} test${stats.failed === 1 ? "" : "s"} failed`);
    }

    if (stats.passed > 0) {
      parts.push(`${stats.passed} passed`);
    }

    if (stats.skipped > 0) {
      parts.push(`${stats.skipped} skipped`);
    }

    const percentage = stats.passPercentage.toFixed(1);
    return `${parts.join(", ")} (${percentage}% pass rate)`;
  }

  /**
   * Generate detailed report
   */
  private generateDetails(result: {
    exitCode: number;
    success: boolean;
    stats: {
      total: number;
      passed: number;
      failed: number;
      skipped: number;
      passPercentage: number;
    };
    failures: Array<{
      name: string;
      message: string;
      stack?: string;
      file?: string;
      line?: number;
    }>;
    stdout: string;
    stderr: string;
  }): string {
    const lines: string[] = [];

    lines.push("## Test Results");
    lines.push(`Exit code: ${result.exitCode}`);
    lines.push(`Status: ${result.success ? "✓ Success" : "✗ Failed"}`);

    // Statistics
    lines.push("\n### Statistics");
    lines.push(`- Total: ${result.stats.total}`);
    lines.push(`- Passed: ${result.stats.passed}`);
    lines.push(`- Failed: ${result.stats.failed}`);
    lines.push(`- Skipped: ${result.stats.skipped}`);
    lines.push(
      `- Pass Rate: ${result.stats.passPercentage.toFixed(1)}%`
    );
    lines.push(
      `- Required: ${this.testConfig.minPassPercentage}%`
    );

    // Failed tests
    if (result.failures.length > 0) {
      lines.push(`\n### Failed Tests (${result.failures.length})`);

      for (const failure of result.failures) {
        const location = failure.file
          ? `${failure.file}${failure.line ? `:${failure.line}` : ""}`
          : "";

        lines.push(`\n#### ${failure.name}`);

        if (location) {
          lines.push(`Location: ${location}`);
        }

        lines.push(`\n${failure.message}`);

        if (failure.stack) {
          lines.push("\n```");
          lines.push(failure.stack);
          lines.push("```");
        }
      }
    }

    // Include stderr if there were errors
    if (!result.success && result.stderr) {
      lines.push("\n### Error Output");
      lines.push("```");
      lines.push(result.stderr.trim());
      lines.push("```");
    }

    // Include partial stdout if helpful
    if (result.stdout && result.stdout.length < 5000) {
      lines.push("\n### Test Output");
      lines.push("```");
      lines.push(result.stdout.trim());
      lines.push("```");
    } else if (result.stdout && result.stdout.length >= 5000) {
      lines.push("\n### Test Output (truncated)");
      lines.push("```");
      lines.push(result.stdout.substring(0, 5000).trim() + "\n... (output truncated)");
      lines.push("```");
    }

    return lines.join("\n");
  }
}
