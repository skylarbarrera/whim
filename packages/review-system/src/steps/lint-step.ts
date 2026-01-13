import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { ReviewStep, ReviewStepConfig } from '../types/review-step.js';
import type { ReviewContext } from '../types/review-context.js';
import type { ReviewStepResult, ReviewMessage } from '../types/review-result.js';
import { ReviewStatus, ReviewSeverity } from '../types/review-result.js';

const execAsync = promisify(exec);

/**
 * Configuration for a single linter
 */
export interface LinterConfig {
  /** Type of linter: eslint, prettier, or custom */
  type: 'eslint' | 'prettier' | 'custom';
  /** Command to run (for custom linters) */
  command?: string;
  /** Additional arguments to pass to the linter */
  args?: string[];
  /** File patterns this linter should run on (glob patterns) */
  filePatterns?: string[];
  /** Whether to run auto-fix commands */
  autoFix?: boolean;
}

/**
 * Configuration options for the lint step
 */
export interface LintStepOptions {
  /** Array of linters to run */
  linters: LinterConfig[];
  /** Minimum severity to fail the step: error or warning */
  failOn: 'error' | 'warning';
  /** Whether to run auto-fix commands */
  autoFix?: boolean;
  /** Timeout per linter in milliseconds */
  linterTimeoutMs?: number;
}

/**
 * ESLint JSON output format
 */
interface ESLintResult {
  filePath: string;
  messages: Array<{
    ruleId: string | null;
    severity: number; // 0=off, 1=warning, 2=error
    message: string;
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
    fix?: {
      range: [number, number];
      text: string;
    };
  }>;
  errorCount: number;
  warningCount: number;
}

/**
 * Review step that runs linting tools on changed files
 */
export class LintStep implements ReviewStep {
  readonly type = 'lint';
  readonly name = 'Lint';
  readonly description = 'Run linting tools (ESLint, Prettier, etc.) on changed files';

  private config?: ReviewStepConfig;
  private options?: LintStepOptions;

  async initialize(config: ReviewStepConfig): Promise<void> {
    this.config = config;
    this.options = config.options as unknown as LintStepOptions;

    // Validate that we have at least one linter
    if (!this.options?.linters || this.options.linters.length === 0) {
      throw new Error('LintStep requires at least one linter in options.linters');
    }
  }

