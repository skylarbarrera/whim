import { describe, it, expect, beforeEach } from 'bun:test';
import { ContextStore } from '../detection/context-store.js';
import type { GitHubClient, AIGenerationContext } from '../detection/pr-tagger.js';
import type { AIDetectionResult } from '../detection/ai-detector.js';

// Mock GitHub client
class MockGitHubClient implements GitHubClient {
  private comments = new Map<string, Array<{ id: number; body: string; user: { login: string } }>>();
  private nextCommentId = 1;

  async addLabels(): Promise<void> {}
  async removeLabels(): Promise<void> {}
  async getLabels(): Promise<string[]> {
    return [];
  }

  async addComment(owner: string, repo: string, prNumber: number, body: string): Promise<void> {
    const key = `${owner}/${repo}/${prNumber}`;
    const comments = this.comments.get(key) || [];
    comments.push({
      id: this.nextCommentId++,
      body,
      user: { login: 'ai-factory-bot' },
    });
    this.comments.set(key, comments);
  }

  async getComments(owner: string, repo: string, prNumber: number) {
    const key = `${owner}/${repo}/${prNumber}`;
    return this.comments.get(key) || [];
  }

  async updateComment(owner: string, repo: string, commentId: number, body: string): Promise<void> {
    for (const comments of this.comments.values()) {
      const comment = comments.find(c => c.id === commentId);
      if (comment) {
        comment.body = body;
        return;
      }
    }
  }

  // Test helper
  reset() {
    this.comments.clear();
    this.nextCommentId = 1;
  }
}

