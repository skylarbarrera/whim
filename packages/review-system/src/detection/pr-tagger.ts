/**
 * PR tagging system for managing labels and metadata on GitHub PRs
 *
 * Handles:
 * - Adding/removing labels for AI-generated PRs
 * - Storing metadata as PR comments
 * - Managing PR state through labels
 */

import type { AIDetectionResult } from './ai-detector.js';

export interface GitHubClient {
  /** Add labels to a PR */
  addLabels(owner: string, repo: string, prNumber: number, labels: string[]): Promise<void>;
  /** Remove labels from a PR */
  removeLabels(owner: string, repo: string, prNumber: number, labels: string[]): Promise<void>;
  /** Get current labels on a PR */
  getLabels(owner: string, repo: string, prNumber: number): Promise<string[]>;
  /** Add a comment to a PR */
  addComment(owner: string, repo: string, prNumber: number, body: string): Promise<void>;
  /** Get comments on a PR */
  getComments(owner: string, repo: string, prNumber: number): Promise<GitHubComment[]>;
  /** Update a comment */
  updateComment(owner: string, repo: string, commentId: number, body: string): Promise<void>;
}

export interface GitHubComment {
  id: number;
  body: string;
  user: {
    login: string;
  };
}

export interface TaggingConfig {
  /** Labels to add to AI-generated PRs */
  aiLabels: string[];
  /** Labels to remove when tagging as AI-generated */
  removeLabels: string[];
  /** Whether to add a visible comment with AI context */
  addVisibleComment: boolean;
  /** Whether to add a hidden comment with metadata (for machine reading) */
  addHiddenComment: boolean;
  /** Bot username for comments */
  botUsername: string;
}

export interface PRTaggingResult {
  /** Whether tagging was successful */
  success: boolean;
  /** Labels that were added */
  labelsAdded: string[];
  /** Labels that were removed */
  labelsRemoved: string[];
  /** Comment ID if a comment was added/updated */
  commentId?: number;
  /** Error message if tagging failed */
  error?: string;
}

/**
 * Default tagging configuration
 */
export const DEFAULT_TAGGING_CONFIG: TaggingConfig = {
  aiLabels: ['ai-generated'],
  removeLabels: [],
  addVisibleComment: true,
  addHiddenComment: true,
  botUsername: 'ai-factory-bot',
};

/**
 * PRTagger manages labels and metadata for AI-generated PRs
 */
export class PRTagger {
  constructor(
    private github: GitHubClient,
    private config: TaggingConfig = DEFAULT_TAGGING_CONFIG
  ) {}

  /**
   * Tag a PR as AI-generated
   * @param owner Repository owner
   * @param repo Repository name
   * @param prNumber PR number
   * @param detection Detection result from AIDetector
   * @param context Optional generation context to include
   * @returns Tagging result
   */
  async tagAIGeneratedPR(
    owner: string,
    repo: string,
    prNumber: number,
    detection: AIDetectionResult,
    context?: AIGenerationContext
  ): Promise<PRTaggingResult> {
    const result: PRTaggingResult = {
      success: true,
      labelsAdded: [],
      labelsRemoved: [],
    };

    try {
      // Add AI labels
      if (this.config.aiLabels.length > 0) {
        await this.github.addLabels(owner, repo, prNumber, this.config.aiLabels);
        result.labelsAdded = this.config.aiLabels;
      }

      // Remove specified labels
      if (this.config.removeLabels.length > 0) {
        const currentLabels = await this.github.getLabels(owner, repo, prNumber);
        const labelsToRemove = this.config.removeLabels.filter(label =>
          currentLabels.includes(label)
        );
        if (labelsToRemove.length > 0) {
          await this.github.removeLabels(owner, repo, prNumber, labelsToRemove);
          result.labelsRemoved = labelsToRemove;
        }
      }

      // Add comments with context
      if (this.config.addVisibleComment || this.config.addHiddenComment) {
        const commentId = await this.addOrUpdateMetadataComment(
          owner,
          repo,
          prNumber,
          detection,
          context
        );
        result.commentId = commentId;
      }
    } catch (error) {
      result.success = false;
      result.error = error instanceof Error ? error.message : String(error);
    }

    return result;
  }

