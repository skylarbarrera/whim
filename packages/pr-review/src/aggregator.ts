import type { PRReviewCheck, CheckStatus } from '@factory/shared';

/**
 * Aggregated review result
 */
export interface AggregatedResult {
  mergeBlocked: boolean;
  summary: string;
  requiredChecksPassed: number;
  requiredChecksTotal: number;
  optionalChecksPassed: number;
  optionalChecksTotal: number;
  details: {
    success: string[];
    failure: string[];
    pending: string[];
  };
}

/**
 * Aggregates check results to determine merge status
 */
export class ResultAggregator {
  /**
   * Aggregate check results
   * @param checks All checks for a PR review
   * @returns Aggregated result with merge status and summary
   */
  aggregate(checks: PRReviewCheck[]): AggregatedResult {
    const requiredChecks = checks.filter(c => c.required);
    const optionalChecks = checks.filter(c => !c.required);

    const requiredPassed = requiredChecks.filter(c => c.status === 'success').length;
    const requiredTotal = requiredChecks.length;
    const optionalPassed = optionalChecks.filter(c => c.status === 'success').length;
    const optionalTotal = optionalChecks.length;

    // Categorize checks by status
    const success = checks
      .filter(c => c.status === 'success')
      .map(c => c.checkName);

    const failure = checks
      .filter(c => c.status === 'failure')
      .map(c => c.checkName);

    const pending = checks
      .filter(c => c.status === 'pending' || c.status === 'running')
      .map(c => c.checkName);

    // Merge is blocked if:
    // 1. Any required check failure
    // 2. Any required check is still pending/running
    const hasRequiredFailures = requiredChecks.some(c => c.status === 'failure');
    const hasRequiredPending = requiredChecks.some(c => c.status === 'pending' || c.status === 'running');
    const mergeBlocked = hasRequiredFailures || hasRequiredPending;

    // Generate summary
    const summary = this.generateSummary({
      requiredPassed,
      requiredTotal,
      optionalPassed,
      optionalTotal,
      mergeBlocked,
      hasRequiredFailures,
      hasRequiredPending,
    });

    return {
      mergeBlocked,
      summary,
      requiredChecksPassed: requiredPassed,
      requiredChecksTotal: requiredTotal,
      optionalChecksPassed: optionalPassed,
      optionalChecksTotal: optionalTotal,
      details: {
        success,
        failure,
        pending,
      },
    };
  }

  /**
   * Generate a human-readable summary
   */
  private generateSummary(params: {
    requiredPassed: number;
    requiredTotal: number;
    optionalPassed: number;
    optionalTotal: number;
    mergeBlocked: boolean;
    hasRequiredFailures: boolean;
    hasRequiredPending: boolean;
  }): string {
    const { requiredPassed, requiredTotal, optionalPassed, optionalTotal, mergeBlocked, hasRequiredFailures, hasRequiredPending } = params;

    if (!mergeBlocked && requiredTotal === requiredPassed) {
      const optionalMsg = optionalTotal > 0
        ? ` ${optionalPassed}/${optionalTotal} optional checks success.`
        : '';
      return `All required checks success (${requiredPassed}/${requiredTotal}).${optionalMsg} Ready to merge.`;
    }

    if (hasRequiredFailures) {
      const failureCount = requiredTotal - requiredPassed;
      return `${failureCount} required check(s) failure. Merge blocked.`;
    }

    if (hasRequiredPending) {
      const pendingCount = requiredTotal - requiredPassed;
      return `${pendingCount} required check(s) pending. Merge blocked until all checks complete.`;
    }

    return 'Review in progress.';
  }
}