describe('ContextStore', () => {
  const mockClient = new MockGitHubClient();
  const store = new ContextStore(mockClient);

  beforeEach(() => {
    mockClient.reset();
  });

  describe('getContext', () => {
    it('should retrieve stored context from PR comment', async () => {
      const detection: AIDetectionResult = {
        isAIGenerated: true,
        confidence: 90,
        indicators: [],
        metadata: { aiSystem: 'claude' },
      };
      const context: AIGenerationContext = {
        prompt: 'Build feature',
        spec: '# Spec\nBuild it.',
        iterations: 3,
      };

      // Add a comment with metadata
      const commentBody = `<!-- ai-metadata -->
## 🤖 AI-Generated PR

This PR appears to be AI-generated with 90% confidence.

<!--
${JSON.stringify({ detection, context }, null, 2)}
-->`;

      await mockClient.addComment('owner', 'repo', 1, commentBody);

      const result = await store.getContext('owner', 'repo', 1);

      expect(result).not.toBeNull();
      expect(result?.detection.confidence).toBe(90);
      expect(result?.context?.prompt).toBe('Build feature');
      expect(result?.context?.iterations).toBe(3);
    });

    it('should return null if no metadata comment exists', async () => {
      const result = await store.getContext('owner', 'repo', 1);
      expect(result).toBeNull();
    });

    it('should return null if comment has no JSON', async () => {
      await mockClient.addComment('owner', 'repo', 1, '<!-- ai-metadata -->\nJust text');

      const result = await store.getContext('owner', 'repo', 1);
      expect(result).toBeNull();
    });

    it('should return null if JSON is invalid', async () => {
      const commentBody = `<!-- ai-metadata -->
<!--
{ invalid json }
-->`;
      await mockClient.addComment('owner', 'repo', 1, commentBody);

      const result = await store.getContext('owner', 'repo', 1);
      expect(result).toBeNull();
    });

    it('should handle comments from different users', async () => {
      const detection: AIDetectionResult = {
        isAIGenerated: true,
        confidence: 85,
        indicators: [],
        metadata: {},
      };

      const commentBody = `<!-- ai-metadata -->
<!--
${JSON.stringify({ detection }, null, 2)}
-->`;

      await mockClient.addComment('owner', 'repo', 1, commentBody);

      // Should find bot comment
      const result = await store.getContext('owner', 'repo', 1);
      expect(result).not.toBeNull();
    });
  });

  describe('hasContext', () => {
    it('should return true if context exists', async () => {
      const detection: AIDetectionResult = {
        isAIGenerated: true,
        confidence: 90,
        indicators: [],
        metadata: {},
      };

      const commentBody = `<!-- ai-metadata -->
<!--
${JSON.stringify({ detection }, null, 2)}
-->`;

      await mockClient.addComment('owner', 'repo', 1, commentBody);

      const result = await store.hasContext('owner', 'repo', 1);
      expect(result).toBe(true);
    });

    it('should return false if context does not exist', async () => {
      const result = await store.hasContext('owner', 'repo', 1);
      expect(result).toBe(false);
    });
  });

  describe('getGenerationContext', () => {
    it('should return just the generation context', async () => {
      const detection: AIDetectionResult = {
        isAIGenerated: true,
        confidence: 90,
        indicators: [],
        metadata: {},
      };
      const context: AIGenerationContext = {
        prompt: 'Test prompt',
        workItemId: 'work-123',
      };

      const commentBody = `<!-- ai-metadata -->
<!--
${JSON.stringify({ detection, context }, null, 2)}
-->`;

      await mockClient.addComment('owner', 'repo', 1, commentBody);

      const result = await store.getGenerationContext('owner', 'repo', 1);

      expect(result).not.toBeNull();
      expect(result?.prompt).toBe('Test prompt');
      expect(result?.workItemId).toBe('work-123');
    });

    it('should return null if no context exists', async () => {
      const result = await store.getGenerationContext('owner', 'repo', 1);
      expect(result).toBeNull();
    });

    it('should return null if stored data has no context field', async () => {
      const detection: AIDetectionResult = {
        isAIGenerated: true,
        confidence: 90,
        indicators: [],
        metadata: {},
      };

      const commentBody = `<!-- ai-metadata -->
<!--
${JSON.stringify({ detection }, null, 2)}
-->`;

      await mockClient.addComment('owner', 'repo', 1, commentBody);

      const result = await store.getGenerationContext('owner', 'repo', 1);
      expect(result).toBeNull();
    });
  });

  describe('getDetection', () => {
    it('should return just the detection result', async () => {
      const detection: AIDetectionResult = {
        isAIGenerated: true,
        confidence: 95,
        indicators: [],
        metadata: { aiSystem: 'ralph' },
      };

      const commentBody = `<!-- ai-metadata -->
<!--
${JSON.stringify({ detection }, null, 2)}
-->`;

      await mockClient.addComment('owner', 'repo', 1, commentBody);

      const result = await store.getDetection('owner', 'repo', 1);

      expect(result).not.toBeNull();
      expect(result?.confidence).toBe(95);
      expect(result?.metadata.aiSystem).toBe('ralph');
    });

    it('should return null if no detection exists', async () => {
      const result = await store.getDetection('owner', 'repo', 1);
      expect(result).toBeNull();
    });
  });

  describe('getContextBatch', () => {
    it('should retrieve contexts for multiple PRs', async () => {
      const detection1: AIDetectionResult = {
        isAIGenerated: true,
        confidence: 90,
        indicators: [],
        metadata: {},
      };
      const detection2: AIDetectionResult = {
        isAIGenerated: true,
        confidence: 85,
        indicators: [],
        metadata: {},
      };

      const comment1 = `<!-- ai-metadata -->
<!--
${JSON.stringify({ detection: detection1 }, null, 2)}
-->`;
      const comment2 = `<!-- ai-metadata -->
<!--
${JSON.stringify({ detection: detection2 }, null, 2)}
-->`;

      await mockClient.addComment('owner', 'repo', 1, comment1);
      await mockClient.addComment('owner', 'repo', 2, comment2);

      const results = await store.getContextBatch('owner', 'repo', [1, 2, 3]);

      expect(results.size).toBe(2);
      expect(results.get(1)?.detection.confidence).toBe(90);
      expect(results.get(2)?.detection.confidence).toBe(85);
      expect(results.get(3)).toBeUndefined();
    });

    it('should return empty map if no PRs have context', async () => {
      const results = await store.getContextBatch('owner', 'repo', [1, 2, 3]);
      expect(results.size).toBe(0);
    });

    it('should handle empty PR list', async () => {
      const results = await store.getContextBatch('owner', 'repo', []);
      expect(results.size).toBe(0);
    });
  });
});
