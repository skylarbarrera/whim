import {
  ReviewStepResult,
  ReviewWorkflowResult,
  ReviewStatus,
  ReviewMessage,
  ReviewSeverity,
} from '../types/review-result.js';

/**
 * Aggregates results from multiple review steps
 */
export class ResultAggregator {
  private results: ReviewStepResult[] = [];

  /**
   * Add a review step result to the aggregator
   *
   * @param result Review step result
   */
  addResult(result: ReviewStepResult): void {
    this.results.push(result);
  }

  /**
   * Add multiple review step results
   *
   * @param results Array of review step results
   */
  addResults(results: ReviewStepResult[]): void {
    this.results.push(...results);
  }

  /**
   * Get the overall status across all review steps
   * Priority: ERROR > FAIL > PENDING > PASS > SKIPPED
   *
   * @returns Overall review status
   */
  getOverallStatus(): ReviewStatus {
    if (this.results.length === 0) {
      return ReviewStatus.PENDING;
    }

    // Error status takes highest priority
    if (this.results.some(r => r.status === ReviewStatus.ERROR)) {
      return ReviewStatus.ERROR;
    }

    // Fail status is next priority
    if (this.results.some(r => r.status === ReviewStatus.FAIL)) {
      return ReviewStatus.FAIL;
    }

    // Pending status if any step is still pending
    if (this.results.some(r => r.status === ReviewStatus.PENDING)) {
      return ReviewStatus.PENDING;
    }

    // All passed or skipped means pass
    const allPassedOrSkipped = this.results.every(
      r => r.status === ReviewStatus.PASS || r.status === ReviewStatus.SKIPPED
    );

    return allPassedOrSkipped ? ReviewStatus.PASS : ReviewStatus.PENDING;
  }

  /**
   * Get all blocking failures from the review
   *
   * @returns Array of step names that failed with blocking status
   */
  getBlockingFailures(): string[] {
    return this.results
      .filter(r => r.status === ReviewStatus.FAIL)
      .map(r => r.stepName);
  }

  /**
   * Group review messages by file path
   *
   * @returns Map of file paths to messages for that file
   */
  groupByFile(): Map<string, ReviewMessage[]> {
    const fileMap = new Map<string, ReviewMessage[]>();

    for (const result of this.results) {
      for (const message of result.messages) {
        if (message.file) {
          const existing = fileMap.get(message.file) || [];
          existing.push(message);
          fileMap.set(message.file, existing);
        }
      }
    }

    return fileMap;
  }

  /**
   * Group review messages by severity level
   *
   * @returns Map of severity levels to messages with that severity
   */
  groupBySeverity(): Map<ReviewSeverity, ReviewMessage[]> {
    const severityMap = new Map<ReviewSeverity, ReviewMessage[]>();

    for (const result of this.results) {
      for (const message of result.messages) {
        const existing = severityMap.get(message.severity) || [];
        existing.push(message);
        severityMap.set(message.severity, existing);
      }
    }

    return severityMap;
  }

  /**
   * Get aggregated workflow result summary
   *
   * @param startedAt Workflow start timestamp
   * @returns Complete workflow result
   */
  getSummary(startedAt: Date): ReviewWorkflowResult {
    const completedAt = new Date();
    const totalDurationMs = completedAt.getTime() - startedAt.getTime();

    const summary = {
      totalSteps: this.results.length,
      passedSteps: this.results.filter(r => r.status === ReviewStatus.PASS).length,
      failedSteps: this.results.filter(r => r.status === ReviewStatus.FAIL).length,
      errorSteps: this.results.filter(r => r.status === ReviewStatus.ERROR).length,
      skippedSteps: this.results.filter(r => r.status === ReviewStatus.SKIPPED).length,
    };

    return {
      status: this.getOverallStatus(),
      stepResults: this.results,
      totalDurationMs,
      startedAt,
      completedAt,
      summary,
    };
  }

  /**
   * Get all messages from all review steps
   *
   * @returns Array of all messages
   */
  getAllMessages(): ReviewMessage[] {
    const messages: ReviewMessage[] = [];
    for (const result of this.results) {
      messages.push(...result.messages);
    }
    return messages;
  }

  /**
   * Get messages filtered by severity
   *
   * @param severity Severity level to filter by
   * @returns Array of messages with the specified severity
   */
  getMessagesBySeverity(severity: ReviewSeverity): ReviewMessage[] {
    const messages: ReviewMessage[] = [];
    for (const result of this.results) {
      messages.push(...result.messages.filter(m => m.severity === severity));
    }
    return messages;
  }

  /**
   * Count total messages by severity
   *
   * @returns Object with counts for each severity level
   */
  getMessageCounts(): { errors: number; warnings: number; info: number } {
    let errors = 0;
    let warnings = 0;
    let info = 0;

    for (const result of this.results) {
      for (const message of result.messages) {
        switch (message.severity) {
          case ReviewSeverity.ERROR:
            errors++;
            break;
          case ReviewSeverity.WARNING:
            warnings++;
            break;
          case ReviewSeverity.INFO:
            info++;
            break;
        }
      }
    }

    return { errors, warnings, info };
  }

  /**
   * Get results for steps that failed or errored
   *
   * @returns Array of failed/errored step results
   */
  getFailedResults(): ReviewStepResult[] {
    return this.results.filter(
      r => r.status === ReviewStatus.FAIL || r.status === ReviewStatus.ERROR
    );
  }

  /**
   * Clear all stored results
   */
  clear(): void {
    this.results = [];
  }
}
