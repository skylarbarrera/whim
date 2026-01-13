import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReviewStep, ReviewStepConfig } from '../types/review-step.js';
import type { ReviewContext } from '../types/review-context.js';
import type { ReviewStepResult, ReviewMessage } from '../types/review-result.js';
import { ReviewStatus, ReviewSeverity } from '../types/review-result.js';

const execAsync = promisify(exec);

/**
 * Test runner types supported by the test step
 */
export type TestRunner = 'jest' | 'vitest' | 'bun' | 'mocha' | 'custom';

/**
 * Coverage thresholds configuration
 */
export interface CoverageThresholds {
  /** Minimum line coverage percentage (0-100) */
  lines?: number;
  /** Minimum function coverage percentage (0-100) */
  functions?: number;
  /** Minimum branch coverage percentage (0-100) */
  branches?: number;
  /** Minimum statement coverage percentage (0-100) */
  statements?: number;
}

/**
 * Configuration options for the test step
 */
export interface TestStepOptions {
  /** Test runner to use */
  runner?: TestRunner;
  /** Custom command override (for custom runner) */
  command?: string;
  /** Additional arguments to pass to the test command */
  args?: string[];
  /** Package.json script name to run (default: "test") */
  testScript?: string;
  /** Whether to collect and validate coverage */
  coverage?: boolean;
  /** Coverage thresholds to enforce */
  coverageThresholds?: CoverageThresholds;
  /** Test suite timeout in milliseconds */
  timeout?: number;
  /** Minimum severity to fail the step */
  failOn?: 'error' | 'failure';
}

/**
 * Jest JSON output format
 */
interface JestTestResult {
  numFailedTests: number;
  numPassedTests: number;
  numTotalTests: number;
  testResults: Array<{
    name: string;
    status: string;
    assertionResults: Array<{
      ancestorTitles: string[];
      fullName: string;
      title: string;
      status: 'passed' | 'failed' | 'pending' | 'skipped';
      failureMessages: string[];
      location?: {
        line: number;
        column: number;
      };
    }>;
  }>;
  coverageMap?: {
    [file: string]: {
      lines: { pct: number };
      functions: { pct: number };
      statements: { pct: number };
      branches: { pct: number };
    };
  };
}

/**
 * Vitest JSON output format
 */
interface VitestTestResult {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  testResults: Array<{
    name: string;
    status: string;
    assertionResults: Array<{
      fullName: string;
      title: string;
      status: 'passed' | 'failed';
      failureMessages: string[];
    }>;
  }>;
}

/**
 * Coverage summary format (common to Jest/Vitest)
 */
interface CoverageSummary {
  lines: { pct: number };
  functions: { pct: number };
  statements: { pct: number };
  branches: { pct: number };
}

/**
 * Review step that runs automated tests on the codebase
 */
export class TestStep implements ReviewStep {
  readonly type = 'test';
  readonly name = 'Test';
  readonly description = 'Run automated tests (unit and integration)';

  private config?: ReviewStepConfig;
  private options?: TestStepOptions;

  async initialize(config: ReviewStepConfig): Promise<void> {
    this.config = config;
    this.options = config.options as unknown as TestStepOptions;

    // Set defaults
    this.options = {
      runner: 'jest',
      testScript: 'test',
      coverage: false,
      timeout: 300000, // 5 minutes
      failOn: 'failure',
      ...this.options,
    };
  }