  async execute(context: ReviewContext): Promise<ReviewStepResult> {
    const startedAt = new Date();
    const messages: ReviewMessage[] = [];

    try {
      // Filter changed files (exclude deleted files)
      const filesToLint = context.changedFiles
        .filter(f => f.changeType !== 'deleted')
        .map(f => f.path);

      if (filesToLint.length === 0) {
        context.logger.info('[Lint] No files to lint (all deleted)');
        return this.createResult(startedAt, ReviewStatus.PASS, messages);
      }

      context.logger.info(`[Lint] Linting ${filesToLint.length} changed files`);

      // Run each configured linter
      for (const linter of this.options!.linters) {
        const linterMessages = await this.runLinter(linter, filesToLint, context);
        messages.push(...linterMessages);
      }

      // Determine overall status based on messages
      const status = this.determineStatus(messages);

      context.logger.info(
        `[Lint] Found ${messages.filter(m => m.severity === ReviewSeverity.ERROR).length} errors, ` +
        `${messages.filter(m => m.severity === ReviewSeverity.WARNING).length} warnings`
      );

      return this.createResult(startedAt, status, messages);
    } catch (error) {
      context.logger.error(`[Lint] Error: ${error instanceof Error ? error.message : String(error)}`);
      return this.createResult(startedAt, ReviewStatus.ERROR, messages, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  async cleanup(): Promise<void> {
    // No cleanup needed for lint step
  }

  validateConfig(config: ReviewStepConfig): string[] {
    const errors: string[] = [];
    const options = config.options as Partial<LintStepOptions>;

    if (!options.linters || !Array.isArray(options.linters)) {
      errors.push('options.linters must be an array');
      return errors;
    }

    if (options.linters.length === 0) {
      errors.push('options.linters must contain at least one linter');
    }

    // Validate each linter config
    options.linters.forEach((linter, index) => {
      if (!linter.type) {
        errors.push(`linters[${index}].type is required`);
      } else if (!['eslint', 'prettier', 'custom'].includes(linter.type)) {
        errors.push(`linters[${index}].type must be 'eslint', 'prettier', or 'custom'`);
      }

      if (linter.type === 'custom' && !linter.command) {
        errors.push(`linters[${index}].command is required for custom linters`);
      }
    });

    if (options.failOn && !['error', 'warning'].includes(options.failOn)) {
      errors.push('options.failOn must be "error" or "warning"');
    }

    return errors;
  }

  /**
   * Run a single linter on the specified files
   */
  private async runLinter(
    linter: LinterConfig,
    files: string[],
    context: ReviewContext
  ): Promise<ReviewMessage[]> {
    // Filter files by linter's file patterns
    const filteredFiles = this.filterFilesByPatterns(files, linter.filePatterns);

    if (filteredFiles.length === 0) {
      context.logger.debug(`[Lint] Skipping ${linter.type}: no matching files`);
      return [];
    }

    context.logger.info(`[Lint] Running ${linter.type} on ${filteredFiles.length} files`);

    try {
      switch (linter.type) {
        case 'eslint':
          return await this.runESLint(filteredFiles, linter, context);
        case 'prettier':
          return await this.runPrettier(filteredFiles, linter, context);
        case 'custom':
          return await this.runCustomLinter(filteredFiles, linter, context);
        default:
          return [];
      }
    } catch (error) {
      context.logger.error(`[Lint] ${linter.type} error: ${error instanceof Error ? error.message : String(error)}`);
      return [{
        severity: ReviewSeverity.ERROR,
        message: `${linter.type} failed: ${error instanceof Error ? error.message : String(error)}`,
      }];
    }
  }

  /**
   * Run ESLint on files
   */
  private async runESLint(
    files: string[],
    linter: LinterConfig,
    context: ReviewContext
  ): Promise<ReviewMessage[]> {
    const autoFix = linter.autoFix ?? this.options?.autoFix ?? false;
    const args = [
      '--format', 'json',
      ...(autoFix ? ['--fix'] : []),
      ...(linter.args || []),
      ...files,
    ];

    const command = `npx eslint ${args.join(' ')}`;
    const timeout = this.options?.linterTimeoutMs || 60000;

    try {
      const { stdout } = await execAsync(command, {
        cwd: context.workingDirectory,
        timeout,
        env: { ...process.env, ...context.env },
      });

      return this.parseESLintOutput(stdout);
    } catch (error: any) {
      // ESLint exits with non-zero when it finds errors
      if (error.stdout) {
        return this.parseESLintOutput(error.stdout);
      }
      throw error;
    }
  }

  /**
   * Parse ESLint JSON output
   */
  private parseESLintOutput(output: string): ReviewMessage[] {
    try {
      const results: ESLintResult[] = JSON.parse(output);
      const messages: ReviewMessage[] = [];

      for (const result of results) {
        for (const msg of result.messages) {
          messages.push({
            severity: this.mapESLintSeverity(msg.severity),
            message: msg.message,
            file: result.filePath,
            line: msg.line,
            column: msg.column,
            ruleId: msg.ruleId || undefined,
            suggestion: msg.fix
              ? `Auto-fix available. Run: eslint --fix ${result.filePath}`
              : undefined,
          });
        }
      }

      return messages;
    } catch (error) {
      // If JSON parsing fails, return a generic error
      return [{
        severity: ReviewSeverity.ERROR,
        message: `Failed to parse ESLint output: ${error instanceof Error ? error.message : String(error)}`,
      }];
    }
  }

  /**
   * Map ESLint severity to ReviewSeverity
   */
  private mapESLintSeverity(severity: number): ReviewSeverity {
    switch (severity) {
      case 2:
        return ReviewSeverity.ERROR;
      case 1:
        return ReviewSeverity.WARNING;
      default:
        return ReviewSeverity.INFO;
    }
  }

  /**
   * Run Prettier on files
   */
  private async runPrettier(
    files: string[],
    linter: LinterConfig,
    context: ReviewContext
  ): Promise<ReviewMessage[]> {
    const autoFix = linter.autoFix ?? this.options?.autoFix ?? false;
    const args = [
      autoFix ? '--write' : '--check',
      ...(linter.args || []),
      ...files,
    ];

    const command = `npx prettier ${args.join(' ')}`;
    const timeout = this.options?.linterTimeoutMs || 60000;

    try {
      await execAsync(command, {
        cwd: context.workingDirectory,
        timeout,
        env: { ...process.env, ...context.env },
      });

      // If prettier --check succeeds, all files are formatted
      return [];
    } catch (error: any) {
      // Prettier exits with 1 when files need formatting
      if (error.code === 1 && error.stdout) {
        return this.parsePrettierOutput(error.stdout, files);
      }
      throw error;
    }
  }

  /**
   * Parse Prettier output
   */
  private parsePrettierOutput(output: string, files: string[]): ReviewMessage[] {
    // Prettier --check outputs filenames of files that need formatting
    const lines = output.split('\n').filter(line => line.trim());
    const messages: ReviewMessage[] = [];

    for (const line of lines) {
      // Check if this line is a filename
      const file = files.find(f => line.includes(f));
      if (file) {
        messages.push({
          severity: ReviewSeverity.WARNING,
          message: 'File needs formatting',
          file,
          suggestion: `Run: prettier --write ${file}`,
          ruleId: 'prettier',
        });
      }
    }

    return messages;
  }

  /**
   * Run a custom linter command
   */
  private async runCustomLinter(
    files: string[],
    linter: LinterConfig,
    context: ReviewContext
  ): Promise<ReviewMessage[]> {
    if (!linter.command) {
      throw new Error('Custom linter requires a command');
    }

    const args = [...(linter.args || []), ...files];
    const command = `${linter.command} ${args.join(' ')}`;
    const timeout = this.options?.linterTimeoutMs || 60000;

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: context.workingDirectory,
        timeout,
        env: { ...process.env, ...context.env },
      });

      // For custom linters, we can't parse output intelligently
      // Return a generic message if there's any stderr output
      if (stderr) {
        return [{
          severity: ReviewSeverity.WARNING,
          message: `${linter.command} reported issues`,
          suggestion: stderr.slice(0, 500),
        }];
      }

      return [];
    } catch (error: any) {
      // Non-zero exit code indicates issues found
      return [{
        severity: ReviewSeverity.ERROR,
        message: `${linter.command} failed with exit code ${error.code || 'unknown'}`,
        suggestion: error.stderr?.slice(0, 500) || error.message,
      }];
    }
  }

