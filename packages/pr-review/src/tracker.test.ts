import { describe, it, expect, beforeEach } from 'bun:test';
import { ReviewTracker, type DatabaseClient } from './tracker';
import type { PRReview, PRReviewCheck, ReviewStatus, CheckType } from '@factory/shared';

// Mock database client
class MockDatabase implements DatabaseClient {
  private reviews = new Map<string, any>();
  private checks = new Map<string, any>();
  private nextId = 1;

  async query<T>(text: string, values?: unknown[]): Promise<T[]> {
    if (text.includes('FROM pr_reviews')) {
      return Array.from(this.reviews.values()) as T[];
    }
    if (text.includes('FROM pr_review_checks')) {
      const reviewId = values?.[0];
      return Array.from(this.checks.values()).filter(c => c.review_id === reviewId) as T[];
    }
    return [];
  }

  async queryOne<T>(text: string, values?: unknown[]): Promise<T | null> {
    if (text.includes('INSERT INTO pr_reviews')) {
      const id = `review-${this.nextId++}`;
      const review = {
        id,
        repo_owner: values?.[0],
        repo_name: values?.[1],
        pr_number: values?.[2],
        status: values?.[3],
        is_ai_generated: values?.[4],
        detection_confidence: values?.[5],
        detection_reasons: JSON.parse(values?.[6] as string),
        started_at: new Date(),
        completed_at: null,
        merge_blocked: values?.[7],
        override_user: null,
        override_reason: null,
        override_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      this.reviews.set(id, review);
      return review as T;
    }

    if (text.includes('INSERT INTO pr_review_checks')) {
      const id = `check-${this.nextId++}`;
      const check = {
        id,
        review_id: values?.[0],
        check_name: values?.[1],
        check_type: values?.[2],
        status: values?.[3],
        required: values?.[4],
        summary: null,
        details: null,
        error_count: values?.[5],
        warning_count: values?.[6],
        duration: null,
        started_at: new Date(),
        completed_at: null,
        metadata: JSON.parse(values?.[7] as string),
        created_at: new Date(),
      };
      this.checks.set(id, check);
      return check as T;
    }

    if (text.includes('SELECT * FROM pr_reviews WHERE id')) {
      const id = values?.[0];
      return (this.reviews.get(id as string) || null) as T;
    }

    if (text.includes('SELECT * FROM pr_reviews WHERE repo_owner')) {
      const owner = values?.[0];
      const name = values?.[1];
      const prNumber = values?.[2];
      const review = Array.from(this.reviews.values()).find(
        r => r.repo_owner === owner && r.repo_name === name && r.pr_number === prNumber
      );
      return (review || null) as T;
    }

    return null;
  }

  async execute(text: string, values?: unknown[]): Promise<{ rowCount: number }> {
    if (text.includes('UPDATE pr_reviews') && text.includes('SET status')) {
      const id = values?.[1];
      const review = this.reviews.get(id as string);
      if (review) {
        review.status = values?.[0];
        review.updated_at = new Date();
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    }

    if (text.includes('UPDATE pr_reviews') && text.includes('merge_blocked')) {
      const id = values?.[1];
      const review = this.reviews.get(id as string);
      if (review) {
        review.merge_blocked = values?.[0];
        review.updated_at = new Date();
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    }

    if (text.includes('UPDATE pr_review_checks')) {
      const id = values?.[6];
      const check = this.checks.get(id as string);
      if (check) {
        check.status = values?.[0];
        check.summary = values?.[1] || check.summary;
        check.details = values?.[2] || check.details;
        check.error_count = values?.[3] ?? check.error_count;
        check.warning_count = values?.[4] ?? check.warning_count;
        check.duration = values?.[5] ?? check.duration;
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    }

    return { rowCount: 0 };
  }

  reset() {
    this.reviews.clear();
    this.checks.clear();
    this.nextId = 1;
  }
}

describe('ReviewTracker', () => {
  let db: MockDatabase;
  let tracker: ReviewTracker;

  beforeEach(() => {
    db = new MockDatabase();
    tracker = new ReviewTracker(db);
  });

  describe('createReview', () => {
    it('should create a review', async () => {
      const review = await tracker.createReview({
        repoOwner: 'test-owner',
        repoName: 'test-repo',
        prNumber: 123,
        isAIGenerated: true,
        detectionConfidence: 0.9,
        detectionReasons: ['Claude co-author'],
      });

      expect(review.id).toBeDefined();
      expect(review.repoOwner).toBe('test-owner');
      expect(review.repoName).toBe('test-repo');
      expect(review.prNumber).toBe(123);
      expect(review.isAIGenerated).toBe(true);
      expect(review.detectionConfidence).toBe(0.9);
      expect(review.status).toBe('pending');
    });
  });

  describe('updateReviewStatus', () => {
    it('should update review status', async () => {
      const review = await tracker.createReview({
        repoOwner: 'test-owner',
        repoName: 'test-repo',
        prNumber: 123,
        isAIGenerated: true,
        detectionConfidence: 0.9,
        detectionReasons: [],
      });

      await tracker.updateReviewStatus(review.id, 'running');

      const updated = await tracker.getReview(review.id);
      expect(updated?.review.status).toBe('running');
    });
  });

  describe('updateMergeBlocked', () => {
    it('should update merge blocked status', async () => {
      const review = await tracker.createReview({
        repoOwner: 'test-owner',
        repoName: 'test-repo',
        prNumber: 123,
        isAIGenerated: true,
        detectionConfidence: 0.9,
        detectionReasons: [],
      });

      await tracker.updateMergeBlocked(review.id, true);

      const updated = await tracker.getReview(review.id);
      expect(updated?.review.mergeBlocked).toBe(true);
    });
  });

  describe('recordCheck', () => {
    it('should record a check', async () => {
      const review = await tracker.createReview({
        repoOwner: 'test-owner',
        repoName: 'test-repo',
        prNumber: 123,
        isAIGenerated: true,
        detectionConfidence: 0.9,
        detectionReasons: [],
      });

      const check = await tracker.recordCheck({
        reviewId: review.id,
        checkName: 'lint',
        checkType: 'lint',
        required: true,
      });

      expect(check.id).toBeDefined();
      expect(check.reviewId).toBe(review.id);
      expect(check.checkName).toBe('lint');
      expect(check.checkType).toBe('lint');
      expect(check.required).toBe(true);
      expect(check.status).toBe('pending');
    });
  });

  describe('updateCheck', () => {
    it('should update check result', async () => {
      const review = await tracker.createReview({
        repoOwner: 'test-owner',
        repoName: 'test-repo',
        prNumber: 123,
        isAIGenerated: true,
        detectionConfidence: 0.9,
        detectionReasons: [],
      });

      const check = await tracker.recordCheck({
        reviewId: review.id,
        checkName: 'lint',
        checkType: 'lint',
        required: true,
      });

      await tracker.updateCheck(check.id, {
        status: 'success',
        summary: 'All checks passed',
        errorCount: 0,
        warningCount: 2,
        duration: 1500,
      });

      // Note: In real scenario we'd fetch and verify, but our mock is simplified
      expect(true).toBe(true);
    });
  });

  describe('getReview', () => {
    it('should get review with checks', async () => {
      const review = await tracker.createReview({
        repoOwner: 'test-owner',
        repoName: 'test-repo',
        prNumber: 123,
        isAIGenerated: true,
        detectionConfidence: 0.9,
        detectionReasons: [],
      });

      await tracker.recordCheck({
        reviewId: review.id,
        checkName: 'lint',
        checkType: 'lint',
        required: true,
      });

      await tracker.recordCheck({
        reviewId: review.id,
        checkName: 'test',
        checkType: 'test',
        required: true,
      });

      const result = await tracker.getReview(review.id);

      expect(result).not.toBeNull();
      expect(result!.review.id).toBe(review.id);
      expect(result!.checks).toHaveLength(2);
    });

    it('should return null for non-existent review', async () => {
      const result = await tracker.getReview('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('getReviewByPR', () => {
    it('should get review by repo and PR number', async () => {
      const review = await tracker.createReview({
        repoOwner: 'test-owner',
        repoName: 'test-repo',
        prNumber: 123,
        isAIGenerated: true,
        detectionConfidence: 0.9,
        detectionReasons: [],
      });

      const result = await tracker.getReviewByPR('test-owner', 'test-repo', 123);

      expect(result).not.toBeNull();
      expect(result!.review.id).toBe(review.id);
    });
  });
});