  async execute(context: ReviewContext): Promise<ReviewStepResult> {
    const startedAt = new Date();
    const messages: ReviewMessage[] = [];

    try {
      // Check if tests are available
      const hasTests = await this.hasTestScript(context.workingDirectory);
      if (!hasTests) {
        context.logger.info('[Test] No test script found, skipping');
        return this.createResult(startedAt, ReviewStatus.SKIPPED, messages, {
          reason: 'No test script defined in package.json',
        });
      }

      context.logger.info('[Test] Running test suite');

      // Run tests
      const result = await this.runTests(context);

      // Parse test output
      const testMessages = await this.parseTestOutput(result, context);
      messages.push(...testMessages);

      // Check coverage if enabled
      if (this.options!.coverage) {
        const coverageMessages = await this.checkCoverage(context);
        messages.push(...coverageMessages);
      }

      // Determine overall status
      const status = this.determineStatus(messages, result);

      context.logger.info(
        `[Test] ${result.passed}/${result.total} tests passed` +
        (result.failed > 0 ? `, ${result.failed} failed` : '')
      );

      return this.createResult(startedAt, status, messages, {
        testsRun: result.total,
        testsPassed: result.passed,
        testsFailed: result.failed,
      });
    } catch (error) {
      context.logger.error(`[Test] Error: ${error instanceof Error ? error.message : String(error)}`);
      return this.createResult(startedAt, ReviewStatus.ERROR, messages, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  async cleanup(): Promise<void> {
    // No cleanup needed for test step
  }

  validateConfig(config: ReviewStepConfig): string[] {
    const errors: string[] = [];
    const options = config.options as Partial<TestStepOptions>;

    if (options.runner && !['jest', 'vitest', 'bun', 'mocha', 'custom'].includes(options.runner)) {
      errors.push('options.runner must be "jest", "vitest", "bun", "mocha", or "custom"');
    }

    if (options.runner === 'custom' && !options.command) {
      errors.push('options.command is required for custom test runner');
    }

    if (options.failOn && !['error', 'failure'].includes(options.failOn)) {
      errors.push('options.failOn must be "error" or "failure"');
    }

    if (options.coverageThresholds) {
      const thresholds = options.coverageThresholds;
      for (const [key, value] of Object.entries(thresholds)) {
        if (typeof value === 'number' && (value < 0 || value > 100)) {
          errors.push(`options.coverageThresholds.${key} must be between 0 and 100`);
        }
      }
    }

    return errors;
  }

  /**
   * Check if the project has a test script
   */
  private async hasTestScript(workingDir: string): Promise<boolean> {
    try {
      const packageJsonPath = join(workingDir, 'package.json');
      await access(packageJsonPath);
      const content = await readFile(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);
      const testScript = this.options?.testScript || 'test';
      return !!(pkg.scripts?.[testScript] &&
                pkg.scripts[testScript] !== 'echo "Error: no test specified" && exit 1');
    } catch {
      return false;
    }
  }

  /**
   * Run the test suite
   */
  private async runTests(context: ReviewContext): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    total: number;
    passed: number;
    failed: number;
  }> {
    const command = this.buildTestCommand();
    const timeout = this.options?.timeout || 300000;

    context.logger.debug(`[Test] Running: ${command}`);

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: context.workingDirectory,
        timeout,
        env: {
          ...process.env,
          ...context.env,
          CI: 'true',
          FORCE_COLOR: '0',
        },
      });

      const parsed = this.parseTestCounts(stdout, stderr);
      return {
        stdout,
        stderr,
        exitCode: 0,
        ...parsed,
      };
    } catch (error: any) {
      // Tests can fail with non-zero exit code
      const stdout = error.stdout || '';
      const stderr = error.stderr || '';
      const parsed = this.parseTestCounts(stdout, stderr);

      return {
        stdout,
        stderr,
        exitCode: error.code || 1,
        ...parsed,
      };
    }
  }

  /**
   * Build the test command based on configuration
   */
  private buildTestCommand(): string {
    if (this.options?.command) {
      // Custom command
      const args = this.options.args?.join(' ') || '';
      return `${this.options.command} ${args}`.trim();
    }

    const runner = this.options?.runner || 'jest';
    const scriptName = this.options?.testScript || 'test';
    const additionalArgs = this.options?.args || [];
    const coverage = this.options?.coverage;

    switch (runner) {
      case 'jest':
        return `npm run ${scriptName} -- --json ${coverage ? '--coverage' : ''} ${additionalArgs.join(' ')}`.trim();
      case 'vitest':
        return `npm run ${scriptName} -- run --reporter=json ${coverage ? '--coverage' : ''} ${additionalArgs.join(' ')}`.trim();
      case 'bun':
        return `bun test ${coverage ? '--coverage' : ''} ${additionalArgs.join(' ')}`.trim();
      case 'mocha':
        return `npm run ${scriptName} -- --reporter json ${additionalArgs.join(' ')}`.trim();
      default:
        return `npm run ${scriptName}`;
    }
  }

  /**
   * Parse test counts from output
   */
  private parseTestCounts(stdout: string, stderr: string): {
    total: number;
    passed: number;
    failed: number;
  } {
    const output = stdout + '\n' + stderr;

    // Try Jest format
    const jestMatch = output.match(/Tests:\s+(?:(\d+)\s+passed)?(?:,\s*)?(?:(\d+)\s+failed)?(?:,\s*)?(\d+)\s+total/i);
    if (jestMatch) {
      return {
        passed: parseInt(jestMatch[1] || '0', 10),
        failed: parseInt(jestMatch[2] || '0', 10),
        total: parseInt(jestMatch[3] || '0', 10),
      };
    }

    // Try Vitest format
    const vitestMatch = output.match(/(\d+)\s+passed.*?(\d+)\s+failed.*?(\d+)\s+total/i);
    if (vitestMatch) {
      return {
        passed: parseInt(vitestMatch[1] || '0', 10),
        failed: parseInt(vitestMatch[2] || '0', 10),
        total: parseInt(vitestMatch[3] || '0', 10),
      };
    }

    // Try Bun format
    const bunMatch = output.match(/(\d+)\s+pass.*?(\d+)\s+fail.*?(\d+)\s+total/i);
    if (bunMatch) {
      return {
        passed: parseInt(bunMatch[1] || '0', 10),
        failed: parseInt(bunMatch[2] || '0', 10),
        total: parseInt(bunMatch[3] || '0', 10),
      };
    }

    // Generic fallback
    const passCount = (output.match(/\bPASS\b/gi) || []).length;
    const failCount = (output.match(/\bFAIL\b/gi) || []).length;
    return {
      total: passCount + failCount,
      passed: passCount,
      failed: failCount,
    };
  }

  /**
   * Parse test output and extract failure messages
   */
  private async parseTestOutput(
    result: { stdout: string; stderr: string; exitCode: number; failed: number },
    context: ReviewContext
  ): Promise<ReviewMessage[]> {
    if (result.failed === 0) {
      return [];
    }

    const messages: ReviewMessage[] = [];

    try {
      // Try to parse JSON output (Jest/Vitest)
      const jsonMatch = result.stdout.match(/\{[\s\S]*"testResults"[\s\S]*\}/);
      if (jsonMatch) {
        const testResult: JestTestResult | VitestTestResult = JSON.parse(jsonMatch[0]);

        for (const fileResult of testResult.testResults) {
          for (const assertion of fileResult.assertionResults) {
            if (assertion.status === 'failed') {
              const failureMsg = assertion.failureMessages?.join('\n\n') || 'Test failed';
              const stackTrace = this.extractStackTrace(failureMsg);

              messages.push({
                severity: ReviewSeverity.ERROR,
                message: `Test failed: ${assertion.title}`,
                file: fileResult.name,
                line: stackTrace?.line,
                suggestion: stackTrace?.snippet,
                ruleId: 'test-failure',
              });
            }
          }
        }
      }
    } catch (error) {
      context.logger.debug(`[Test] Could not parse JSON output: ${error instanceof Error ? error.message : String(error)}`);
    }

    // If we couldn't parse JSON or found no messages, create a generic failure message
    if (messages.length === 0 && result.failed > 0) {
      // Try to extract failure info from text output
      const failureMatches = result.stdout.match(/FAIL\s+(.+?)$/gm) ||
                            result.stderr.match(/Error:\s+(.+?)$/gm);

      if (failureMatches && failureMatches.length > 0) {
        for (const match of failureMatches.slice(0, 10)) { // Limit to first 10
          messages.push({
            severity: ReviewSeverity.ERROR,
            message: match.trim(),
            ruleId: 'test-failure',
          });
        }
      } else {
        messages.push({
          severity: ReviewSeverity.ERROR,
          message: `${result.failed} test(s) failed`,
          suggestion: 'Check test output for details',
          ruleId: 'test-failure',
        });
      }
    }

    return messages;
  }

  /**
   * Extract stack trace information from error message
   */
  private extractStackTrace(message: string): { line?: number; snippet?: string } | null {
    // Look for file:line:column pattern
    const stackMatch = message.match(/at\s+.*?\((.+?):(\d+):(\d+)\)/);
    if (stackMatch && stackMatch[2]) {
      return {
        line: parseInt(stackMatch[2], 10),
        snippet: message.split('\n').slice(0, 3).join('\n'),
      };
    }

    // Look for simpler pattern
    const simpleMatch = message.match(/(\d+)\s*\|\s*(.+)/);
    if (simpleMatch && simpleMatch[1]) {
      return {
        line: parseInt(simpleMatch[1], 10),
        snippet: message.split('\n').slice(0, 3).join('\n'),
      };
    }

    return null;
  }

  /**
   * Check test coverage against thresholds
   */
  private async checkCoverage(context: ReviewContext): Promise<ReviewMessage[]> {
    const thresholds = this.options?.coverageThresholds;
    if (!thresholds) {
      return [];
    }

    const messages: ReviewMessage[] = [];

    try {
      // Try to read coverage-summary.json
      const coveragePath = join(context.workingDirectory, 'coverage', 'coverage-summary.json');
      const coverageContent = await readFile(coveragePath, 'utf-8');
      const coverage = JSON.parse(coverageContent);
      const total: CoverageSummary = coverage.total;

      // Check each threshold
      const checks = [
        { name: 'lines', actual: total.lines.pct, threshold: thresholds.lines },
        { name: 'functions', actual: total.functions.pct, threshold: thresholds.functions },
        { name: 'branches', actual: total.branches.pct, threshold: thresholds.branches },
        { name: 'statements', actual: total.statements.pct, threshold: thresholds.statements },
      ];

      for (const check of checks) {
        if (check.threshold !== undefined && check.actual < check.threshold) {
          messages.push({
            severity: ReviewSeverity.WARNING,
            message: `Coverage for ${check.name} is below threshold`,
            suggestion: `Current: ${check.actual.toFixed(2)}%, Required: ${check.threshold}%`,
            ruleId: 'coverage-threshold',
          });
        }
      }

      context.logger.info(
        `[Test] Coverage: ${total.lines.pct.toFixed(2)}% lines, ` +
        `${total.branches.pct.toFixed(2)}% branches`
      );
    } catch (error) {
      context.logger.debug(`[Test] Could not read coverage: ${error instanceof Error ? error.message : String(error)}`);
    }

    return messages;
  }

  /**
   * Determine overall status based on messages and test results
   */
  private determineStatus(
    messages: ReviewMessage[],
    result: { exitCode: number; failed: number }
  ): ReviewStatus {
    const failOn = this.options?.failOn || 'failure';

    // Check for test failures
    if (result.failed > 0) {
      return ReviewStatus.FAIL;
    }

    // Check for errors (execution errors, not test failures)
    if (failOn === 'error' && result.exitCode !== 0) {
      return ReviewStatus.FAIL;
    }

    // Check for coverage warnings
    const hasWarnings = messages.some(m => m.severity === ReviewSeverity.WARNING);
    if (hasWarnings && failOn === 'failure') {
      // Coverage warnings don't fail the step by default
      return ReviewStatus.PASS;
    }

    return ReviewStatus.PASS;
  }

  /**
   * Create a result object
   */
  private createResult(
    startedAt: Date,
    status: ReviewStatus,
    messages: ReviewMessage[],
    metadata?: Record<string, unknown>
  ): ReviewStepResult {
    const completedAt = new Date();
    return {
      stepName: this.config?.name || this.name,
      status,
      messages,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      startedAt,
      completedAt,
      metadata: {
        runner: this.options?.runner || 'jest',
        coverage: this.options?.coverage || false,
        ...metadata,
      },
      error: metadata?.message ? {
        message: metadata.message as string,
        stack: metadata.stack as string | undefined,
      } : undefined,
    };
  }
}
