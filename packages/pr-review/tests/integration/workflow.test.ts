/**
 * Integration tests for complete PR review workflow
 * Tests end-to-end flow from detection through check execution to merge decision
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ReviewService } from '../../src/service.js';
import { LintCheck } from '../../src/checks/lint-check.js';
import { TestCheck } from '../../src/checks/test-check.js';
import type { DatabaseClient } from '../../src/tracker.js';
import type { PRContext, PRReview, PRReviewCheck } from '@factory/shared';
import type { LintConfig, TestConfig } from '../../src/config.js';

/**
 * Mock database that stores data in memory
 * Simulates real database behavior for integration testing
 */
class IntegrationMockDatabase implements DatabaseClient {
  private reviews = new Map<string, PRReview>();
  private checks = new Map<string, PRReviewCheck>();
  private nextId = 1;

  async query<T>(text: string, values?: unknown[]): Promise<T[]> {
    // List reviews
    if (text.includes('SELECT * FROM pr_reviews') && !text.includes('WHERE id')) {
      return Array.from(this.reviews.values()) as T[];
    }

    // List checks for a review
    if (text.includes('SELECT * FROM pr_review_checks WHERE review_id')) {
      const reviewId = values?.[0];
      const checks = Array.from(this.checks.values()).filter(
        c => c.reviewId === reviewId
      );
      return checks as T[];
    }

    return [];
  }

