import type { PRReview, PRReviewCheck, PRContext, CheckType, CheckResult } from '@factory/shared';
import { PRDetector } from './detector.js';
import { ReviewTracker, type DatabaseClient } from './tracker.js';
import { ResultAggregator, type AggregatedResult } from './aggregator.js';
import { BaseCheck } from './checks/base-check.js';
import { GitHubStatusClient } from './github-status.js';
import { MergeGuardian, type MergeDecision } from './merge-guardian.js';
import { BranchProtectionManager } from './branch-protection.js';

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
  private statusClient?: GitHubStatusClient;
  private guardian: MergeGuardian;
  private protectionManager?: BranchProtectionManager;

  constructor(
    db: DatabaseClient,
    config: ServiceConfig,
    githubToken?: string,
    dashboardUrl?: string
  ) {
    this.detector = new PRDetector();
    this.tracker = new ReviewTracker(db);
    this.aggregator = new ResultAggregator();
    this.config = config;

    // Optional GitHub integration
    if (githubToken) {
      this.statusClient = new GitHubStatusClient(githubToken, dashboardUrl);
      this.protectionManager = new BranchProtectionManager(githubToken);
    }

    this.guardian = new MergeGuardian(this.tracker, this.statusClient);
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

    // Get head SHA from latest commit
    const headSha = context.commits[context.commits.length - 1]?.sha || 'unknown';

    // Create review
    const review = await this.tracker.createReview({
      repoOwner: context.owner,
      repoName: context.repo,
      prNumber: context.prNumber,
      headSha,
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

  /**
   * Run a check and update its result in the database
   *
   * @param reviewId - Review ID
   * @param checkId - Check ID
   * @param check - Check instance to run
   * @param context - PR context
   * @param workdir - Working directory where repo is checked out
   * @returns Updated check record
   */
  async runCheck(
    reviewId: string,
    checkId: string,
    check: BaseCheck,
    context: PRContext,
    workdir: string
  ): Promise<PRReviewCheck> {
    // Update check status to running
    await this.tracker.updateCheck(checkId, {
      status: 'running',
      startedAt: new Date(),
    });

    try {
      // Run the check
      const result: CheckResult = await check.run(context, workdir);

      // Update check with result
      const updatedCheck = await this.tracker.updateCheck(checkId, {
        status: result.status,
        summary: result.summary,
        details: result.details,
        errorCount: result.errors?.length || 0,
        warningCount: result.warnings?.length || 0,
        duration: result.duration,
        completedAt: new Date(),
        metadata: result.metadata,
      });

      // Evaluate merge status and update GitHub
      await this.evaluateAndReportStatus(reviewId);

      return updatedCheck;
    } catch (error) {
      // Handle unexpected errors
      const message = error instanceof Error ? error.message : String(error);

      const updatedCheck = await this.tracker.updateCheck(checkId, {
        status: 'error',
        summary: 'Check failed with unexpected error',
        details: message,
        errorCount: 1,
        completedAt: new Date(),
        metadata: { error: message },
      });

      await this.evaluateAndReportStatus(reviewId);

      return updatedCheck;
    }
  }

  /**
   * Evaluate merge eligibility and report status to GitHub
   */
  async evaluateAndReportStatus(reviewId: string): Promise<MergeDecision> {
    // Update merge status in database
    await this.updateMergeStatus(reviewId);

    // Evaluate with guardian
    const decision = await this.guardian.evaluateAndUpdate(reviewId);

    return decision;
  }

  /**
   * Report current status to GitHub
   */
  async reportStatus(reviewId: string): Promise<void> {
    if (!this.statusClient) {
      return; // GitHub integration not configured
    }

    const review = await this.tracker.getReview(reviewId);
    if (!review) {
      throw new Error(`Review ${reviewId} not found`);
    }

    const decision = await this.guardian.canMerge(reviewId);
    await this.statusClient.createStatusFromReview(
      review.review,
      !decision.allowed
    );
  }

  /**
   * Synchronize branch protection rules for a repository
   *
   * Ensures AI factory review is required on specified branches
   */
  async syncProtection(
    owner: string,
    repo: string,
    branches: string[] = ['main', 'master']
  ): Promise<Map<string, boolean>> {
    if (!this.protectionManager) {
      throw new Error('GitHub integration not configured');
    }

    return this.protectionManager.syncProtectionAcrossBranches(
      owner,
      repo,
      branches
    );
  }

  /**
   * Emergency override to allow merge despite failures
   */
  async emergencyOverride(
    reviewId: string,
    user: string,
    reason: string
  ): Promise<MergeDecision> {
    const decision = await this.guardian.override({
      reviewId,
      user,
      reason,
    });

    // Update review status to completed
    await this.tracker.updateReviewStatus(reviewId, 'completed');

    return decision;
  }

  /**
   * Check if PR can be merged
   */
  async canMerge(reviewId: string): Promise<MergeDecision> {
    return this.guardian.canMerge(reviewId);
  }

  /**
   * Get check summary for a review
   */
  async getCheckSummary(reviewId: string): Promise<{
    total: number;
    required: number;
    passed: number;
    failed: number;
    pending: number;
  }> {
    return this.guardian.getCheckSummary(reviewId);
  }
}
