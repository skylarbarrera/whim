import { describe, it, expect } from 'bun:test';
import { ResultAggregator } from './aggregator';
import type { PRReviewCheck } from '@factory/shared';

describe('ResultAggregator', () => {
  const aggregator = new ResultAggregator();

  const createCheck = (overrides?: Partial<PRReviewCheck>): PRReviewCheck => ({
    id: 'check-1',
    reviewId: 'review-1',
    checkName: 'test-check',
    checkType: 'test',
    status: 'pending',
    required: true,
    summary: null,
    details: null,
    errorCount: 0,
    warningCount: 0,
    duration: null,
    startedAt: new Date(),
    completedAt: null,
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  });

  describe('aggregate', () => {
    it('should allow merge when all required checks success', () => {
      const checks = [
        createCheck({ checkName: 'lint', status: 'success', required: true }),
        createCheck({ checkName: 'test', status: 'success', required: true }),
      ];

      const result = aggregator.aggregate(checks);

      expect(result.mergeBlocked).toBe(false);
      expect(result.requiredChecksPassed).toBe(2);
      expect(result.requiredChecksTotal).toBe(2);
      expect(result.summary).toContain('All required checks success');
      expect(result.summary).toContain('Ready to merge');
    });

    it('should block merge when required check failure', () => {
      const checks = [
        createCheck({ checkName: 'lint', status: 'success', required: true }),
        createCheck({ checkName: 'test', status: 'failure', required: true }),
      ];

      const result = aggregator.aggregate(checks);

      expect(result.mergeBlocked).toBe(true);
      expect(result.requiredChecksPassed).toBe(1);
      expect(result.requiredChecksTotal).toBe(2);
      expect(result.summary).toContain('1 required check(s) failure');
      expect(result.summary).toContain('Merge blocked');
    });

    it('should block merge when required check pending', () => {
      const checks = [
        createCheck({ checkName: 'lint', status: 'success', required: true }),
        createCheck({ checkName: 'test', status: 'pending', required: true }),
      ];

      const result = aggregator.aggregate(checks);

      expect(result.mergeBlocked).toBe(true);
      expect(result.requiredChecksPassed).toBe(1);
      expect(result.requiredChecksTotal).toBe(2);
      expect(result.summary).toContain('1 required check(s) pending');
    });

    it('should allow merge with optional check failures', () => {
      const checks = [
        createCheck({ checkName: 'lint', status: 'success', required: true }),
        createCheck({ checkName: 'test', status: 'success', required: true }),
        createCheck({ checkName: 'quality', status: 'failure', required: false }),
      ];

      const result = aggregator.aggregate(checks);

      expect(result.mergeBlocked).toBe(false);
      expect(result.optionalChecksPassed).toBe(0);
      expect(result.optionalChecksTotal).toBe(1);
      expect(result.summary).toContain('Ready to merge');
    });

    it('should categorize checks by status', () => {
      const checks = [
        createCheck({ checkName: 'lint', status: 'success', required: true }),
        createCheck({ checkName: 'test', status: 'failure', required: true }),
        createCheck({ checkName: 'build', status: 'pending', required: true }),
        createCheck({ checkName: 'typecheck', status: 'running', required: true }),
      ];

      const result = aggregator.aggregate(checks);

      expect(result.details.passed).toEqual(['lint']);
      expect(result.details.failed).toEqual(['test']);
      expect(result.details.pending).toEqual(['build', 'typecheck']);
    });

    it('should handle no checks', () => {
      const checks: PRReviewCheck[] = [];

      const result = aggregator.aggregate(checks);

      expect(result.mergeBlocked).toBe(false);
      expect(result.requiredChecksPassed).toBe(0);
      expect(result.requiredChecksTotal).toBe(0);
      expect(result.summary).toContain('All required checks success');
    });

    it('should handle all optional checks', () => {
      const checks = [
        createCheck({ checkName: 'quality', status: 'success', required: false }),
        createCheck({ checkName: 'security', status: 'success', required: false }),
      ];

      const result = aggregator.aggregate(checks);

      expect(result.mergeBlocked).toBe(false);
      expect(result.requiredChecksPassed).toBe(0);
      expect(result.requiredChecksTotal).toBe(0);
      expect(result.optionalChecksPassed).toBe(2);
      expect(result.optionalChecksTotal).toBe(2);
    });

    it('should include optional check count in summary', () => {
      const checks = [
        createCheck({ checkName: 'lint', status: 'success', required: true }),
        createCheck({ checkName: 'test', status: 'success', required: true }),
        createCheck({ checkName: 'quality', status: 'success', required: false }),
        createCheck({ checkName: 'security', status: 'failure', required: false }),
      ];

      const result = aggregator.aggregate(checks);

      expect(result.summary).toContain('1/2 optional checks success');
    });

    it('should handle running checks as blocking', () => {
      const checks = [
        createCheck({ checkName: 'lint', status: 'success', required: true }),
        createCheck({ checkName: 'test', status: 'running', required: true }),
      ];

      const result = aggregator.aggregate(checks);

      expect(result.mergeBlocked).toBe(true);
      expect(result.summary).toContain('pending');
    });
  });
});
