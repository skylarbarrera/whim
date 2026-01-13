import { describe, it, expect, beforeEach } from 'bun:test';
import { ReviewService } from './service';
import type { DatabaseClient } from './tracker';
import type { PRContext } from '@factory/shared';

// Simple mock database
class MockDatabase implements DatabaseClient {
  private data = new Map<string, any>();
  private nextId = 1;

  async query<T>(_text: string, _values?: unknown[]): Promise<T[]> {
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
        status: 'pending',
        is_ai_generated: values?.[4],
        detection_confidence: values?.[5],
        detection_reasons: JSON.parse(values?.[6] as string),
        started_at: new Date(),
        completed_at: null,
        merge_blocked: false,
        override_user: null,
        override_reason: null,
        override_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      this.data.set(`review:${id}`, review);
      return review as T;
    }

    if (text.includes('INSERT INTO pr_review_checks')) {
      const id = `check-${this.nextId++}`;
      const check = {
        id,
        review_id: values?.[0],
        check_name: values?.[1],
        check_type: values?.[2],
        status: 'pending',
        required: values?.[4],
        summary: null,
        details: null,
        error_count: 0,
        warning_count: 0,
        duration: null,
        started_at: new Date(),
        completed_at: null,
        metadata: {},
        created_at: new Date(),
      };
      this.data.set(`check:${id}`, check);
      return check as T;
    }

    if (text.includes('SELECT * FROM pr_reviews WHERE id')) {
      const id = values?.[0];
      return (this.data.get(`review:${id}`) || null) as T;
    }

    return null;
  }

  async execute(_text: string, _values?: unknown[]): Promise<{ rowCount: number }> {
    return { rowCount: 1 };
  }
}

describe('ReviewService', () => {
  let db: MockDatabase;
  let service: ReviewService;

  beforeEach(() => {
    db = new MockDatabase();
    service = new ReviewService(db, {
      checks: [
        { name: 'lint', type: 'lint', required: true },
        { name: 'test', type: 'test', required: true },
        { name: 'quality', type: 'quality', required: false },
      ],
    });
  });

  const createContext = (overrides?: Partial<PRContext>): PRContext => ({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 123,
    commits: [],
    branch: 'feature/test',
    baseBranch: 'main',
    labels: [],
    description: 'Test PR',
    changedFiles: [],
    ...overrides,
  });

  describe('detectAndCreateReview', () => {
    it('should create review for AI-generated PR', async () => {
      const context = createContext({
        commits: [
          {
            sha: 'abc123',
            message: 'feat: add feature\n\nCo-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>',
            author: 'test-user',
          },
        ],
      });

      const result = await service.detectAndCreateReview(context);

      expect(result).not.toBeNull();
      expect(result!.review.isAIGenerated).toBe(true);
      expect(result!.checks).toHaveLength(3);
      expect(result!.checks[0].checkName).toBe('lint');
      expect(result!.checks[1].checkName).toBe('test');
      expect(result!.checks[2].checkName).toBe('quality');
    });

    it('should return null for non-AI PR', async () => {
      const context = createContext({
        commits: [
          {
            sha: 'abc123',
            message: 'feat: add feature',
            author: 'test-user',
          },
        ],
      });

      const result = await service.detectAndCreateReview(context);

      expect(result).toBeNull();
    });

    it('should mark required checks correctly', async () => {
      const context = createContext({
        commits: [
          {
            sha: 'abc123',
            message: 'feat: add feature\n\nCo-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>',
            author: 'test-user',
          },
        ],
      });

      const result = await service.detectAndCreateReview(context);

      expect(result).not.toBeNull();
      expect(result!.checks[0].required).toBe(true); // lint
      expect(result!.checks[1].required).toBe(true); // test
      expect(result!.checks[2].required).toBe(false); // quality
    });
  });

  describe('getReviewStatus', () => {
    it('should return null for non-existent review', async () => {
      const result = await service.getReviewStatus('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('configuration', () => {
    it('should use configured checks', async () => {
      const customService = new ReviewService(db, {
        checks: [
          { name: 'custom-check', type: 'lint', required: true },
        ],
      });

      const context = createContext({
        branch: 'ai/issue-1',
        commits: [
          {
            sha: 'abc123',
            message: 'feat: test\n\nCo-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>',
            author: 'user',
          },
        ],
      });

      const result = await customService.detectAndCreateReview(context);

      expect(result).not.toBeNull();
      expect(result!.checks).toHaveLength(1);
      expect(result!.checks[0].checkName).toBe('custom-check');
    });
  });
});
