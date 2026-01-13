import type { CheckResult, PRContext } from "@factory/shared";
import { BaseCheck } from "./base-check.js";
import type { LintConfig } from "../config.js";
import { runLintTools } from "../lint-runner.js";

/**
 * Lint check that runs configured lint tools
 */
export class LintCheck extends BaseCheck {
  private lintConfig: LintConfig;

  constructor(config: LintConfig) {
    super(config);
    this.lintConfig = config;
  }

  getName(): string {
    return "lint";
  }

  protected async runCheck(
    _context: PRContext,
    workdir: string
  ): Promise<CheckResult> {
    const startTime = Date.now();

    try {
      // Run all configured lint tools
      const results = await runLintTools(
        this.lintConfig.tools,
        workdir,
        this.lintConfig.timeout
      );

      // Aggregate errors and warnings
      const allErrors = results.flatMap((r) => r.errors);
      const allWarnings = results.flatMap((r) => r.warnings);
      const totalViolations = allErrors.length + allWarnings.length;

      // Determine status based on failure threshold
      const status =
        allErrors.length >= this.lintConfig.failureThreshold
          ? "failure"
          : "success";

      // Generate summary
      const summary = this.generateSummary(results, totalViolations);

      // Generate detailed report
      const details = this.generateDetails(results);

      const duration = Date.now() - startTime;

      return {
        status,
        summary,
        details,
        errors: allErrors,
        warnings: allWarnings,
        duration,
        metadata: {
          tools: results.map((r) => ({
            name: r.tool,
            exitCode: r.exitCode,
            errorCount: r.errors.length,
            warningCount: r.warnings.length,
          })),
          threshold: this.lintConfig.failureThreshold,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);

      return {
        status: "error",
        summary: "Lint check failed with error",
        details: message,
        duration,
        metadata: { error: message },
      };
    }
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(
    results: Array<{ tool: string; errors: unknown[]; warnings: unknown[] }>,
    totalViolations: number
  ): string {
    if (totalViolations === 0) {
      return `All lint checks passed (${results.length} tools)`;
    }

    const errorCount = results.reduce((sum, r) => sum + r.errors.length, 0);
    const warningCount = results.reduce((sum, r) => sum + r.warnings.length, 0);

    const parts = [];
    if (errorCount > 0) {
      parts.push(`${errorCount} error${errorCount === 1 ? "" : "s"}`);
    }
    if (warningCount > 0) {
      parts.push(`${warningCount} warning${warningCount === 1 ? "" : "s"}`);
    }

    return `Lint checks found ${parts.join(" and ")}`;
  }

  /**
   * Generate detailed report
   */
  private generateDetails(
    results: Array<{
      tool: string;
      exitCode: number;
      success: boolean;
      errors: Array<{ file?: string; line?: number; message: string; rule?: string }>;
      warnings: Array<{ file?: string; line?: number; message: string; rule?: string }>;
      stdout: string;
      stderr: string;
    }>
  ): string {
    const lines: string[] = [];

    for (const result of results) {
      lines.push(`\n## ${result.tool}`);
      lines.push(`Exit code: ${result.exitCode}`);
      lines.push(
        `Status: ${result.success ? "✓ Success" : "✗ Failed"}`
      );

      if (result.errors.length > 0) {
        lines.push(`\n### Errors (${result.errors.length})`);
        for (const error of result.errors) {
          const location = error.file
            ? `${error.file}${error.line ? `:${error.line}` : ""}`
            : "unknown";
          const rule = error.rule ? ` [${error.rule}]` : "";
          lines.push(`- ${location}: ${error.message}${rule}`);
        }
      }

      if (result.warnings.length > 0) {
        lines.push(`\n### Warnings (${result.warnings.length})`);
        for (const warning of result.warnings) {
          const location = warning.file
            ? `${warning.file}${warning.line ? `:${warning.line}` : ""}`
            : "unknown";
          const rule = warning.rule ? ` [${warning.rule}]` : "";
          lines.push(`- ${location}: ${warning.message}${rule}`);
        }
      }

      // Include stderr if there were errors
      if (!result.success && result.stderr) {
        lines.push(`\n### Error Output`);
        lines.push("```");
        lines.push(result.stderr.trim());
        lines.push("```");
      }
    }

    return lines.join("\n");
  }
}
