import { describe, it, expect, beforeEach } from 'bun:test';
import { PRTagger, DEFAULT_TAGGING_CONFIG } from '../detection/pr-tagger.js';
import type { GitHubClient, TaggingConfig, AIGenerationContext } from '../detection/pr-tagger.js';
import type { AIDetectionResult } from '../detection/ai-detector.js';

// Mock GitHub client
class MockGitHubClient implements GitHubClient {
  private labels = new Map<string, string[]>();
  private comments = new Map<string, Array<{ id: number; body: string; user: { login: string } }>>();
  private nextCommentId = 1;

  async addLabels(owner: string, repo: string, prNumber: number, labels: string[]): Promise<void> {
    const key = `${owner}/${repo}/${prNumber}`;
    const current = this.labels.get(key) || [];
    this.labels.set(key, [...new Set([...current, ...labels])]);
  }

  async removeLabels(owner: string, repo: string, prNumber: number, labels: string[]): Promise<void> {
    const key = `${owner}/${repo}/${prNumber}`;
    const current = this.labels.get(key) || [];
    this.labels.set(
      key,
      current.filter(l => !labels.includes(l))
    );
  }

  async getLabels(owner: string, repo: string, prNumber: number): Promise<string[]> {
    const key = `${owner}/${repo}/${prNumber}`;
    return this.labels.get(key) || [];
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
    // Find and update comment
    for (const [key, comments] of this.comments.entries()) {
      const comment = comments.find(c => c.id === commentId);
      if (comment) {
        comment.body = body;
        return;
      }
    }
  }

  // Test helpers
  reset() {
    this.labels.clear();
    this.comments.clear();
    this.nextCommentId = 1;
  }
}

