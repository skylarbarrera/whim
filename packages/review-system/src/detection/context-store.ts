/**
 * Context storage and retrieval for AI-generated PRs
 *
 * Stores and retrieves AI generation context from PR comments
 */

import type { AIDetectionResult } from './ai-detector.js';
import type { AIGenerationContext, GitHubClient } from './pr-tagger.js';

export interface StoredContext {
  /** Detection result */
  detection: AIDetectionResult;
  /** Generation context */
  context?: AIGenerationContext;
  /** When the context was stored */
  storedAt: string;
}

/**
 * ContextStore manages AI generation context storage and retrieval
 */
export class ContextStore {
  constructor(
    private github: GitHubClient,
    private botUsername: string = 'ai-factory-bot'
  ) {}

  /**
   * Retrieve stored context for a PR
   * @param owner Repository owner
   * @param repo Repository name
   * @param prNumber PR number
   * @returns Stored context, or null if not found
   */
  async getContext(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<StoredContext | null> {
    try {
      // Get all comments
      const comments = await this.github.getComments(owner, repo, prNumber);

      // Find metadata comment
      const metadataComment = comments.find(
        c => c.user.login === this.botUsername && c.body.includes('<!-- ai-metadata -->')
      );

      if (!metadataComment) {
        return null;
      }

      // Extract hidden JSON from comment
      const jsonMatch = metadataComment.body.match(/<!--\s*\n([\s\S]*?)\n-->/);
      if (!jsonMatch || !jsonMatch[1]) {
        return null;
      }

      // Parse JSON (skip the first line which is the marker)
      const lines = jsonMatch[1].trim().split('\n');
      const jsonStart = lines.findIndex(line => line.trim().startsWith('{'));
      if (jsonStart === -1) {
        return null;
      }

      const jsonText = lines.slice(jsonStart).join('\n');
      const parsed = JSON.parse(jsonText) as {
        detection: AIDetectionResult;
        context?: AIGenerationContext;
      };

      return {
        detection: parsed.detection,
        context: parsed.context,
        storedAt: new Date().toISOString(), // We don't store this, use current time
      };
    } catch (error) {
      // If we can't parse, return null (no context found)
      return null;
    }
  }

  /**
   * Check if a PR has stored AI context
   * @param owner Repository owner
   * @param repo Repository name
   * @param prNumber PR number
   * @returns True if context exists
   */
  async hasContext(owner: string, repo: string, prNumber: number): Promise<boolean> {
    const context = await this.getContext(owner, repo, prNumber);
    return context !== null;
  }

  /**
   * Get just the generation context (without detection result)
   * @param owner Repository owner
   * @param repo Repository name
   * @param prNumber PR number
   * @returns Generation context, or null if not found
   */
  async getGenerationContext(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<AIGenerationContext | null> {
    const stored = await this.getContext(owner, repo, prNumber);
    return stored?.context || null;
  }

  /**
   * Get just the detection result (without generation context)
   * @param owner Repository owner
   * @param repo Repository name
   * @param prNumber PR number
   * @returns Detection result, or null if not found
   */
  async getDetection(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<AIDetectionResult | null> {
    const stored = await this.getContext(owner, repo, prNumber);
    return stored?.detection || null;
  }

  /**
   * Extract context from multiple PRs
   * @param owner Repository owner
   * @param repo Repository name
   * @param prNumbers PR numbers to check
   * @returns Map of PR number to stored context
   */
  async getContextBatch(
    owner: string,
    repo: string,
    prNumbers: number[]
  ): Promise<Map<number, StoredContext>> {
    const results = new Map<number, StoredContext>();

    // Fetch contexts in parallel
    const promises = prNumbers.map(async prNumber => {
      const context = await this.getContext(owner, repo, prNumber);
      if (context) {
        results.set(prNumber, context);
      }
    });

    await Promise.all(promises);

    return results;
  }
}
