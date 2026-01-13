/**
 * Status of a review step execution
 */
export enum ReviewStatus {
  /** Review step passed successfully */
  PASS = 'pass',
  /** Review step failed, blocking PR merge */
  FAIL = 'fail',
  /** Review step encountered an error during execution */
  ERROR = 'error',
  /** Review step was skipped (e.g., due to conditions not being met) */
  SKIPPED = 'skipped',
  /** Review step is currently running */
  PENDING = 'pending',
}

/**
 * Severity level for review messages
 */
export enum ReviewSeverity {
  /** Informational message */
  INFO = 'info',
  /** Warning that doesn't block merge */
  WARNING = 'warning',
  /** Error that blocks merge */
  ERROR = 'error',
}

/**
 * A single message or issue found during review
 */
export interface ReviewMessage {
  /** Severity level of this message */
  severity: ReviewSeverity;
  /** Human-readable message */
  message: string;
  /** File path where issue was found (optional) */
  file?: string;
  /** Line number where issue was found (optional) */
  line?: number;
  /** Column number where issue was found (optional) */
  column?: number;
  /** Suggested fix or remediation (optional) */
  suggestion?: string;
  /** Rule or check that generated this message (optional) */
  ruleId?: string;
}

/**
 * Result of executing a review step
 */
export interface ReviewStepResult {
  /** Name of the review step that produced this result */
  stepName: string;
  /** Overall status of the review step */
  status: ReviewStatus;
  /** Messages, warnings, and errors found during review */
  messages: ReviewMessage[];
  /** Duration of the review step in milliseconds */
  durationMs: number;
  /** Timestamp when the review step started */
  startedAt: Date;
  /** Timestamp when the review step completed */
  completedAt: Date;
  /** Additional metadata specific to this review step */
  metadata?: Record<string, unknown>;
  /** Error details if status is ERROR */
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

/**
 * Aggregated result of all review steps in a workflow
 */
export interface ReviewWorkflowResult {
  /** Overall status (FAIL if any step failed, ERROR if any errored, PASS if all passed) */
  status: ReviewStatus;
  /** Results from individual review steps */
  stepResults: ReviewStepResult[];
  /** Total duration of all review steps in milliseconds */
  totalDurationMs: number;
  /** Timestamp when the review workflow started */
  startedAt: Date;
  /** Timestamp when the review workflow completed */
  completedAt: Date;
  /** Summary statistics */
  summary: {
    totalSteps: number;
    passedSteps: number;
    failedSteps: number;
    errorSteps: number;
    skippedSteps: number;
  };
}
