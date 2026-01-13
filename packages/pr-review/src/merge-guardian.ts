// @ts-ignore - Node.js imports
import type { PRReview, PRReviewCheck } from '@factory/shared';
import type { ReviewTracker } from './tracker.js';
import type { GitHubStatusClient } from './github-status.js';

/**
 * Merge decision result
 */
export interface MergeDecision {
  allowed: boolean;
  reason: string;
  failedChecks: string[];
  pendingChecks: string[];
  overridden: boolean;
}

/**
 * Override request parameters
 */
export interface OverrideParams {
  reviewId: string;
  user: string;
  reason: string;
}

/**
 * Guardian that enforces merge blocking rules
 *
 * This class determines if a PR can be merged based on review check results
 * and manages emergency override functionality.
 */
export class MergeGuardian {
  constructor(
    private tracker: ReviewTracker,
    private statusClient?: GitHubStatusClient
  ) {}

  /**
   * Determine if a PR can be merged
   */
  async canMerge(reviewId: string): Promise<MergeDecision> {
    const result = await this.tracker.getReview(reviewId);

    if (!result) {
      return {
        allowed: false,
        reason: 'Review not found',
        failedChecks: [],
        pendingChecks: [],
        overridden: false,
      };
    }

    const { review, checks } = result;

    // Check if overridden
    if (review.overrideUser) {
      return {
        allowed: true,
        reason: `Overridden by ${review.overrideUser}: ${review.overrideReason}`,
        failedChecks: [],
        pendingChecks: [],
        overridden: true,
      };
    }

    // Separate required and optional checks
    const requiredChecks = checks.filter((c) => c.required);
    const failedChecks: string[] = [];
    const pendingChecks: string[] = [];

    // Check required checks
    for (const check of requiredChecks) {
      if (check.status === 'failure' || check.status === 'error') {
        failedChecks.push(check.checkType);
      } else if (
        check.status === 'pending' ||
        check.status === 'running' ||
        check.status === 'skipped'
      ) {
        pendingChecks.push(check.checkType);
      }
    }

    // Build decision
    if (failedChecks.length > 0) {
      return {
        allowed: false,
        reason: `Required checks failed: ${failedChecks.join(', ')}`,
        failedChecks,
        pendingChecks,
        overridden: false,
      };
    }

    if (pendingChecks.length > 0) {
      return {
        allowed: false,
        reason: `Required checks pending: ${pendingChecks.join(', ')}`,
        failedChecks,
        pendingChecks,
        overridden: false,
      };
    }

    return {
      allowed: true,
      reason: 'All required checks passed',
      failedChecks: [],
      pendingChecks: [],
      overridden: false,
    };
  }

  /**
   * Block merge for a review
   */
  async blockMerge(reviewId: string, reason: string): Promise<void> {
    await this.tracker.updateMergeBlocked(reviewId, true);

    // Update GitHub status if client available
    if (this.statusClient) {
      const result = await this.tracker.getReview(reviewId);
      if (result) {
        await this.statusClient.createStatusFromReview(result.review, true);
      }
    }
  }

  /**
   * Allow merge for a review
   */
  async allowMerge(reviewId: string): Promise<void> {
    await this.tracker.updateMergeBlocked(reviewId, false);

    // Update GitHub status if client available
    if (this.statusClient) {
      const result = await this.tracker.getReview(reviewId);
      if (result) {
        await this.statusClient.createStatusFromReview(result.review, false);
      }
    }
  }

  /**
   * Check if a review is overridden
   */
  async isOverridden(reviewId: string): Promise<boolean> {
    const result = await this.tracker.getReview(reviewId);
    return result?.review.overrideUser !== null;
  }

  /**
   * Emergency override to allow merge despite failures
   */
  async override(params: OverrideParams): Promise<MergeDecision> {
    const { reviewId, user, reason } = params;

    // Validate review exists
    const result = await this.tracker.getReview(reviewId);
    if (!result) {
      throw new Error(`Review ${reviewId} not found`);
    }

    // Record override in database
    await this.tracker.markOverridden(reviewId, user, reason);

    // Unblock merge
    await this.tracker.updateMergeBlocked(reviewId, false);

    // Update GitHub status with override note
    if (this.statusClient) {
      const updatedResult = await this.tracker.getReview(reviewId);
      if (updatedResult) {
        await this.statusClient.createStatusFromReview(updatedResult.review, false);
      }
    }

    // Log override for audit trail
    console.log(
      `[OVERRIDE] Review ${reviewId} overridden by ${user}: ${reason}`
    );

    return {
      allowed: true,
      reason: `Overridden by ${user}: ${reason}`,
      failedChecks: [],
      pendingChecks: [],
      overridden: true,
    };
  }

  /**
   * Evaluate merge status and update database/GitHub
   */
  async evaluateAndUpdate(reviewId: string): Promise<MergeDecision> {
    const decision = await this.canMerge(reviewId);

    // Update merge blocked status
    await this.tracker.updateMergeBlocked(reviewId, !decision.allowed);

    // Update GitHub status
    if (this.statusClient) {
      const result = await this.tracker.getReview(reviewId);
      if (result) {
        await this.statusClient.createStatusFromReview(
          result.review,
          !decision.allowed
        );
      }
    }

    return decision;
  }

  /**
   * Check if all required checks are complete (success or failure)
   */
  async areChecksComplete(reviewId: string): Promise<boolean> {
    const result = await this.tracker.getReview(reviewId);
    if (!result || !result.checks) {
      return false;
    }

    const requiredChecks = result.checks.filter((c) => c.required);
    if (requiredChecks.length === 0) {
      return true; // No required checks = complete
    }

    return requiredChecks.every(
      (check) => check.status === 'success' || check.status === 'failure'
    );
  }

  /**
   * Get summary of check statuses
   */
  async getCheckSummary(reviewId: string): Promise<{
    total: number;
    required: number;
    passed: number;
    failed: number;
    pending: number;
  }> {
    const result = await this.tracker.getReview(reviewId);
    const checks = result?.checks || [];
    const requiredChecks = checks.filter((c) => c.required);

    return {
      total: checks.length,
      required: requiredChecks.length,
      passed: checks.filter((c) => c.status === 'success').length,
      failed: checks.filter(
        (c) => c.status === 'failure' || c.status === 'error'
      ).length,
      pending: checks.filter(
        (c) =>
          c.status === 'pending' ||
          c.status === 'running' ||
          c.status === 'skipped'
      ).length,
    };
  }
}
