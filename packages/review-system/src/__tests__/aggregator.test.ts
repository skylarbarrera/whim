import { describe, test, expect, beforeEach } from 'bun:test';
import { ResultAggregator } from '../orchestrator/aggregator.js';
import {
  ReviewStatus,
  ReviewSeverity,
  type ReviewStepResult,
} from '../types/review-result.js';

function createMockResult(
  stepName: string,
  status: ReviewStatus,
  messages: Array<{ severity: ReviewSeverity; message: string; file?: string }> = []
): ReviewStepResult {
  return {
    stepName,
    status,
    messages,
    durationMs: 100,
    startedAt: new Date(),
    completedAt: new Date(),
  };
}

describe('ResultAggregator', () => {
  let aggregator: ResultAggregator;

  beforeEach(() => {
    aggregator = new ResultAggregator();
  });

  describe('addResult', () => {
    test('adds a single result', () => {
      const result = createMockResult('step1', ReviewStatus.PASS);
      aggregator.addResult(result);

      const summary = aggregator.getSummary(new Date());
      expect(summary.stepResults).toHaveLength(1);
      expect(summary.stepResults[0]).toEqual(result);
    });
  });

  describe('addResults', () => {
    test('adds multiple results', () => {
      const results = [
        createMockResult('step1', ReviewStatus.PASS),
        createMockResult('step2', ReviewStatus.PASS),
        createMockResult('step3', ReviewStatus.FAIL),
      ];

      aggregator.addResults(results);

      const summary = aggregator.getSummary(new Date());
      expect(summary.stepResults).toHaveLength(3);
    });
  });

  describe('getOverallStatus', () => {
    test('returns PENDING when no results', () => {
      expect(aggregator.getOverallStatus()).toBe(ReviewStatus.PENDING);
    });

    test('returns PASS when all steps pass', () => {
      aggregator.addResults([
        createMockResult('step1', ReviewStatus.PASS),
        createMockResult('step2', ReviewStatus.PASS),
      ]);

      expect(aggregator.getOverallStatus()).toBe(ReviewStatus.PASS);
    });

    test('returns PASS when all steps pass or are skipped', () => {
      aggregator.addResults([
        createMockResult('step1', ReviewStatus.PASS),
        createMockResult('step2', ReviewStatus.SKIPPED),
      ]);

      expect(aggregator.getOverallStatus()).toBe(ReviewStatus.PASS);
    });

    test('returns FAIL when any step fails', () => {
      aggregator.addResults([
        createMockResult('step1', ReviewStatus.PASS),
        createMockResult('step2', ReviewStatus.FAIL),
        createMockResult('step3', ReviewStatus.PASS),
      ]);

      expect(aggregator.getOverallStatus()).toBe(ReviewStatus.FAIL);
    });

    test('returns ERROR when any step errors', () => {
      aggregator.addResults([
        createMockResult('step1', ReviewStatus.PASS),
        createMockResult('step2', ReviewStatus.ERROR),
      ]);

      expect(aggregator.getOverallStatus()).toBe(ReviewStatus.ERROR);
    });

    test('prioritizes ERROR over FAIL', () => {
      aggregator.addResults([
        createMockResult('step1', ReviewStatus.FAIL),
        createMockResult('step2', ReviewStatus.ERROR),
      ]);

      expect(aggregator.getOverallStatus()).toBe(ReviewStatus.ERROR);
    });

    test('returns PENDING if any step is pending', () => {
      aggregator.addResults([
        createMockResult('step1', ReviewStatus.PASS),
        createMockResult('step2', ReviewStatus.PENDING),
      ]);

      expect(aggregator.getOverallStatus()).toBe(ReviewStatus.PENDING);
    });
  });

  describe('getBlockingFailures', () => {
    test('returns empty array when no failures', () => {
      aggregator.addResults([
        createMockResult('step1', ReviewStatus.PASS),
        createMockResult('step2', ReviewStatus.PASS),
      ]);

      expect(aggregator.getBlockingFailures()).toEqual([]);
    });

    test('returns names of failed steps', () => {
      aggregator.addResults([
        createMockResult('step1', ReviewStatus.PASS),
        createMockResult('step2', ReviewStatus.FAIL),
        createMockResult('step3', ReviewStatus.FAIL),
      ]);

      expect(aggregator.getBlockingFailures()).toEqual(['step2', 'step3']);
    });

    test('does not include error steps', () => {
      aggregator.addResults([
        createMockResult('step1', ReviewStatus.FAIL),
        createMockResult('step2', ReviewStatus.ERROR),
      ]);

      expect(aggregator.getBlockingFailures()).toEqual(['step1']);
    });
  });

  describe('groupByFile', () => {
    test('groups messages by file path', () => {
      aggregator.addResults([
        createMockResult('step1', ReviewStatus.FAIL, [
          { severity: ReviewSeverity.ERROR, message: 'Error 1', file: 'src/a.ts' },
          { severity: ReviewSeverity.WARNING, message: 'Warning 1', file: 'src/b.ts' },
        ]),
        createMockResult('step2', ReviewStatus.FAIL, [
          { severity: ReviewSeverity.ERROR, message: 'Error 2', file: 'src/a.ts' },
        ]),
      ]);

      const grouped = aggregator.groupByFile();

      expect(grouped.size).toBe(2);
      expect(grouped.get('src/a.ts')).toHaveLength(2);
      expect(grouped.get('src/b.ts')).toHaveLength(1);
    });

    test('ignores messages without file path', () => {
      aggregator.addResults([
        createMockResult('step1', ReviewStatus.FAIL, [
          { severity: ReviewSeverity.ERROR, message: 'Error without file' },
          { severity: ReviewSeverity.ERROR, message: 'Error with file', file: 'src/a.ts' },
        ]),
      ]);

      const grouped = aggregator.groupByFile();

      expect(grouped.size).toBe(1);
      expect(grouped.has('src/a.ts')).toBe(true);
    });
  });

  describe('groupBySeverity', () => {
    test('groups messages by severity level', () => {
      aggregator.addResults([
        createMockResult('step1', ReviewStatus.FAIL, [
          { severity: ReviewSeverity.ERROR, message: 'Error 1' },
          { severity: ReviewSeverity.WARNING, message: 'Warning 1' },
          { severity: ReviewSeverity.INFO, message: 'Info 1' },
        ]),
        createMockResult('step2', ReviewStatus.FAIL, [
          { severity: ReviewSeverity.ERROR, message: 'Error 2' },
          { severity: ReviewSeverity.WARNING, message: 'Warning 2' },
        ]),
      ]);

      const grouped = aggregator.groupBySeverity();

      expect(grouped.get(ReviewSeverity.ERROR)).toHaveLength(2);
      expect(grouped.get(ReviewSeverity.WARNING)).toHaveLength(2);
      expect(grouped.get(ReviewSeverity.INFO)).toHaveLength(1);
    });
  });

  describe('getSummary', () => {
    test('generates correct summary', () => {
      const startedAt = new Date('2024-01-01T00:00:00Z');

      aggregator.addResults([
        createMockResult('step1', ReviewStatus.PASS),
        createMockResult('step2', ReviewStatus.FAIL),
        createMockResult('step3', ReviewStatus.ERROR),
        createMockResult('step4', ReviewStatus.SKIPPED),
        createMockResult('step5', ReviewStatus.PASS),
      ]);

      const summary = aggregator.getSummary(startedAt);

      expect(summary.status).toBe(ReviewStatus.ERROR);
      expect(summary.stepResults).toHaveLength(5);
      expect(summary.summary.totalSteps).toBe(5);
      expect(summary.summary.passedSteps).toBe(2);
      expect(summary.summary.failedSteps).toBe(1);
      expect(summary.summary.errorSteps).toBe(1);
      expect(summary.summary.skippedSteps).toBe(1);
      expect(summary.startedAt).toEqual(startedAt);
      expect(summary.totalDurationMs).toBeGreaterThan(0);
    });
  });

  describe('getAllMessages', () => {
    test('returns all messages from all steps', () => {
      aggregator.addResults([
        createMockResult('step1', ReviewStatus.FAIL, [
          { severity: ReviewSeverity.ERROR, message: 'Error 1' },
          { severity: ReviewSeverity.WARNING, message: 'Warning 1' },
        ]),
        createMockResult('step2', ReviewStatus.PASS, [
          { severity: ReviewSeverity.INFO, message: 'Info 1' },
        ]),
      ]);

      const messages = aggregator.getAllMessages();

      expect(messages).toHaveLength(3);
      expect(messages[0].message).toBe('Error 1');
      expect(messages[1].message).toBe('Warning 1');
      expect(messages[2].message).toBe('Info 1');
    });
  });

  describe('getMessagesBySeverity', () => {
    test('filters messages by severity', () => {
      aggregator.addResults([
        createMockResult('step1', ReviewStatus.FAIL, [
          { severity: ReviewSeverity.ERROR, message: 'Error 1' },
          { severity: ReviewSeverity.WARNING, message: 'Warning 1' },
        ]),
        createMockResult('step2', ReviewStatus.FAIL, [
          { severity: ReviewSeverity.ERROR, message: 'Error 2' },
        ]),
      ]);

      const errors = aggregator.getMessagesBySeverity(ReviewSeverity.ERROR);
      const warnings = aggregator.getMessagesBySeverity(ReviewSeverity.WARNING);

      expect(errors).toHaveLength(2);
      expect(warnings).toHaveLength(1);
    });
  });

  describe('getMessageCounts', () => {
    test('counts messages by severity', () => {
      aggregator.addResults([
        createMockResult('step1', ReviewStatus.FAIL, [
          { severity: ReviewSeverity.ERROR, message: 'Error 1' },
          { severity: ReviewSeverity.ERROR, message: 'Error 2' },
          { severity: ReviewSeverity.WARNING, message: 'Warning 1' },
          { severity: ReviewSeverity.INFO, message: 'Info 1' },
        ]),
      ]);

      const counts = aggregator.getMessageCounts();

      expect(counts.errors).toBe(2);
      expect(counts.warnings).toBe(1);
      expect(counts.info).toBe(1);
    });
  });

  describe('getFailedResults', () => {
    test('returns only failed and errored results', () => {
      aggregator.addResults([
        createMockResult('step1', ReviewStatus.PASS),
        createMockResult('step2', ReviewStatus.FAIL),
        createMockResult('step3', ReviewStatus.ERROR),
        createMockResult('step4', ReviewStatus.SKIPPED),
      ]);

      const failed = aggregator.getFailedResults();

      expect(failed).toHaveLength(2);
      expect(failed[0].stepName).toBe('step2');
      expect(failed[1].stepName).toBe('step3');
    });
  });

  describe('clear', () => {
    test('clears all stored results', () => {
      aggregator.addResults([
        createMockResult('step1', ReviewStatus.PASS),
        createMockResult('step2', ReviewStatus.FAIL),
      ]);

      aggregator.clear();

      const summary = aggregator.getSummary(new Date());
      expect(summary.stepResults).toHaveLength(0);
      expect(summary.summary.totalSteps).toBe(0);
    });
  });
});
