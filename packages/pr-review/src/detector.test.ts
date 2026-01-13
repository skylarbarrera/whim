import { describe, it, expect } from 'bun:test';
import { PRDetector } from './detector';
import type { PRContext } from '@factory/shared';

describe('PRDetector', () => {
  const detector = new PRDetector();

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

  describe('detect', () => {
    it('should detect AI PR with Claude co-author', () => {
      const context = createContext({
        commits: [
          {
            sha: 'abc123',
            message: 'feat: add feature\n\nCo-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>',
            author: 'test-user',
          },
        ],
      });

      const result = detector.detect(context);

      expect(result.isAI).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      expect(result.reasons).toContain('Commit contains "Co-Authored-By: Claude Sonnet 4.5"');
    });

    it('should detect AI PR with ai/issue- branch pattern', () => {
      const context = createContext({
        branch: 'ai/issue-42',
      });

      const result = detector.detect(context);

      expect(result.isAI).toBe(false); // Only 0.2 confidence, needs 0.5
      expect(result.confidence).toBe(0.2);
      expect(result.reasons).toContain('Branch matches AI pattern: ai/issue-42');
    });

    it('should detect AI PR with ai-generated label', () => {
      const context = createContext({
        labels: ['ai-generated', 'enhancement'],
      });

      const result = detector.detect(context);

      expect(result.isAI).toBe(false); // Only 0.1 confidence
      expect(result.confidence).toBe(0.1);
      expect(result.reasons).toContain('PR has "ai-generated" label');
    });

    it('should detect AI PR with multiple signals', () => {
      const context = createContext({
        commits: [
          {
            sha: 'abc123',
            message: 'feat: add feature\n\nCo-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>',
            author: 'test-user',
          },
        ],
        branch: 'ai/issue-42',
        labels: ['ai-generated'],
      });

      const result = detector.detect(context);

      expect(result.isAI).toBe(true);
      expect(result.confidence).toBe(1.0); // 0.7 + 0.2 + 0.1 = 1.0 (capped)
      expect(result.reasons).toHaveLength(3);
    });

    it('should not detect non-AI PR', () => {
      const context = createContext({
        commits: [
          {
            sha: 'abc123',
            message: 'feat: add feature',
            author: 'test-user',
          },
        ],
        branch: 'feature/new-feature',
        labels: ['enhancement'],
      });

      const result = detector.detect(context);

      expect(result.isAI).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.reasons).toHaveLength(0);
    });

    it('should handle empty commits', () => {
      const context = createContext({
        commits: [],
      });

      const result = detector.detect(context);

      expect(result.isAI).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('should be case insensitive for co-author check', () => {
      const context = createContext({
        commits: [
          {
            sha: 'abc123',
            message: 'feat: add feature\n\nco-authored-by: claude sonnet 4.5 <noreply@anthropic.com>',
            author: 'test-user',
          },
        ],
      });

      const result = detector.detect(context);

      expect(result.isAI).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('should detect ai/ branch pattern variants', () => {
      const patterns = [
        'ai/issue-123',
        'ai/task-456',
        'ai/feature-abc',
      ];

      patterns.forEach(branch => {
        const context = createContext({ branch });
        const result = detector.detect(context);
        expect(result.reasons.some(r => r.includes('Branch matches AI pattern'))).toBe(true);
      });
    });

    it('should detect various AI-related labels', () => {
      const labels = [
        ['ai-generated'],
        ['ai'],
        ['automated'],
        ['bot'],
      ];

      labels.forEach(labelSet => {
        const context = createContext({ labels: labelSet });
        const result = detector.detect(context);
        expect(result.reasons.some(r => r.includes('ai-generated'))).toBe(true);
      });
    });

    it('should include metadata in result', () => {
      const context = createContext();
      const result = detector.detect(context);

      expect(result.metadata).toBeDefined();
      expect(typeof result.metadata).toBe('object');
    });
  });
});