  /**
   * Filter files by glob patterns
   */
  private filterFilesByPatterns(files: string[], patterns?: string[]): string[] {
    if (!patterns || patterns.length === 0) {
      return files;
    }

    // Simple pattern matching (supports *.ext and **/*.ext)
    return files.filter(file => {
      return patterns.some(pattern => {
        // Convert glob pattern to regex
        const regexPattern = pattern
          .replace(/\./g, '\\.')
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*');
        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(file);
      });
    });
  }

  /**
   * Determine overall status based on messages
   */
  private determineStatus(messages: ReviewMessage[]): ReviewStatus {
    const failOn = this.options?.failOn || 'error';

    const hasErrors = messages.some(m => m.severity === ReviewSeverity.ERROR);
    const hasWarnings = messages.some(m => m.severity === ReviewSeverity.WARNING);

    if (hasErrors) {
      return ReviewStatus.FAIL;
    }

    if (hasWarnings && failOn === 'warning') {
      return ReviewStatus.FAIL;
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
    error?: { message: string; stack?: string; code?: string }
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
        linterCount: this.options?.linters.length || 0,
        errorCount: messages.filter(m => m.severity === ReviewSeverity.ERROR).length,
        warningCount: messages.filter(m => m.severity === ReviewSeverity.WARNING).length,
      },
      error,
    };
  }
}
