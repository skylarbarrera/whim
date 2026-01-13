import { describe, it, expect } from 'bun:test';
import { AIDetector } from '../detection/ai-detector.js';
import type { PRData } from '../detection/ai-detector.js';

describe('AIDetector', () => {
  const detector = new AIDetector();

  describe('detect', () => {
    it('should detect factory-generated PR with high confidence', async () => {
      const pr: PRData = {
        title: 'feat: add new feature',
        body: 'Generated with AI Factory\n\n## Summary\n- Feature 1\n\n## Test plan\n- Test 1',
        commits: [
          {
            message: 'feat: add new feature\n\nCo-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>',
            author: 'worker-abc123',
            coAuthors: ['Claude Sonnet 4.5 <noreply@anthropic.com>'],
          },
        ],
        labels: ['ai-generated'],
        metadata: {
          workerId: 'worker-abc123',
        },
      };

      const result = await detector.detect(pr);

      expect(result.isAIGenerated).toBe(true);
      expect(result.confidence).toBeGreaterThan(80);
      expect(result.indicators.length).toBeGreaterThan(0);
      expect(result.metadata.aiSystem).toBe('factory');
      expect(result.metadata.workerId).toBe('worker-abc123');
    });

    it('should detect Claude co-authored PR with high confidence', async () => {
      const pr: PRData = {
        title: 'fix: bug fix',
        body: 'Fixed a bug',
        commits: [
          {
            message: 'fix: bug fix\n\nCo-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>',
            author: 'human-dev',
            coAuthors: ['Claude Sonnet 4.5 <noreply@anthropic.com>'],
          },
        ],
        labels: [],
        metadata: {},
      };

      const result = await detector.detect(pr);

      expect(result.isAIGenerated).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(50);
      expect(result.indicators.some(i => i.type === 'commit-coauthor')).toBe(true);
      expect(result.metadata.aiSystem).toBe('claude');
    });

    it('should detect Ralph event markers with high confidence', async () => {
      const pr: PRData = {
        title: 'feat: new feature',
        body: 'Implementation of new feature',
        commits: [
          {
            message: 'feat: new feature\n\n[RALPH:COMPLETE] {"testsRun": 10, "testsPassed": 10}',
            author: 'ralph-worker',
          },
        ],
        labels: [],
        metadata: {},
      };

      const result = await detector.detect(pr);

      expect(result.isAIGenerated).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(50);
      expect(result.indicators.some(i => i.description.includes('Ralph event'))).toBe(true);
      expect(result.metadata.aiSystem).toBe('ralph');
    });

    it('should detect Claude Code reference in PR body', async () => {
      const pr: PRData = {
        title: 'feat: implementation',
        body: '## Summary\n\nImplemented feature.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)',
        commits: [
          {
            message: 'feat: implementation',
            author: 'developer',
          },
        ],
        labels: [],
        metadata: {},
      };

      const result = await detector.detect(pr);

      expect(result.isAIGenerated).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(50);
      expect(result.indicators.some(i => i.type === 'pr-description')).toBe(true);
    });

    it('should not detect manual PR with low confidence', async () => {
      const pr: PRData = {
        title: 'Regular PR',
        body: 'This is a regular pull request made by a human',
        commits: [
          {
            message: 'Regular commit message',
            author: 'human-developer',
          },
        ],
        labels: ['bug', 'enhancement'],
        metadata: {},
      };

      const result = await detector.detect(pr);

      expect(result.isAIGenerated).toBe(false);
      expect(result.confidence).toBeLessThan(50);
      expect(result.indicators.length).toBe(0);
    });

    it('should detect AI labels', async () => {
      const pr: PRData = {
        title: 'PR with AI label',
        body: 'Some changes',
        commits: [
          {
            message: 'Some changes',
            author: 'developer',
          },
        ],
        labels: ['ai-generated', 'bug'],
        metadata: {},
      };

      const result = await detector.detect(pr);

      expect(result.isAIGenerated).toBe(true);
      expect(result.indicators.some(i => i.type === 'pr-label')).toBe(true);
    });

    it('should detect structured PR template', async () => {
      const pr: PRData = {
        title: 'Feature PR',
        body: '## Summary\n\nAdded feature.\n\n## Test plan\n\nRun tests.',
        commits: [
          {
            message: 'Add feature',
            author: 'developer',
          },
        ],
        labels: [],
        metadata: {},
      };

      const result = await detector.detect(pr);

      // Structured template alone has lower weight (40), not enough to trigger detection
      expect(result.indicators.some(i => i.description.includes('Structured PR template'))).toBe(
        true
      );
    });

    it('should extract model version from PR body', async () => {
      const pr: PRData = {
        title: 'AI PR',
        body: 'Generated using claude-sonnet-4-20250514',
        commits: [
          {
            message: 'feat: changes\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
            author: 'dev',
            coAuthors: ['Claude <noreply@anthropic.com>'],
          },
        ],
        labels: [],
        metadata: {},
      };

      const result = await detector.detect(pr);

      expect(result.metadata.modelVersion).toBe('claude-sonnet-4-20250514');
    });

    it('should detect worker ID pattern in commit message', async () => {
      const pr: PRData = {
        title: 'Factory PR',
        body: 'Changes',
        commits: [
          {
            message: 'feat: changes from worker-a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            author: 'factory',
          },
        ],
        labels: [],
        metadata: {},
      };

      const result = await detector.detect(pr);

      expect(result.isAIGenerated).toBe(true);
      expect(result.indicators.some(i => i.description.includes('Factory worker ID'))).toBe(true);
    });

    it('should detect multiple indicators and aggregate confidence', async () => {
      const pr: PRData = {
        title: 'Multi-indicator PR',
        body: 'AI Factory generated\n\n## Summary\n\nChanges.\n\n## Test plan\n\nTests.',
        commits: [
          {
            message: 'feat: changes\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
            author: 'dev',
            coAuthors: ['Claude <noreply@anthropic.com>'],
          },
        ],
        labels: ['ai-generated'],
        metadata: {
          workerId: 'worker-123',
        },
      };

      const result = await detector.detect(pr);

      expect(result.isAIGenerated).toBe(true);
      expect(result.confidence).toBeGreaterThan(90);
      expect(result.indicators.length).toBeGreaterThan(3);
    });

    it('should handle PR with no commits', async () => {
      const pr: PRData = {
        title: 'Empty PR',
        body: 'No commits yet',
        commits: [],
        labels: [],
        metadata: {},
      };

      const result = await detector.detect(pr);

      expect(result.isAIGenerated).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.indicators.length).toBe(0);
    });

    it('should handle PR with undefined metadata', async () => {
      const pr: PRData = {
        title: 'PR without metadata',
        body: 'Some changes',
        commits: [
          {
            message: 'changes',
            author: 'dev',
          },
        ],
        labels: [],
      };

      const result = await detector.detect(pr);

      expect(result.isAIGenerated).toBe(false);
      expect(result.indicators.length).toBe(0);
    });

    it('should detect AI context metadata', async () => {
      const pr: PRData = {
        title: 'Context PR',
        body: 'Changes',
        commits: [
          {
            message: 'changes',
            author: 'dev',
          },
        ],
        labels: [],
        metadata: {
          aiContext: {
            prompt: 'Build feature X',
            model: 'claude-sonnet-4',
          },
        },
      };

      const result = await detector.detect(pr);

      expect(result.isAIGenerated).toBe(true);
      expect(result.indicators.some(i => i.description.includes('AI generation context'))).toBe(
        true
      );
    });
  });
});