  /**
   * Remove AI tagging from a PR
   * @param owner Repository owner
   * @param repo Repository name
   * @param prNumber PR number
   * @returns Tagging result
   */
  async untagAIGeneratedPR(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<PRTaggingResult> {
    const result: PRTaggingResult = {
      success: true,
      labelsAdded: [],
      labelsRemoved: [],
    };

    try {
      // Remove AI labels
      if (this.config.aiLabels.length > 0) {
        const currentLabels = await this.github.getLabels(owner, repo, prNumber);
        const labelsToRemove = this.config.aiLabels.filter(label =>
          currentLabels.includes(label)
        );
        if (labelsToRemove.length > 0) {
          await this.github.removeLabels(owner, repo, prNumber, labelsToRemove);
          result.labelsRemoved = labelsToRemove;
        }
      }
    } catch (error) {
      result.success = false;
      result.error = error instanceof Error ? error.message : String(error);
    }

    return result;
  }

  /**
   * Add or update metadata comment on PR
   */
  private async addOrUpdateMetadataComment(
    owner: string,
    repo: string,
    prNumber: number,
    detection: AIDetectionResult,
    context?: AIGenerationContext
  ): Promise<number | undefined> {
    // Check for existing comment
    const comments = await this.github.getComments(owner, repo, prNumber);
    const existingComment = comments.find(
      c => c.user.login === this.config.botUsername && c.body.includes('<!-- ai-metadata -->')
    );

    const commentBody = this.formatMetadataComment(detection, context);

    if (existingComment) {
      // Update existing comment
      await this.github.updateComment(owner, repo, existingComment.id, commentBody);
      return existingComment.id;
    } else {
      // Add new comment
      await this.github.addComment(owner, repo, prNumber, commentBody);
      // Note: We don't have the comment ID from addComment, would need to fetch again
      return undefined;
    }
  }

  /**
   * Format metadata comment for PR
   */
  private formatMetadataComment(
    detection: AIDetectionResult,
    context?: AIGenerationContext
  ): string {
    const parts: string[] = [];

    // Hidden marker for machine reading
    parts.push('<!-- ai-metadata -->');

    // Visible header
    if (this.config.addVisibleComment) {
      parts.push('## 🤖 AI-Generated PR\n');
      parts.push(
        `This PR appears to be AI-generated with ${detection.confidence}% confidence.\n`
      );

      // Add AI system info
      if (detection.metadata.aiSystem) {
        parts.push(`**AI System:** ${detection.metadata.aiSystem}`);
      }
      if (detection.metadata.modelVersion) {
        parts.push(`**Model:** ${detection.metadata.modelVersion}`);
      }
      if (detection.metadata.workerId) {
        parts.push(`**Worker:** ${detection.metadata.workerId}`);
      }
      parts.push('');

      // Add generation context if provided
      if (context) {
        parts.push('### Generation Context\n');
        if (context.prompt) {
          parts.push('**Original Prompt:**');
          parts.push('```');
          parts.push(context.prompt);
          parts.push('```\n');
        }
        if (context.spec) {
          parts.push('**Spec:**');
          parts.push('```markdown');
          parts.push(context.spec);
          parts.push('```\n');
        }
        if (context.iterations) {
          parts.push(`**Iterations:** ${context.iterations}`);
        }
        if (context.tokenUsage) {
          parts.push(
            `**Token Usage:** ${context.tokenUsage.input} in / ${context.tokenUsage.output} out`
          );
        }
      }

      parts.push('\n---');
      parts.push('_This comment was automatically generated by the AI Factory review system._');
    }

    // Hidden metadata for machine reading
    if (this.config.addHiddenComment) {
      parts.push('<!--');
      parts.push(JSON.stringify({ detection, context }, null, 2));
      parts.push('-->');
    }

    return parts.join('\n');
  }
}

/**
 * AI generation context stored with PR
 */
export interface AIGenerationContext {
  /** Original prompt/issue that generated this PR */
  prompt?: string;
  /** Spec file content */
  spec?: string;
  /** Number of iterations */
  iterations?: number;
  /** Token usage */
  tokenUsage?: {
    input: number;
    output: number;
  };
  /** Work item ID from factory */
  workItemId?: string;
  /** Timestamp when generation started */
  startedAt?: string;
  /** Timestamp when generation completed */
  completedAt?: string;
}