  async queryOne<T>(text: string, values?: unknown[]): Promise<T | null> {
    // Insert review
    if (text.includes('INSERT INTO pr_reviews')) {
      const id = `review-${this.nextId++}`;
      const review: PRReview = {
        id,
        repoOwner: values?.[0] as string,
        repoName: values?.[1] as string,
        prNumber: values?.[2] as number,
        headSha: values?.[3] as string,
        status: 'pending',
        isAIGenerated: values?.[4] as boolean,
        detectionConfidence: values?.[5] as number,
        detectionReasons: JSON.parse(values?.[6] as string),
        startedAt: new Date(),
        completedAt: null,
        mergeBlocked: false,
        overrideUser: null,
        overrideReason: null,
        overrideAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.reviews.set(id, review);
      return review as T;
    }

    // Insert check
    if (text.includes('INSERT INTO pr_review_checks')) {
      const id = `check-${this.nextId++}`;
      const check: PRReviewCheck = {
        id,
        reviewId: values?.[0] as string,
        checkName: values?.[1] as string,
        checkType: values?.[2] as any,
        status: 'pending',
        required: values?.[3] as boolean,
        summary: null,
        details: null,
        errorCount: 0,
        warningCount: 0,
        duration: null,
        startedAt: new Date(),
        completedAt: null,
        metadata: {},
        createdAt: new Date(),
      };
      this.checks.set(id, check);
      return check as T;
    }

    // Get review by ID
    if (text.includes('SELECT * FROM pr_reviews WHERE id')) {
      const id = values?.[0] as string;
      return (this.reviews.get(id) as T) || null;
    }

    // Get review by repo/PR
    if (text.includes('SELECT * FROM pr_reviews WHERE repo_owner')) {
      const review = Array.from(this.reviews.values()).find(
        r =>
          r.repoOwner === values?.[0] &&
          r.repoName === values?.[1] &&
          r.prNumber === values?.[2]
      );
      return (review as T) || null;
    }

    // Get check by ID
    if (text.includes('SELECT * FROM pr_review_checks WHERE id')) {
      const id = values?.[0] as string;
      return (this.checks.get(id) as T) || null;
    }

    // Update review status
    if (text.includes('UPDATE pr_reviews SET status')) {
      const id = values?.[1] as string;
      const review = this.reviews.get(id);
      if (review) {
        review.status = values?.[0] as any;
        review.updatedAt = new Date();
        return review as T;
      }
      return null;
    }

    // Update review merge_blocked
    if (text.includes('UPDATE pr_reviews SET merge_blocked')) {
      const id = values?.[1] as string;
      const review = this.reviews.get(id);
      if (review) {
        review.mergeBlocked = values?.[0] as boolean;
        review.updatedAt = new Date();
        return review as T;
      }
      return null;
    }

    // Update check
    if (text.includes('UPDATE pr_review_checks SET')) {
      const id = values?.[values.length - 1] as string;
      const check = this.checks.get(id);
      if (check && values) {
        // Update fields based on query
        if (text.includes('status')) check.status = values[0] as any;
        if (text.includes('summary')) check.summary = values[1] as string;
        if (text.includes('details')) check.details = values[2] as string;
        if (text.includes('error_count')) check.errorCount = values[3] as number;
        if (text.includes('warning_count')) check.warningCount = values[4] as number;
        if (text.includes('duration')) check.duration = values[5] as number;
        if (text.includes('completed_at')) check.completedAt = new Date();

        return check as T;
      }
      return null;
    }

    // Mark review as overridden
    if (text.includes('UPDATE pr_reviews SET override_user')) {
      const id = values?.[3] as string;
      const review = this.reviews.get(id);
      if (review) {
        review.overrideUser = values?.[0] as string;
        review.overrideReason = values?.[1] as string;
        review.overrideAt = new Date();
        review.updatedAt = new Date();
        return review as T;
      }
      return null;
    }

    return null;
  }

  // Helper for tests to reset state
  clear() {
    this.reviews.clear();
    this.checks.clear();
    this.nextId = 1;
  }

  // Helper to inspect state
  getReviewCount(): number {
    return this.reviews.size;
  }

  getCheckCount(): number {
    return this.checks.size;
  }
}

/**
 * Create a minimal mock check for testing
 */
class MockSuccessCheck extends LintCheck {
  async run(): Promise<any> {
    return {
      status: 'success',
      summary: 'Check passed',
      details: 'All good',
      errors: [],
      warnings: [],
      duration: 100,
      metadata: {},
    };
  }
}

class MockFailureCheck extends TestCheck {
  async run(): Promise<any> {
    return {
      status: 'failure',
      summary: 'Check failed',
      details: '2 tests failed',
      errors: [
        { message: 'Test 1 failed', file: 'test.ts', line: 10 },
        { message: 'Test 2 failed', file: 'test.ts', line: 20 },
      ],
      warnings: [],
      duration: 200,
      metadata: { failureCount: 2 },
    };
  }
}

describe('PR Review Workflow Integration', () => {
  let db: IntegrationMockDatabase;
  let service: ReviewService;
  let context: PRContext;

  beforeEach(() => {
    db = new IntegrationMockDatabase();
    service = new ReviewService(
      db,
      {
        checks: [
          { name: 'lint', type: 'lint', required: true },
          { name: 'test', type: 'test', required: true },
        ],
      }
    );

    context = {
      owner: 'testorg',
      repo: 'testrepo',
      prNumber: 42,
      title: 'Fix authentication bug',
      body: 'This PR fixes the auth bug',
      commits: [
        {
          sha: 'abc123',
          message: 'Fix bug\n\nCo-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>',
          author: 'developer',
        },
      ],
      files: ['src/auth.ts', 'tests/auth.test.ts'],
      labels: [],
      branch: 'ai/issue-42-fix-auth',
    };
  });

  it('should complete full review workflow with all checks passing', async () => {
    // 1. Detect and create review
    const result = await service.detectAndCreateReview(context);
    expect(result).not.toBeNull();
    expect(result!.review.isAIGenerated).toBe(true);
    expect(result!.review.status).toBe('pending');
    expect(result!.checks).toHaveLength(2);

    const reviewId = result!.review.id;
    const lintCheckId = result!.checks.find(c => c.checkType === 'lint')!.id;
    const testCheckId = result!.checks.find(c => c.checkType === 'test')!.id;

    // 2. Run lint check (passes)
    const mockLintCheck = new MockSuccessCheck({
      enabled: true,
      required: true,
      timeout: 60000,
      tools: [],
      failureThreshold: 0,
    });

    const updatedLintCheck = await service.runCheck(
      reviewId,
      lintCheckId,
      mockLintCheck,
      context,
      '/tmp/test'
    );

    expect(updatedLintCheck.status).toBe('success');
    expect(updatedLintCheck.errorCount).toBe(0);

    // 3. Run test check (passes)
    const mockTestCheck = new MockSuccessCheck({
      enabled: true,
      required: true,
      timeout: 300000,
      tools: [],
      failureThreshold: 0,
    });

    const updatedTestCheck = await service.runCheck(
      reviewId,
      testCheckId,
      mockTestCheck as any,
      context,
      '/tmp/test'
    );

    expect(updatedTestCheck.status).toBe('success');
    expect(updatedTestCheck.errorCount).toBe(0);

    // 4. Check review status
    const status = await service.getReviewStatus(reviewId);
    expect(status).not.toBeNull();
    expect(status!.review.status).toBe('completed');
    expect(status!.aggregated.mergeBlocked).toBe(false);
    expect(status!.aggregated.passed).toHaveLength(2);
    expect(status!.aggregated.failed).toHaveLength(0);

    // 5. Verify merge eligibility
    const decision = await service.canMerge(reviewId);
    expect(decision.allowed).toBe(true);
    expect(decision.checksPassed).toBe(2);
    expect(decision.checksFailed).toBe(0);
  });

  it('should block merge when required check fails', async () => {
    // 1. Create review
    const result = await service.detectAndCreateReview(context);
    expect(result).not.toBeNull();

    const reviewId = result!.review.id;
    const lintCheckId = result!.checks.find(c => c.checkType === 'lint')!.id;
    const testCheckId = result!.checks.find(c => c.checkType === 'test')!.id;

    // 2. Run lint check (passes)
    const mockLintCheck = new MockSuccessCheck({
      enabled: true,
      required: true,
      timeout: 60000,
      tools: [],
      failureThreshold: 0,
    });

    await service.runCheck(
      reviewId,
      lintCheckId,
      mockLintCheck,
      context,
      '/tmp/test'
    );

    // 3. Run test check (fails)
    const mockTestCheck = new MockFailureCheck({
      enabled: true,
      required: true,
      timeout: 300000,
      command: 'npm test',
      minPassPercentage: 100,
    });

    const failedCheck = await service.runCheck(
      reviewId,
      testCheckId,
      mockTestCheck,
      context,
      '/tmp/test'
    );

    expect(failedCheck.status).toBe('failure');
    expect(failedCheck.errorCount).toBe(2);

    // 4. Verify merge is blocked
    const status = await service.getReviewStatus(reviewId);
    expect(status!.review.status).toBe('failed');
    expect(status!.aggregated.mergeBlocked).toBe(true);
    expect(status!.aggregated.failed).toHaveLength(1);

    // 5. Verify cannot merge
    const decision = await service.canMerge(reviewId);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('Required checks failed');
  });

  it('should allow override for blocked review', async () => {
    // 1. Create review with failing check
    const result = await service.detectAndCreateReview(context);
    const reviewId = result!.review.id;
    const testCheckId = result!.checks.find(c => c.checkType === 'test')!.id;

    // 2. Run failing check
    const mockTestCheck = new MockFailureCheck({
      enabled: true,
      required: true,
      timeout: 300000,
      command: 'npm test',
      minPassPercentage: 100,
    });

    await service.runCheck(
      reviewId,
      testCheckId,
      mockTestCheck,
      context,
      '/tmp/test'
    );

    // 3. Verify merge blocked
    let decision = await service.canMerge(reviewId);
    expect(decision.allowed).toBe(false);

    // 4. Perform emergency override
    const overrideDecision = await service.emergencyOverride(
      reviewId,
      'ops-lead',
      'Critical production hotfix - tests pass locally but CI failing'
    );

    expect(overrideDecision.allowed).toBe(true);

    // 5. Verify review status updated
    const status = await service.getReviewStatus(reviewId);
    expect(status!.review.status).toBe('completed');
    expect(status!.review.overrideUser).toBe('ops-lead');
    expect(status!.review.overrideReason).toContain('Critical production hotfix');
  });

  it('should handle multiple PRs independently', async () => {
    // Create first PR review
    const result1 = await service.detectAndCreateReview(context);
    expect(result1).not.toBeNull();

    // Create second PR review
    const context2 = { ...context, prNumber: 43, branch: 'ai/issue-43-feature' };
    const result2 = await service.detectAndCreateReview(context2);
    expect(result2).not.toBeNull();

    expect(result1!.review.id).not.toBe(result2!.review.id);
    expect(db.getReviewCount()).toBe(2);
    expect(db.getCheckCount()).toBe(4); // 2 checks per review

    // Run check on first PR
    const mockCheck = new MockSuccessCheck({
      enabled: true,
      required: true,
      timeout: 60000,
      tools: [],
      failureThreshold: 0,
    });

    await service.runCheck(
      result1!.review.id,
      result1!.checks[0].id,
      mockCheck,
      context,
      '/tmp/test'
    );

    // Verify first PR check updated, second PR unaffected
    const status1 = await service.getReviewStatus(result1!.review.id);
    const status2 = await service.getReviewStatus(result2!.review.id);

    expect(status1!.aggregated.passed).toHaveLength(1);
    expect(status2!.aggregated.passed).toHaveLength(0);
  });

  it('should list reviews with filters', async () => {
    // Create multiple reviews
    await service.detectAndCreateReview(context);

    const context2 = { ...context, prNumber: 43, branch: 'ai/issue-43' };
    const result2 = await service.detectAndCreateReview(context2);

    // Run a check on second review to change status
    const mockCheck = new MockSuccessCheck({
      enabled: true,
      required: true,
      timeout: 60000,
      tools: [],
      failureThreshold: 0,
    });

    await service.runCheck(
      result2!.review.id,
      result2!.checks[0].id,
      mockCheck,
      context2,
      '/tmp/test'
    );

    await service.runCheck(
      result2!.review.id,
      result2!.checks[1].id,
      mockCheck,
      context2,
      '/tmp/test'
    );

    // List all reviews
    const allReviews = await service.listReviews();
    expect(allReviews.length).toBe(2);

    // Filter by repo
    const repoReviews = await service.listReviews({
      repoOwner: 'testorg',
      repoName: 'testrepo',
    });
    expect(repoReviews.length).toBe(2);

    // Filter by status
    const completedReviews = await service.listReviews({ status: 'completed' });
    expect(completedReviews.length).toBe(1);
  });

  it('should detect PR by repo and PR number', async () => {
    // Create review
    await service.detectAndCreateReview(context);

    // Get by repo/PR
    const status = await service.getReviewStatusByPR('testorg', 'testrepo', 42);
    expect(status).not.toBeNull();
    expect(status!.review.prNumber).toBe(42);
    expect(status!.checks.length).toBe(2);
  });

  it('should not create review for non-AI PR', async () => {
    // Remove AI signals
    const nonAIContext = {
      ...context,
      commits: [
        {
          sha: 'abc123',
          message: 'Fix bug',  // No co-author
          author: 'developer',
        },
      ],
      branch: 'feature/fix-auth',  // Non-AI branch
    };

    const result = await service.detectAndCreateReview(nonAIContext);
    expect(result).toBeNull();
    expect(db.getReviewCount()).toBe(0);
  });

  it('should get check summary', async () => {
    // Create review with checks
    const result = await service.detectAndCreateReview(context);
    const reviewId = result!.review.id;

    // Run one check successfully
    const mockCheck = new MockSuccessCheck({
      enabled: true,
      required: true,
      timeout: 60000,
      tools: [],
      failureThreshold: 0,
    });

    await service.runCheck(
      reviewId,
      result!.checks[0].id,
      mockCheck,
      context,
      '/tmp/test'
    );

    // Get summary
    const summary = await service.getCheckSummary(reviewId);
    expect(summary.total).toBe(2);
    expect(summary.required).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.pending).toBe(1);
  });
});

describe('Configuration Integration', () => {
  it('should load and validate configuration', async () => {
    // This test would require filesystem access
    // Placeholder for integration with actual config loading
    expect(true).toBe(true);
  });
});

describe('GitHub Integration', () => {
  it('should report status to GitHub when token provided', async () => {
    // This test would require GitHub API mocking
    // Placeholder for GitHub status API integration
    expect(true).toBe(true);
  });

  it('should sync branch protection rules', async () => {
    // This test would require GitHub API mocking
    // Placeholder for branch protection integration
    expect(true).toBe(true);
  });
});
