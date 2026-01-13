import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { MergeGuardian, type MergeDecision } from '../src/merge-guardian';
import type { PRReview, PRReviewCheck, CheckStatus } from '@factory/shared';
import type { ReviewTracker } from '../src/tracker';
import type { GitHubStatusClient } from '../src/github-status';

// Mock ReviewTracker
const mockGetReview = mock(() => Promise.resolve(null));
const mockUpdateMergeBlocked = mock(() => Promise.resolve());
const mockMarkOverridden = mock(() => Promise.resolve());

const mockTracker: ReviewTracker = {
  getReview: mockGetReview,
  updateMergeBlocked: mockUpdateMergeBlocked,
  markOverridden: mockMarkOverridden,
} as any;

// Mock GitHubStatusClient
const mockCreateStatusFromReview = mock(() => Promise.resolve({
  id: 123,
  state: 'success' as const,
  context: 'ai-factory/pr-review',
  description: 'All checks passed',
  createdAt: '2026-01-13T00:00:00Z',
  updatedAt: '2026-01-13T00:00:00Z',
}));

const mockStatusClient: GitHubStatusClient = {
  createStatusFromReview: mockCreateStatusFromReview,
} as any;

describe('MergeGuardian', () => {
  let guardian: MergeGuardian;

  beforeEach(() => {
    guardian = new MergeGuardian(mockTracker, mockStatusClient);
    mockGetReview.mockClear();
    mockUpdateMergeBlocked.mockClear();
    mockMarkOverridden.mockClear();
    mockCreateStatusFromReview.mockClear();
  });

  const createReview = (overrides?: Partial<PRReview>): PRReview => ({
    id: 'review-1',
    repoOwner: 'test-owner',
    repoName: 'test-repo',
    prNumber: 1,
    headSha: 'abc123',
    status: 'completed',
    isAIGenerated: true,
    detectionConfidence: 0.9,
    detectionReasons: ['co-author'],
    mergeBlocked: false,
    startedAt: new Date(),
        completedAt: null,
        mergeBlocked: false,
        overrideUser: null,
        overrideReason: null,
        overrideAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const createCheck = (type: string, status: CheckStatus, required: boolean): PRReviewCheck => ({
    id: `check-${type}`,
    reviewId: 'review-1',
    checkName: type,
    checkType: type as any,
    status,
    required,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  describe('canMerge', () => {
    it('should return not allowed if review not found', async () => {
      mockGetReview.mockResolvedValueOnce(null);

      const decision = await guardian.canMerge('review-1');

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('not found');
    });

    it('should allow merge if overridden', async () => {
      const review = createReview({
        startedAt: new Date(),
        completedAt: null,
        mergeBlocked: false,
        overrideUser: 'admin',
        overriddenBy: 'admin',
        overrideReason: 'Emergency hotfix',
      });

      mockGetReview.mockResolvedValueOnce({
        review,
        checks: [],
      });

      const decision = await guardian.canMerge('review-1');

      expect(decision.allowed).toBe(true);
      expect(decision.overridden).toBe(true);
      expect(decision.reason).toContain('admin');
      expect(decision.reason).toContain('Emergency hotfix');
    });

    it('should allow merge if all required checks pass', async () => {
      const review = createReview();
      const checks = [
        createCheck('lint', 'success', true),
        createCheck('test', 'success', true),
        createCheck('optional-check', 'failure', false),
      ];

      mockGetReview.mockResolvedValueOnce({
        review,
        checks,
      });

      const decision = await guardian.canMerge('review-1');

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toContain('passed');
      expect(decision.failedChecks).toHaveLength(0);
      expect(decision.pendingChecks).toHaveLength(0);
    });

    it('should block merge if required check fails', async () => {
      const review = createReview();
      const checks = [
        createCheck('lint', 'success', true),
        createCheck('test', 'failure', true),
      ];

      mockGetReview.mockResolvedValueOnce({
        review,
        checks,
      });

      const decision = await guardian.canMerge('review-1');

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('failed');
      expect(decision.failedChecks).toContain('test');
    });

    it('should block merge if required check pending', async () => {
      const review = createReview();
      const checks = [
        createCheck('lint', 'success', true),
        createCheck('test', 'pending', true),
      ];

      mockGetReview.mockResolvedValueOnce({
        review,
        checks,
      });

      const decision = await guardian.canMerge('review-1');

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('pending');
      expect(decision.pendingChecks).toContain('test');
    });

    it('should handle multiple failed checks', async () => {
      const review = createReview();
      const checks = [
        createCheck('lint', 'failure', true),
        createCheck('test', 'error', true),
      ];

      mockGetReview.mockResolvedValueOnce({
        review,
        checks,
      });

      const decision = await guardian.canMerge('review-1');

      expect(decision.allowed).toBe(false);
      expect(decision.failedChecks).toHaveLength(2);
      expect(decision.failedChecks).toContain('lint');
      expect(decision.failedChecks).toContain('test');
    });

    it('should allow merge if no required checks', async () => {
      const review = createReview();
      const checks = [
        createCheck('optional-1', 'failure', false),
        createCheck('optional-2', 'success', false),
      ];

      mockGetReview.mockResolvedValueOnce({
        review,
        checks,
      });

      const decision = await guardian.canMerge('review-1');

      expect(decision.allowed).toBe(true);
    });
  });

  describe('blockMerge', () => {
    it('should update merge blocked status', async () => {
      const review = createReview();
      mockGetReview.mockResolvedValueOnce({ review, checks: [] });

      await guardian.blockMerge('review-1', 'Tests failed');

      expect(mockUpdateMergeBlocked).toHaveBeenCalledWith('review-1', true);
      expect(mockCreateStatusFromReview).toHaveBeenCalledWith(review, true);
    });
  });

  describe('allowMerge', () => {
    it('should update merge blocked status', async () => {
      const review = createReview();
      mockGetReview.mockResolvedValueOnce({ review, checks: [] });

      await guardian.allowMerge('review-1');

      expect(mockUpdateMergeBlocked).toHaveBeenCalledWith('review-1', false);
      expect(mockCreateStatusFromReview).toHaveBeenCalledWith(review, false);
    });
  });

  describe('isOverridden', () => {
    it('should return true if review is overridden', async () => {
      const review = createReview({ overridden: true });
      mockGetReview.mockResolvedValueOnce({ review, checks: [] });

      const result = await guardian.isOverridden('review-1');

      expect(result).toBe(true);
    });

    it('should return false if review is not overridden', async () => {
      const review = createReview({ startedAt: new Date(),
        completedAt: null,
        mergeBlocked: false,
        overrideUser: null,
        overrideReason: null,
        overrideAt: null });
      mockGetReview.mockResolvedValueOnce({ review, checks: [] });

      const result = await guardian.isOverridden('review-1');

      expect(result).toBe(false);
    });
  });

  describe('override', () => {
    it('should override review and allow merge', async () => {
      const review = createReview();
      const overriddenReview = createReview({
        startedAt: new Date(),
        completedAt: null,
        mergeBlocked: false,
        overrideUser: 'admin',
        overriddenBy: 'admin',
        overrideReason: 'Emergency',
      });

      mockGetReview
        .mockResolvedValueOnce({ review, checks: [] })
        .mockResolvedValueOnce({ review: overriddenReview, checks: [] });

      const decision = await guardian.override({
        reviewId: 'review-1',
        user: 'admin',
        reason: 'Emergency',
      });

      expect(mockMarkOverridden).toHaveBeenCalledWith('review-1', 'admin', 'Emergency');
      expect(mockUpdateMergeBlocked).toHaveBeenCalledWith('review-1', false);
      expect(decision.allowed).toBe(true);
      expect(decision.overridden).toBe(true);
    });

    it('should throw if review not found', async () => {
      mockGetReview.mockResolvedValueOnce(null);

      await expect(
        guardian.override({
          reviewId: 'review-1',
          user: 'admin',
          reason: 'Emergency',
        })
      ).rejects.toThrow('not found');
    });
  });

  describe('evaluateAndUpdate', () => {
    it('should evaluate and update merge status', async () => {
      const review = createReview();
      const checks = [
        createCheck('lint', 'success', true),
        createCheck('test', 'success', true),
      ];

      mockGetReview.mockResolvedValue({ review, checks });

      const decision = await guardian.evaluateAndUpdate('review-1');

      expect(decision.allowed).toBe(true);
      expect(mockUpdateMergeBlocked).toHaveBeenCalledWith('review-1', false);
      expect(mockCreateStatusFromReview).toHaveBeenCalled();
    });
  });

  describe('areChecksComplete', () => {
    it('should return true if all required checks are complete', async () => {
      const review = createReview();
      const checks = [
        createCheck('lint', 'success', true),
        createCheck('test', 'failure', true),
      ];

      mockGetReview.mockResolvedValueOnce({ review, checks });

      const complete = await guardian.areChecksComplete('review-1');

      expect(complete).toBe(true);
    });

    it('should return false if required checks are pending', async () => {
      const review = createReview();
      const checks = [
        createCheck('lint', 'success', true),
        createCheck('test', 'pending', true),
      ];

      mockGetReview.mockResolvedValueOnce({ review, checks });

      const complete = await guardian.areChecksComplete('review-1');

      expect(complete).toBe(false);
    });

    it('should return true if no required checks', async () => {
      const review = createReview();
      const checks = [createCheck('optional', 'pending', false)];

      mockGetReview.mockResolvedValueOnce({ review, checks });

      const complete = await guardian.areChecksComplete('review-1');

      expect(complete).toBe(true);
    });
  });

  describe('getCheckSummary', () => {
    it('should return check summary', async () => {
      const review = createReview();
      const checks = [
        createCheck('lint', 'success', true),
        createCheck('test', 'failure', true),
        createCheck('optional', 'pending', false),
      ];

      mockGetReview.mockResolvedValueOnce({ review, checks });

      const summary = await guardian.getCheckSummary('review-1');

      expect(summary.total).toBe(3);
      expect(summary.required).toBe(2);
      expect(summary.passed).toBe(1);
      expect(summary.failed).toBe(1);
      expect(summary.pending).toBe(1);
    });
  });
});
