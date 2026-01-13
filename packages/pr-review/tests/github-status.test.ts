import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { GitHubStatusClient, REVIEW_STATUS_CONTEXT, type StatusState } from '../src/github-status';
import type { PRReview } from '@factory/shared';

// Mock Octokit
const mockCreateCommitStatus = mock(() => Promise.resolve({
  data: {
    id: 123,
    state: 'success',
    context: REVIEW_STATUS_CONTEXT,
    description: 'All checks passed',
    target_url: 'http://localhost:3002/reviews/review-1',
    created_at: '2026-01-13T00:00:00Z',
    updated_at: '2026-01-13T00:00:00Z',
  },
}));

const mockListCommitStatusesForRef = mock(() => Promise.resolve({
  data: [
    {
      id: 123,
      state: 'success',
      context: REVIEW_STATUS_CONTEXT,
      description: 'All checks passed',
      target_url: 'http://localhost:3002/reviews/review-1',
      created_at: '2026-01-13T00:00:00Z',
      updated_at: '2026-01-13T00:00:00Z',
    },
  ],
}));

mock.module('@octokit/rest', () => ({
  Octokit: class {
    repos = {
      createCommitStatus: mockCreateCommitStatus,
      listCommitStatusesForRef: mockListCommitStatusesForRef,
    };
  },
}));

describe('GitHubStatusClient', () => {
  let client: GitHubStatusClient;

  beforeEach(() => {
    client = new GitHubStatusClient('fake-token', 'http://localhost:3002');
    mockCreateCommitStatus.mockClear();
    mockListCommitStatusesForRef.mockClear();
  });

  describe('createStatus', () => {
    it('should create a commit status', async () => {
      const result = await client.createStatus({
        owner: 'test-owner',
        repo: 'test-repo',
        sha: 'abc123',
        state: 'success',
        description: 'All checks passed',
        targetUrl: 'http://localhost:3002/reviews/review-1',
      });

      expect(mockCreateCommitStatus).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        sha: 'abc123',
        state: 'success',
        context: REVIEW_STATUS_CONTEXT,
        description: 'All checks passed',
        target_url: 'http://localhost:3002/reviews/review-1',
      });

      expect(result.state).toBe('success');
      expect(result.context).toBe(REVIEW_STATUS_CONTEXT);
    });

    it('should truncate long descriptions', async () => {
      const longDescription = 'x'.repeat(200);

      await client.createStatus({
        owner: 'test-owner',
        repo: 'test-repo',
        sha: 'abc123',
        state: 'failure',
        description: longDescription,
      });

      const call = mockCreateCommitStatus.mock.calls[0][0];
      expect(call.description.length).toBeLessThanOrEqual(140);
      expect(call.description.endsWith('...')).toBe(true);
    });
  });

  describe('createStatusFromReview', () => {
    it('should create success status for completed non-blocked review', async () => {
      const review: PRReview = {
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
      };

      await client.createStatusFromReview(review, false);

      const call = mockCreateCommitStatus.mock.calls[0][0];
      expect(call.state).toBe('success');
      expect(call.description).toContain('passed');
    });

    it('should create failure status for completed blocked review', async () => {
      const review: PRReview = {
        id: 'review-1',
        repoOwner: 'test-owner',
        repoName: 'test-repo',
        prNumber: 1,
        headSha: 'abc123',
        status: 'completed',
        isAIGenerated: true,
        detectionConfidence: 0.9,
        detectionReasons: ['co-author'],
        mergeBlocked: true,
        startedAt: new Date(),
        completedAt: null,
        mergeBlocked: false,
        overrideUser: null,
        overrideReason: null,
        overrideAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await client.createStatusFromReview(review, true);

      const call = mockCreateCommitStatus.mock.calls[0][0];
      expect(call.state).toBe('failure');
      expect(call.description).toContain('blocked');
    });

    it('should create pending status for running review', async () => {
      const review: PRReview = {
        id: 'review-1',
        repoOwner: 'test-owner',
        repoName: 'test-repo',
        prNumber: 1,
        headSha: 'abc123',
        status: 'running',
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
      };

      await client.createStatusFromReview(review, false);

      const call = mockCreateCommitStatus.mock.calls[0][0];
      expect(call.state).toBe('pending');
    });

    it('should create success status for overridden review', async () => {
      const review: PRReview = {
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
        overrideUser: 'admin',
        overriddenBy: 'admin',
        overrideReason: 'Emergency hotfix',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await client.createStatusFromReview(review, false);

      const call = mockCreateCommitStatus.mock.calls[0][0];
      expect(call.state).toBe('success');
      expect(call.description).toContain('overridden');
      expect(call.description).toContain('admin');
    });
  });

  describe('getStatuses', () => {
    it('should get all statuses for a commit', async () => {
      const statuses = await client.getStatuses('test-owner', 'test-repo', 'abc123');

      expect(mockListCommitStatusesForRef).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        ref: 'abc123',
      });

      expect(statuses).toHaveLength(1);
      expect(statuses[0].context).toBe(REVIEW_STATUS_CONTEXT);
    });
  });

  describe('getReviewStatus', () => {
    it('should get AI factory review status', async () => {
      const status = await client.getReviewStatus('test-owner', 'test-repo', 'abc123');

      expect(status).not.toBeNull();
      expect(status?.context).toBe(REVIEW_STATUS_CONTEXT);
    });

    it('should return null if review status not found', async () => {
      mockListCommitStatusesForRef.mockResolvedValueOnce({
        data: [
          {
            id: 456,
            state: 'success',
            context: 'ci/other-check',
            description: 'Other check',
            target_url: null,
            created_at: '2026-01-13T00:00:00Z',
            updated_at: '2026-01-13T00:00:00Z',
          },
        ],
      });

      const status = await client.getReviewStatus('test-owner', 'test-repo', 'abc123');

      expect(status).toBeNull();
    });
  });
});
