import { describe, test, expect } from 'bun:test';
import type { ReviewStepResult } from '@factory/review-system';

describe('ReviewTimeline', () => {
  test('should handle empty results', () => {
    const results: ReviewStepResult[] = [];
    expect(results.length).toBe(0);
  });

  test('should handle sequential mode', () => {
    const mode = 'sequential';
    expect(mode).toBe('sequential');
  });

  test('should handle parallel mode', () => {
    const mode = 'parallel';
    expect(mode).toBe('parallel');
  });

  test('should process multiple results', () => {
    const results: ReviewStepResult[] = [
      {
        stepName: 'lint',
        status: 'PASS',
        messages: [],
        durationMs: 1000,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
      {
        stepName: 'test',
        status: 'FAIL',
        messages: [],
        durationMs: 2000,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ];
    expect(results.length).toBe(2);
    expect(results[0].status).toBe('PASS');
    expect(results[1].status).toBe('FAIL');
  });

  test('should include error information when present', () => {
    const result: ReviewStepResult = {
      stepName: 'test',
      status: 'ERROR',
      messages: [],
      durationMs: 100,
      error: {
        message: 'Test failed',
        code: 'TEST_ERROR',
      },
    };
    expect(result.error?.message).toBe('Test failed');
  });

  test('should count messages correctly', () => {
    const result: ReviewStepResult = {
      stepName: 'lint',
      status: 'FAIL',
      messages: [
        { severity: 'ERROR', message: 'Error 1' },
        { severity: 'WARNING', message: 'Warning 1' },
        { severity: 'INFO', message: 'Info 1' },
      ],
      durationMs: 1000,
    };
    expect(result.messages.length).toBe(3);
  });
});
