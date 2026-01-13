import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { ReviewApiClient } from '../api';
import type { ReviewRecord, TriggerReviewRequest } from '../api';

describe('ReviewApiClient', () => {
  let client: ReviewApiClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    client = new ReviewApiClient('/api/test');
    originalFetch = globalThis.fetch;
  });

  test('should construct with default base URL', () => {
    const defaultClient = new ReviewApiClient();
    expect(defaultClient).toBeDefined();
  });

  test('should construct with custom base URL', () => {
    const customClient = new ReviewApiClient('/custom/api');
    expect(customClient).toBeDefined();
  });

  test('should build query params for fetchReviews', () => {
    const params = new URLSearchParams();
    params.set('owner', 'test-owner');
    params.set('repo', 'test-repo');
    params.set('status', 'PASS');
    params.set('aiOnly', 'true');
    params.set('limit', '10');

    expect(params.get('owner')).toBe('test-owner');
    expect(params.get('repo')).toBe('test-repo');
    expect(params.get('status')).toBe('PASS');
    expect(params.get('aiOnly')).toBe('true');
    expect(params.get('limit')).toBe('10');
  });

  test('should handle empty query params', () => {
    const params = new URLSearchParams();
    expect(params.toString()).toBe('');
  });

  test('should validate trigger request structure', () => {
    const request: TriggerReviewRequest = {
      owner: 'test-owner',
      repo: 'test-repo',
      pullNumber: 123,
      workflow: 'default',
      sha: 'abc123',
    };

    expect(request.owner).toBe('test-owner');
    expect(request.repo).toBe('test-repo');
    expect(request.pullNumber).toBe(123);
    expect(request.workflow).toBe('default');
    expect(request.sha).toBe('abc123');
  });

  test('should validate trigger request without optional sha', () => {
    const request: TriggerReviewRequest = {
      owner: 'test-owner',
      repo: 'test-repo',
      pullNumber: 123,
      workflow: 'default',
    };

    expect(request.owner).toBe('test-owner');
    expect(request.repo).toBe('test-repo');
    expect(request.pullNumber).toBe(123);
    expect(request.workflow).toBe('default');
    expect(request.sha).toBeUndefined();
  });

  test('should validate review record structure', () => {
    const record: ReviewRecord = {
      id: 'test-id',
      pullRequest: {
        owner: 'test-owner',
        repo: 'test-repo',
        number: 123,
        title: 'Test PR',
        sha: 'abc123',
        aiGenerated: true,
      },
      workflow: 'default',
      result: {
        status: 'PASS',
        results: [],
        totalErrors: 0,
        totalWarnings: 0,
        totalInfo: 0,
        totalDurationMs: 1000,
      },
      triggeredBy: 'manual',
      triggeredAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    expect(record.id).toBe('test-id');
    expect(record.pullRequest.number).toBe(123);
    expect(record.result.status).toBe('PASS');
    expect(record.triggeredBy).toBe('manual');
  });

  test('should handle review record without completedAt', () => {
    const record: ReviewRecord = {
      id: 'test-id',
      pullRequest: {
        owner: 'test-owner',
        repo: 'test-repo',
        number: 123,
        title: 'Test PR',
        sha: 'abc123',
        aiGenerated: false,
      },
      workflow: 'default',
      result: {
        status: 'PENDING',
        results: [],
        totalErrors: 0,
        totalWarnings: 0,
        totalInfo: 0,
        totalDurationMs: 0,
      },
      triggeredBy: 'webhook',
      triggeredAt: new Date().toISOString(),
    };

    expect(record.completedAt).toBeUndefined();
    expect(record.result.status).toBe('PENDING');
  });

  test('should validate trigger response structure', () => {
    const response = {
      reviewId: 'test-review-id',
      status: 'queued' as const,
    };

    expect(response.reviewId).toBe('test-review-id');
    expect(response.status).toBe('queued');
  });
});
