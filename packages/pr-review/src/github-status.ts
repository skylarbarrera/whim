// @ts-ignore - Node.js imports
import { Octokit } from '@octokit/rest';
import type { PRReview } from '@factory/shared';

/**
 * GitHub commit status state
 */
export type StatusState = 'pending' | 'success' | 'failure' | 'error';

/**
 * GitHub status context for AI factory reviews
 */
export const REVIEW_STATUS_CONTEXT = 'ai-factory/pr-review';

/**
 * Parameters for creating a commit status
 */
export interface CreateStatusParams {
  owner: string;
  repo: string;
  sha: string;
  state: StatusState;
  description: string;
  targetUrl?: string;
}

/**
 * GitHub commit status response
 */
export interface CommitStatus {
  id: number;
  state: StatusState;
  context: string;
  description: string;
  targetUrl?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Client for interacting with GitHub Commit Status API
 *
 * This client manages commit statuses that are used by GitHub's
 * branch protection to enforce merge requirements.
 */
export class GitHubStatusClient {
  private octokit: Octokit;
  private dashboardUrl: string;

  constructor(token: string, dashboardUrl?: string) {
    this.octokit = new Octokit({ auth: token });
    this.dashboardUrl = dashboardUrl || 'http://localhost:3002';
  }

  /**
   * Create or update a commit status for a PR review
   */
  async createStatus(params: CreateStatusParams): Promise<CommitStatus> {
    const { owner, repo, sha, state, description, targetUrl } = params;

    const response = await this.octokit.repos.createCommitStatus({
      owner,
      repo,
      sha,
      state,
      context: REVIEW_STATUS_CONTEXT,
      description: this.truncateDescription(description),
      target_url: targetUrl,
    });

    return {
      id: response.data.id,
      state: response.data.state as StatusState,
      context: response.data.context,
      description: response.data.description || '',
      targetUrl: response.data.target_url || undefined,
      createdAt: response.data.created_at,
      updatedAt: response.data.updated_at,
    };
  }

  /**
   * Create status from PR review result
   */
  async createStatusFromReview(
    review: PRReview,
    mergeBlocked: boolean
  ): Promise<CommitStatus> {
    const state = this.determineState(review, mergeBlocked);
    const description = this.generateDescription(review, mergeBlocked);
    const targetUrl = `${this.dashboardUrl}/reviews/${review.id}`;

    return this.createStatus({
      owner: review.repoOwner,
      repo: review.repoName,
      sha: review.headSha,
      state,
      description,
      targetUrl,
    });
  }

  /**
   * Get all statuses for a commit
   */
  async getStatuses(
    owner: string,
    repo: string,
    ref: string
  ): Promise<CommitStatus[]> {
    const response = await this.octokit.repos.listCommitStatusesForRef({
      owner,
      repo,
      ref,
    });

    return response.data.map((status: any) => ({
      id: status.id,
      state: status.state as StatusState,
      context: status.context,
      description: status.description || '',
      targetUrl: status.target_url || undefined,
      createdAt: status.created_at,
      updatedAt: status.updated_at,
    }));
  }

  /**
   * Get the AI factory review status for a commit
   */
  async getReviewStatus(
    owner: string,
    repo: string,
    ref: string
  ): Promise<CommitStatus | null> {
    const statuses = await this.getStatuses(owner, repo, ref);
    const reviewStatus = statuses.find(
      (s) => s.context === REVIEW_STATUS_CONTEXT
    );
    return reviewStatus || null;
  }

  /**
   * Determine status state from review
   */
  private determineState(
    review: PRReview,
    mergeBlocked: boolean
  ): StatusState {
    // Override always allows merge
    if (review.overrideUser) {
      return 'success';
    }

    // Check review status
    switch (review.status) {
      case 'pending':
        return 'pending';
      case 'running':
        return 'pending';
      case 'completed':
        return mergeBlocked ? 'failure' : 'success';
      case 'failed':
        return 'error';
      case 'cancelled':
        return 'error';
      default:
        return 'pending';
    }
  }

  /**
   * Generate human-readable description from review
   */
  private generateDescription(
    review: PRReview,
    mergeBlocked: boolean
  ): string {
    if (review.overrideUser) {
      return `Review overridden by ${review.overrideUser}`;
    }

    switch (review.status) {
      case 'pending':
        return 'Waiting for review checks to start';
      case 'running':
        return 'Running review checks...';
      case 'completed':
        return mergeBlocked
          ? 'Review checks failed - merge blocked'
          : 'All review checks passed';
      case 'failed':
        return 'Review system error';
      case 'cancelled':
        return 'Review cancelled';
      default:
        return 'Review status unknown';
    }
  }

  /**
   * Truncate description to GitHub's 140 character limit
   */
  private truncateDescription(description: string): string {
    const maxLength = 140;
    if (description.length <= maxLength) {
      return description;
    }
    return description.substring(0, maxLength - 3) + '...';
  }
}
