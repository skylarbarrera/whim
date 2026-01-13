import { ReviewStep, ReviewStepConfig } from '../types/review-step.js';
import { ReviewContext } from '../types/review-context.js';
import { ReviewStepResult, ReviewStatus } from '../types/review-result.js';
import { ExecutionMode, ReviewStepGroup } from '../types/config.js';

/**
 * Executes review steps in sequential or parallel mode
 */
export class ReviewExecutor {
  /**
   * Execute a group of review steps based on the group's execution mode
   *
   * @param group Step group configuration
   * @param steps Map of step instances by ID
   * @param context Review context
   * @returns Array of review step results
   */
  async executeGroup(
    group: ReviewStepGroup,
    steps: Map<string, ReviewStep>,
    context: ReviewContext
  ): Promise<ReviewStepResult[]> {
    context.logger.info(`Executing group: ${group.name} (${group.mode})`);

    // Filter steps that should run based on conditions
    const enabledStepConfigs = group.steps.filter(config => config.enabled);
    const runnableSteps: Array<{ config: ReviewStepConfig; step: ReviewStep }> = [];

    for (const config of enabledStepConfigs) {
      const step = steps.get(config.id);
      if (!step) {
        context.logger.warn(`Step ${config.id} not found in registry, skipping`);
        continue;
      }

      const shouldRun = await this.evaluateCondition(config, context);
      if (shouldRun) {
        runnableSteps.push({ config, step });
      } else {
        context.logger.info(`Step ${config.name} skipped due to condition`);
      }
    }

    // Execute based on mode
    if (group.mode === ExecutionMode.SEQUENTIAL) {
      return this.executeSequential(runnableSteps, context, group.continueOnFailure);
    } else {
      return this.executeParallel(runnableSteps, context);
    }
  }

  /**
   * Execute review steps one at a time in order
   *
   * @param steps Array of step configs and instances
   * @param context Review context
   * @param continueOnFailure Whether to continue if a step fails
   * @returns Array of review step results
   */
  async executeSequential(
    steps: Array<{ config: ReviewStepConfig; step: ReviewStep }>,
    context: ReviewContext,
    continueOnFailure: boolean
  ): Promise<ReviewStepResult[]> {
    const results: ReviewStepResult[] = [];

    for (const { config, step } of steps) {
      const result = await this.executeStep(step, config, context);
      results.push(result);

      // Stop on blocking failure unless continueOnFailure is set
      if (!continueOnFailure && config.blocking && result.status === ReviewStatus.FAIL) {
        context.logger.warn(`Blocking step ${config.name} failed, stopping execution`);
        break;
      }

      // Stop on error unless continueOnFailure is set
      if (!continueOnFailure && result.status === ReviewStatus.ERROR) {
        context.logger.error(`Step ${config.name} errored, stopping execution`);
        break;
      }
    }

    return results;
  }

  /**
   * Execute review steps concurrently
   *
   * @param steps Array of step configs and instances
   * @param context Review context
   * @returns Array of review step results
   */
  async executeParallel(
    steps: Array<{ config: ReviewStepConfig; step: ReviewStep }>,
    context: ReviewContext
  ): Promise<ReviewStepResult[]> {
    // Execute all steps in parallel
    const promises = steps.map(({ config, step }) =>
      this.executeStep(step, config, context)
    );

    // Wait for all to complete (even if some fail)
    const results = await Promise.allSettled(promises);

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        // Convert rejected promise to error result
        const stepInfo = steps[index];
        const now = new Date();
        return {
          stepName: stepInfo ? stepInfo.config.name : 'Unknown Step',
          status: ReviewStatus.ERROR,
          messages: [],
          durationMs: 0,
          startedAt: now,
          completedAt: now,
          error: {
            message: result.reason?.message || 'Unknown error',
            stack: result.reason?.stack,
          },
        };
      }
    });
  }

  /**
   * Execute a single review step with timeout handling
   *
   * @param step Review step instance
   * @param config Step configuration
   * @param context Review context
   * @returns Review step result
   */
  private async executeStep(
    step: ReviewStep,
    config: ReviewStepConfig,
    context: ReviewContext
  ): Promise<ReviewStepResult> {
    const startedAt = new Date();
    context.logger.info(`Executing step: ${config.name}`);

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<ReviewStepResult>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Step ${config.name} timed out after ${config.timeoutMs}ms`));
        }, config.timeoutMs);
      });

      // Race between step execution and timeout
      const result = await Promise.race([
        step.execute(context),
        timeoutPromise,
      ]);

      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();

      context.logger.info(`Step ${config.name} completed with status: ${result.status}`);

      // Ensure result has all required fields
      return {
        ...result,
        stepName: config.name,
        durationMs,
        startedAt,
        completedAt,
      };
    } catch (error) {
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();

      context.logger.error(`Step ${config.name} failed: ${error}`);

      return {
        stepName: config.name,
        status: ReviewStatus.ERROR,
        messages: [],
        durationMs,
        startedAt,
        completedAt,
        error: {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      };
    } finally {
      // Cleanup after step completes or times out
      try {
        await step.cleanup();
      } catch (cleanupError) {
        context.logger.warn(`Cleanup failed for step ${config.name}: ${cleanupError}`);
      }
    }
  }

  /**
   * Evaluate whether a step should run based on its conditions
   *
   * @param config Step configuration
   * @param context Review context
   * @returns True if the step should run, false otherwise
   */
  async evaluateCondition(
    config: ReviewStepConfig,
    context: ReviewContext
  ): Promise<boolean> {
    if (!config.condition) {
      return true;
    }

    const { condition } = config;
    const { pr, changedFiles } = context;

    // Check AI-generated only condition
    if (condition.aiGeneratedOnly && !pr.isAiGenerated) {
      return false;
    }

    // Check required labels
    if (condition.requiredLabels && condition.requiredLabels.length > 0) {
      const hasAllLabels = condition.requiredLabels.every(label =>
        pr.labels.includes(label)
      );
      if (!hasAllLabels) {
        return false;
      }
    }

    // Check excluded labels
    if (condition.excludedLabels && condition.excludedLabels.length > 0) {
      const hasExcludedLabel = condition.excludedLabels.some(label =>
        pr.labels.includes(label)
      );
      if (hasExcludedLabel) {
        return false;
      }
    }

    // Check file patterns
    if (condition.filePatterns && condition.filePatterns.length > 0) {
      const hasMatchingFile = changedFiles.some(file =>
        condition.filePatterns!.some(pattern => this.matchPattern(file.path, pattern))
      );
      if (!hasMatchingFile) {
        return false;
      }
    }

    return true;
  }

  /**
   * Simple glob pattern matching
   *
   * @param path File path to test
   * @param pattern Glob pattern (supports * and **)
   * @returns True if path matches pattern
   */
  private matchPattern(path: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }
}
