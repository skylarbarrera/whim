import type { PRReview, PRReviewCheck, PRContext, CheckType } from '@factory/shared';
import { PRDetector } from './detector.js';
import { ReviewTracker, type DatabaseClient } from './tracker.js';
import { ResultAggregator, type AggregatedResult } from './aggregator.js';

/**
 * Check configuration
 */
export interface CheckConfig {
  name: string;
  type: CheckType;
  required: boolean;
}

/**
 * Service configuration
 */
export interface ServiceConfig {
  checks: CheckConfig[];
}

/**
 * Main PR review service that coordinates detection, tracking, and aggregation
 */
export class ReviewService {
  private detector: PRDetector;
  private tracker: ReviewTracker;
  private aggregator: ResultAggregator;
  private config: ServiceConfig;

  constructor(db: DatabaseClient, config: ServiceConfig) {
    this.detector = new PRDetector();
    this.tracker = new ReviewTracker(db);
    this.aggregator = new ResultAggregator();
    this.config = config;
  }

  /**
   * Detect if PR is AI-generated and create review if applicable
   * @returns Review and detection result, or null if not AI-generated
   */
  async detectAndCreateReview(context: PRContext): Promise<{
    review: PRReview;
    checks: PRReviewCheck[];
  } | null> {
    // Detect if AI-generated
    const detection = this.detector.detect(context);

    if (!detection.isAI) {
      return null;
    }

    // Create review
    const review = await this.tracker.createReview({
      repoOwner: context.owner,
      repoName: context.repo,
      prNumber: context.prNumber,
      isAIGenerated: detection.isAI,
      detectionConfidence: detection.confidence,
      detectionReasons: detection.reasons,
    });

    // Create check records
    const checks: PRReviewCheck[] = [];
    for (const checkConfig of this.config.checks) {
      const check = await this.tracker.recordCheck({
        reviewId: review.id,
        checkName: checkConfig.name,
        checkType: checkConfig.type,
        required: checkConfig.required,
      });
      checks.push(check);
    }

    // Update review status to running
    await this.tracker.updateReviewStatus(review.id, 'running');

    return { review, checks };
  }

  /**
   * Get review status with aggregated results
   */
  async getReviewStatus(reviewId: string): Promise<{
    review: PRReview;
    checks: PRReviewCheck[];
    aggregated: AggregatedResult;
  } | null> {
    const result = await this.tracker.getReview(reviewId);
    if (!result) {
      return null;
    }

    const aggregated = this.aggregator.aggregate(result.checks);

    return {
      review: result.review,
      checks: result.checks,
      aggregated,
    };
  }

  /**
   * Get review status by repository and PR number
   */
  async getReviewStatusByPR(repoOwner: string, repoName: string, prNumber: number): Promise<{
    review: PRReview;
    checks: PRReviewCheck[];
    aggregated: AggregatedResult;
  } | null> {
    const result = await this.tracker.getReviewByPR(repoOwner, repoName, prNumber);
    if (!result) {
      return null;
    }

    const aggregated = this.aggregator.aggregate(result.checks);

    return {
      review: result.review,
      checks: result.checks,
      aggregated,
    };
  }

  /**
   * Update merge status based on current check results
   */
  async updateMergeStatus(reviewId: string): Promise<AggregatedResult> {
    const result = await this.tracker.getReview(reviewId);
    if (!result) {
      throw new Error(`Review ${reviewId} not found`);
    }

    const aggregated = this.aggregator.aggregate(result.checks);

    // Update merge_blocked in database
    await this.tracker.updateMergeBlocked(reviewId, aggregated.mergeBlocked);

    // Update review status if all checks completed
    const allCompleted = result.checks.every(c => c.status === 'success' || c.status === 'failure');
    if (allCompleted) {
      const status = aggregated.mergeBlocked ? 'failed' : 'completed';
      await this.tracker.updateReviewStatus(reviewId, status);
    }

    return aggregated;
  }

  /**
   * Override review to allow merge despite failures
   */
  async overrideReview(reviewId: string, user: string, reason: string): Promise<void> {
    await this.tracker.markOverridden(reviewId, user, reason);
  }

  /**
   * List all reviews with optional filters
   */
  async listReviews(filters?: {
    status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    repoOwner?: string;
    repoName?: string;
    mergeBlocked?: boolean;
  }): Promise<PRReview[]> {
    return this.tracker.listReviews(filters);
  }
}
