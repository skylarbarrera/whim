// @ts-ignore - Node.js imports
import { Octokit } from '@octokit/rest';
import { REVIEW_STATUS_CONTEXT } from './github-status.js';

/**
 * Branch protection configuration
 */
export interface BranchProtection {
  enabled: boolean;
  requiredStatusChecks: string[];
  requiresLinearHistory: boolean;
  allowsForcePushes: boolean;
  allowsDeletions: boolean;
}

/**
 * Parameters for updating branch protection
 */
export interface UpdateProtectionParams {
  owner: string;
  repo: string;
  branch: string;
  requireStatusChecks?: boolean;
  requireLinearHistory?: boolean;
  allowForcePushes?: boolean;
  allowDeletions?: boolean;
}

/**
 * Manager for GitHub branch protection rules
 *
 * This class handles configuration of branch protection to enforce
 * review requirements via required status checks.
 */
export class BranchProtectionManager {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  /**
   * Get current branch protection settings
   */
  async getProtection(
    owner: string,
    repo: string,
    branch: string
  ): Promise<BranchProtection | null> {
    try {
      const response = await this.octokit.repos.getBranchProtection({
        owner,
        repo,
        branch,
      });

      const statusChecks =
        response.data.required_status_checks?.contexts || [];

      return {
        enabled: true,
        requiredStatusChecks: statusChecks,
        requiresLinearHistory:
          response.data.required_linear_history?.enabled || false,
        allowsForcePushes: response.data.allow_force_pushes?.enabled || false,
        allowsDeletions: response.data.allow_deletions?.enabled || false,
      };
    } catch (error: any) {
      // 404 means no protection exists
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Add AI factory review as required status check
   */
  async addRequiredStatusCheck(
    owner: string,
    repo: string,
    branch: string
  ): Promise<BranchProtection> {
    // Get existing protection
    const existing = await this.getProtection(owner, repo, branch);

    if (!existing) {
      // No protection exists - create minimal protection with our check
      await this.octokit.repos.updateBranchProtection({
        owner,
        repo,
        branch,
        required_status_checks: {
          strict: false,
          contexts: [REVIEW_STATUS_CONTEXT],
        },
        enforce_admins: null,
        required_pull_request_reviews: null,
        restrictions: null,
      });
    } else {
      // Protection exists - add our check if not present
      const contexts = existing.requiredStatusChecks || [];
      if (!contexts.includes(REVIEW_STATUS_CONTEXT)) {
        contexts.push(REVIEW_STATUS_CONTEXT);

        await this.octokit.repos.updateBranchProtection({
          owner,
          repo,
          branch,
          required_status_checks: {
            strict: false,
            contexts,
          },
          enforce_admins: null,
          required_pull_request_reviews: null,
          restrictions: null,
        });
      }
    }

    // Return updated protection
    return (await this.getProtection(owner, repo, branch))!;
  }

  /**
   * Remove AI factory review from required status checks
   */
  async removeRequiredStatusCheck(
    owner: string,
    repo: string,
    branch: string
  ): Promise<BranchProtection | null> {
    const existing = await this.getProtection(owner, repo, branch);

    if (!existing) {
      return null;
    }

    const contexts = existing.requiredStatusChecks.filter(
      (ctx) => ctx !== REVIEW_STATUS_CONTEXT
    );

    if (contexts.length === 0) {
      // No more required checks - remove status check requirement
      await this.octokit.repos.updateBranchProtection({
        owner,
        repo,
        branch,
        required_status_checks: null,
        enforce_admins: null,
        required_pull_request_reviews: null,
        restrictions: null,
      });
    } else {
      // Update with remaining checks
      await this.octokit.repos.updateBranchProtection({
        owner,
        repo,
        branch,
        required_status_checks: {
          strict: false,
          contexts,
        },
        enforce_admins: null,
        required_pull_request_reviews: null,
        restrictions: null,
      });
    }

    return await this.getProtection(owner, repo, branch);
  }

  /**
   * Check if AI factory review is required on a branch
   */
  async isReviewRequired(
    owner: string,
    repo: string,
    branch: string
  ): Promise<boolean> {
    const protection = await this.getProtection(owner, repo, branch);
    if (!protection) {
      return false;
    }
    return protection.requiredStatusChecks.includes(REVIEW_STATUS_CONTEXT);
  }

  /**
   * Update branch protection with custom settings
   */
  async updateProtection(params: UpdateProtectionParams): Promise<void> {
    const { owner, repo, branch, requireStatusChecks } = params;

    if (requireStatusChecks) {
      await this.addRequiredStatusCheck(owner, repo, branch);
    } else if (requireStatusChecks === false) {
      await this.removeRequiredStatusCheck(owner, repo, branch);
    }
  }

  /**
   * Sync protection across multiple branches
   *
   * Ensures AI factory review is required on all specified branches
   */
  async syncProtectionAcrossBranches(
    owner: string,
    repo: string,
    branches: string[]
  ): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const branch of branches) {
      try {
        await this.addRequiredStatusCheck(owner, repo, branch);
        results.set(branch, true);
      } catch (error) {
        console.error(`Failed to sync protection for ${branch}:`, error);
        results.set(branch, false);
      }
    }

    return results;
  }
}
