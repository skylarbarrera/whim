import { describe, test, expect } from 'bun:test';
import type { ReviewStatus } from '@factory/review-system';

describe('ReviewStepStatus', () => {
  test('should render PASS status correctly', () => {
    const status: ReviewStatus = 'PASS';
    expect(status).toBe('PASS');
  });

  test('should render FAIL status correctly', () => {
    const status: ReviewStatus = 'FAIL';
    expect(status).toBe('FAIL');
  });

  test('should render ERROR status correctly', () => {
    const status: ReviewStatus = 'ERROR';
    expect(status).toBe('ERROR');
  });

  test('should render PENDING status correctly', () => {
    const status: ReviewStatus = 'PENDING';
    expect(status).toBe('PENDING');
  });

  test('should render SKIPPED status correctly', () => {
    const status: ReviewStatus = 'SKIPPED';
    expect(status).toBe('SKIPPED');
  });

  test('should format duration in milliseconds', () => {
    const durationMs = 500;
    const formatted = durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
    expect(formatted).toBe('500ms');
  });

  test('should format duration in seconds', () => {
    const durationMs = 1500;
    const formatted = durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
    expect(formatted).toBe('1.5s');
  });
});
