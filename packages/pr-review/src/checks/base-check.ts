import type { CheckResult, PRContext } from "@factory/shared";

/**
 * Configuration options for a check
 */
export interface CheckConfig {
  /** Whether this check is enabled */
  enabled: boolean;
  /** Whether this check is required to pass for merge */
  required: boolean;
  /** Maximum execution time in milliseconds */
  timeout: number;
  /** Check-specific configuration */
  [key: string]: unknown;
}

/**
 * Abstract base class for all PR checks
 *
 * Each check type (lint, test, typecheck, etc.) should extend this class
 * and implement the runCheck method.
 */
export abstract class BaseCheck {
  protected config: CheckConfig;

  constructor(config: CheckConfig) {
    this.config = config;
  }

  /**
   * Get the unique name of this check
   */
  abstract getName(): string;

  /**
   * Check if this check is required to pass for merge
   */
  isRequired(): boolean {
    return this.config.required;
  }

  /**
   * Check if this check is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the timeout for this check in milliseconds
   */
  getTimeout(): number {
    return this.config.timeout;
  }

  /**
   * Run this check
   *
   * @param context - PR context information
   * @param workdir - Working directory where the repo is checked out
   * @returns CheckResult with status, summary, and details
   */
  async run(context: PRContext, workdir: string): Promise<CheckResult> {
    // If check is disabled, return skipped status
    if (!this.isEnabled()) {
      return {
        status: "skipped",
        summary: `${this.getName()} is disabled`,
        details: "",
        duration: 0,
        metadata: {},
      };
    }

    const startTime = Date.now();

    try {
      // Run the actual check with timeout
      const result = await this.runWithTimeout(context, workdir);
      const duration = Date.now() - startTime;

      return {
        ...result,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);

      return {
        status: "error",
        summary: `${this.getName()} failed with error`,
        details: message,
        duration,
        metadata: { error: message },
      };
    }
  }

  /**
   * Run the check with a timeout
   */
  private async runWithTimeout(
    context: PRContext,
    workdir: string
  ): Promise<CheckResult> {
    const timeout = this.getTimeout();

    return Promise.race([
      this.runCheck(context, workdir),
      new Promise<CheckResult>((_, reject) =>
        setTimeout(() => reject(new Error(`Check timed out after ${timeout}ms`)), timeout)
      ),
    ]);
  }

  /**
   * Implement this method to perform the actual check
   *
   * @param context - PR context information
   * @param workdir - Working directory where the repo is checked out
   * @returns CheckResult with status, summary, and details
   */
  protected abstract runCheck(
    context: PRContext,
    workdir: string
  ): Promise<CheckResult>;
}
