import { ReviewContext } from './review-context.js';
import { ReviewStepResult } from './review-result.js';

/**
 * Configuration for a review step instance
 */
export interface ReviewStepConfig {
  /** Unique identifier for this step instance */
  id: string;
  /** Display name for this step */
  name: string;
  /** Whether this step blocks PR merge on failure */
  blocking: boolean;
  /** Whether this step is enabled */
  enabled: boolean;
  /** Timeout for this step in milliseconds */
  timeoutMs: number;
  /** Condition to determine if this step should run (optional) */
  condition?: {
    /** Only run if these labels are present */
    requiredLabels?: string[];
    /** Skip if these labels are present */
    excludedLabels?: string[];
    /** Only run if files matching these patterns changed */
    filePatterns?: string[];
    /** Only run for AI-generated PRs */
    aiGeneratedOnly?: boolean;
  };
  /** Step-specific configuration options */
  options: Record<string, unknown>;
}

/**
 * Base interface that all review steps must implement
 */
export interface ReviewStep {
  /** Unique type identifier for this review step */
  readonly type: string;

  /** Human-readable name for this review step */
  readonly name: string;

  /** Description of what this review step does */
  readonly description: string;

  /**
   * Initialize the review step with configuration
   * Called once when the step is registered
   *
   * @param config Configuration for this step instance
   */
  initialize(config: ReviewStepConfig): Promise<void>;

  /**
   * Execute the review step
   *
   * @param context Review context containing PR info and environment
   * @returns Promise resolving to the review result
   */
  execute(context: ReviewContext): Promise<ReviewStepResult>;

  /**
   * Cleanup resources after review step completes
   * Called after execute() finishes or times out
   */
  cleanup(): Promise<void>;

  /**
   * Validate the step configuration
   * Called during workflow validation
   *
   * @param config Configuration to validate
   * @returns Array of validation error messages (empty if valid)
   */
  validateConfig(config: ReviewStepConfig): string[];
}

/**
 * Factory function for creating review step instances
 */
export type ReviewStepFactory = (config: ReviewStepConfig) => ReviewStep | Promise<ReviewStep>;

/**
 * Metadata about a review step type
 */
export interface ReviewStepMetadata {
  /** Unique type identifier */
  type: string;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Factory function to create instances */
  factory: ReviewStepFactory;
  /** JSON schema for step options (optional) */
  optionsSchema?: Record<string, unknown>;
  /** Default configuration values */
  defaults: Partial<ReviewStepConfig>;
}