describe('PRTagger', () => {
  const mockClient = new MockGitHubClient();

  beforeEach(() => {
    mockClient.reset();
  });

  describe('tagAIGeneratedPR', () => {
    it('should add AI labels to PR', async () => {
      const tagger = new PRTagger(mockClient);
      const detection: AIDetectionResult = {
        isAIGenerated: true,
        confidence: 90,
        indicators: [],
        metadata: { aiSystem: 'claude' },
      };

      const result = await tagger.tagAIGeneratedPR('owner', 'repo', 1, detection);

      expect(result.success).toBe(true);
      expect(result.labelsAdded).toEqual(['ai-generated']);
      const labels = await mockClient.getLabels('owner', 'repo', 1);
      expect(labels).toContain('ai-generated');
    });

    it('should add custom labels from config', async () => {
      const config: TaggingConfig = {
        ...DEFAULT_TAGGING_CONFIG,
        aiLabels: ['ai', 'automated', 'claude'],
      };
      const tagger = new PRTagger(mockClient, config);
      const detection: AIDetectionResult = {
        isAIGenerated: true,
        confidence: 85,
        indicators: [],
        metadata: {},
      };

      const result = await tagger.tagAIGeneratedPR('owner', 'repo', 1, detection);

      expect(result.success).toBe(true);
      expect(result.labelsAdded).toEqual(['ai', 'automated', 'claude']);
      const labels = await mockClient.getLabels('owner', 'repo', 1);
      expect(labels).toContain('ai');
      expect(labels).toContain('automated');
      expect(labels).toContain('claude');
    });

    it('should remove specified labels', async () => {
      // Pre-add labels
      await mockClient.addLabels('owner', 'repo', 1, ['needs-human-review', 'pending']);

      const config: TaggingConfig = {
        ...DEFAULT_TAGGING_CONFIG,
        removeLabels: ['needs-human-review'],
      };
      const tagger = new PRTagger(mockClient, config);
      const detection: AIDetectionResult = {
        isAIGenerated: true,
        confidence: 80,
        indicators: [],
        metadata: {},
      };

      const result = await tagger.tagAIGeneratedPR('owner', 'repo', 1, detection);

      expect(result.success).toBe(true);
      expect(result.labelsRemoved).toEqual(['needs-human-review']);
      const labels = await mockClient.getLabels('owner', 'repo', 1);
      expect(labels).not.toContain('needs-human-review');
      expect(labels).toContain('pending'); // Not removed
    });

    it('should add metadata comment with detection info', async () => {
      const tagger = new PRTagger(mockClient);
      const detection: AIDetectionResult = {
        isAIGenerated: true,
        confidence: 95,
        indicators: [],
        metadata: {
          aiSystem: 'factory',
          modelVersion: 'claude-sonnet-4',
          workerId: 'worker-123',
        },
      };

      await tagger.tagAIGeneratedPR('owner', 'repo', 1, detection);

      const comments = await mockClient.getComments('owner', 'repo', 1);
      expect(comments.length).toBe(1);
      expect(comments[0]!.body).toContain('<!-- ai-metadata -->');
      expect(comments[0]!.body).toContain('🤖 AI-Generated PR');
      expect(comments[0]!.body).toContain('95% confidence');
      expect(comments[0]!.body).toContain('factory');
      expect(comments[0]!.body).toContain('claude-sonnet-4');
      expect(comments[0]!.body).toContain('worker-123');
    });

    it('should add generation context to comment', async () => {
      const tagger = new PRTagger(mockClient);
      const detection: AIDetectionResult = {
        isAIGenerated: true,
        confidence: 90,
        indicators: [],
        metadata: {},
      };
      const context: AIGenerationContext = {
        prompt: 'Build feature X',
        spec: '# Feature X\n\nBuild it.',
        iterations: 5,
        tokenUsage: { input: 1000, output: 500 },
      };

      await tagger.tagAIGeneratedPR('owner', 'repo', 1, detection, context);

      const comments = await mockClient.getComments('owner', 'repo', 1);
      expect(comments[0]!.body).toContain('Generation Context');
      expect(comments[0]!.body).toContain('Build feature X');
      expect(comments[0]!.body).toContain('# Feature X');
      expect(comments[0]!.body).toContain('Iterations:** 5');
      expect(comments[0]!.body).toContain('Token Usage:** 1000 in / 500 out');
    });

    it('should update existing comment instead of creating new one', async () => {
      const tagger = new PRTagger(mockClient);
      const detection1: AIDetectionResult = {
        isAIGenerated: true,
        confidence: 80,
        indicators: [],
        metadata: {},
      };
      const detection2: AIDetectionResult = {
        isAIGenerated: true,
        confidence: 95,
        indicators: [],
        metadata: { aiSystem: 'claude' },
      };

      // First tagging
      await tagger.tagAIGeneratedPR('owner', 'repo', 1, detection1);
      const comments1 = await mockClient.getComments('owner', 'repo', 1);
      expect(comments1.length).toBe(1);

      // Second tagging (should update, not create new)
      await tagger.tagAIGeneratedPR('owner', 'repo', 1, detection2);
      const comments2 = await mockClient.getComments('owner', 'repo', 1);
      expect(comments2.length).toBe(1);
      expect(comments2[0]!.body).toContain('95% confidence');
    });

    it('should skip visible comment if configured', async () => {
      const config: TaggingConfig = {
        ...DEFAULT_TAGGING_CONFIG,
        addVisibleComment: false,
        addHiddenComment: true,
      };
      const tagger = new PRTagger(mockClient, config);
      const detection: AIDetectionResult = {
        isAIGenerated: true,
        confidence: 90,
        indicators: [],
        metadata: {},
      };

      await tagger.tagAIGeneratedPR('owner', 'repo', 1, detection);

      const comments = await mockClient.getComments('owner', 'repo', 1);
      expect(comments[0]!.body).toContain('<!-- ai-metadata -->');
      expect(comments[0]!.body).not.toContain('🤖 AI-Generated PR');
    });

    it('should handle errors gracefully', async () => {
      // Create a client that throws errors
      const errorClient: GitHubClient = {
        addLabels: async () => {
          throw new Error('API error');
        },
        removeLabels: async () => {},
        getLabels: async () => [],
        addComment: async () => {},
        getComments: async () => [],
        updateComment: async () => {},
      };

      const tagger = new PRTagger(errorClient);
      const detection: AIDetectionResult = {
        isAIGenerated: true,
        confidence: 90,
        indicators: [],
        metadata: {},
      };

      const result = await tagger.tagAIGeneratedPR('owner', 'repo', 1, detection);

      expect(result.success).toBe(false);
      expect(result.error).toBe('API error');
    });
  });

  describe('untagAIGeneratedPR', () => {
    it('should remove AI labels from PR', async () => {
      // Pre-add labels
      await mockClient.addLabels('owner', 'repo', 1, ['ai-generated', 'bug']);

      const tagger = new PRTagger(mockClient);
      const result = await tagger.untagAIGeneratedPR('owner', 'repo', 1);

      expect(result.success).toBe(true);
      expect(result.labelsRemoved).toEqual(['ai-generated']);
      const labels = await mockClient.getLabels('owner', 'repo', 1);
      expect(labels).not.toContain('ai-generated');
      expect(labels).toContain('bug'); // Not removed
    });

    it('should handle PR with no AI labels', async () => {
      await mockClient.addLabels('owner', 'repo', 1, ['bug', 'feature']);

      const tagger = new PRTagger(mockClient);
      const result = await tagger.untagAIGeneratedPR('owner', 'repo', 1);

      expect(result.success).toBe(true);
      expect(result.labelsRemoved).toEqual([]);
    });

    it('should handle errors gracefully', async () => {
      const errorClient: GitHubClient = {
        addLabels: async () => {},
        removeLabels: async () => {
          throw new Error('Remove failed');
        },
        getLabels: async () => ['ai-generated'],
        addComment: async () => {},
        getComments: async () => [],
        updateComment: async () => {},
      };

      const tagger = new PRTagger(errorClient);
      const result = await tagger.untagAIGeneratedPR('owner', 'repo', 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Remove failed');
    });
  });
});
