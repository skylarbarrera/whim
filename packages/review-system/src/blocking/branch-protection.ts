import { Octokit } from '@octokit/rest';

/**
 * Configuration for branch protection rules
 */
export interface BranchProtectionConfig {
  /** Owner of the repository */
  owner: string;
  /** Name of the repository */
  repo: string;
  /** Branch name to protect (e.g., "main", "master") */
  branch: string;
  /** Required status checks configuration */
  requiredStatusChecks?: RequiredStatusChecksConfig;
  /** Required pull request reviews configuration */
  requiredPullRequestReviews?: RequiredPullRequestReviewsConfig;
  /** Enforce restrictions for admins */
  enforceAdmins?: boolean;
  /** Restrict who can push to matching branches */
  restrictions?: BranchRestrictionsConfig;
  /** Allow force pushes */
  allowForcePushes?: boolean;
  /** Allow deletions */
  allowDeletions?: boolean;
}

/**
 * Configuration for required status checks
 */
export interface RequiredStatusChecksConfig {
  /** Require branches to be up to date before merging */
  strict: boolean;
  /** List of required status check contexts */
  contexts: string[];
}

/**
 * Configuration for required pull request reviews
 */
export interface RequiredPullRequestReviewsConfig {
  /** Dismiss stale pull request approvals when new commits are pushed */
  dismissStaleReviews?: boolean;
  /** Require code owner reviews */
  requireCodeOwnerReviews?: boolean;
  /** Number of required approving reviews */
  requiredApprovingReviewCount?: number;
  /** Restrict who can dismiss pull request reviews */
  dismissalRestrictions?: {
    users?: string[];
    teams?: string[];
  };
}

/**
 * Configuration for branch restrictions
 */
export interface BranchRestrictionsConfig {
  /** Users who can push to the branch */
  users: string[];
  /** Teams who can push to the branch */
  teams: string[];
  /** Apps who can push to the branch */
  apps?: string[];
}

/**
 * Branch protection rule status
 */
export interface BranchProtectionStatus {
  /** Whether protection is enabled */
  enabled: boolean;
  /** Current protection configuration */
  config?: BranchProtectionConfig;
  /** Error message if protection check failed */
  error?: string;
}

/**
 * Manages GitHub branch protection rules for AI-generated PRs
 */
export class BranchProtectionManager {
  private octokit: Octokit;

  constructor(githubToken: string) {
    this.octokit = new Octokit({ auth: githubToken });
  }

  /**
   * Enable branch protection with the given configuration
   */
  async enableProtection(config: BranchProtectionConfig): Promise<void> {
    const { owner, repo, branch } = config;

    const protectionConfig: any = {
      required_status_checks: config.requiredStatusChecks
        ? {
            strict: config.requiredStatusChecks.strict,
            contexts: config.requiredStatusChecks.contexts,
          }
        : null,
      enforce_admins: config.enforceAdmins ?? true,
      required_pull_request_reviews: config.requiredPullRequestReviews
        ? {
            dismiss_stale_reviews: config.requiredPullRequestReviews.dismissStaleReviews ?? true,
            require_code_owner_reviews: config.requiredPullRequestReviews.requireCodeOwnerReviews ?? false,
            required_approving_review_count: config.requiredPullRequestReviews.requiredApprovingReviewCount ?? 1,
            dismissal_restrictions: config.requiredPullRequestReviews.dismissalRestrictions,
          }
        : null,
      restrictions: config.restrictions
        ? {
            users: config.restrictions.users,
            teams: config.restrictions.teams,
            apps: config.restrictions.apps,
          }
        : null,
      required_linear_history: false,
      allow_force_pushes: config.allowForcePushes ?? false,
      allow_deletions: config.allowDeletions ?? false,
    };

    await this.octokit.repos.updateBranchProtection({
      owner,
      repo,
      branch,
      ...protectionConfig,
    });
  }

  /**
   * Update existing branch protection rules
   */
  async updateProtection(config: BranchProtectionConfig): Promise<void> {
    // GitHub API update is the same as enable
    await this.enableProtection(config);
  }

  /**
   * Disable branch protection for a branch
   */
  async disableProtection(owner: string, repo: string, branch: string): Promise<void> {
    try {
      await this.octokit.repos.deleteBranchProtection({
        owner,
        repo,
        branch,
      });
    } catch (error: any) {
      // 404 means protection doesn't exist, which is fine
      if (error.status !== 404) {
        throw error;
      }
    }
  }

  /**
   * Get current branch protection status
   */
  async getProtectionStatus(owner: string, repo: string, branch: string): Promise<BranchProtectionStatus> {
    try {
      const response = await this.octokit.repos.getBranchProtection({
        owner,
        repo,
        branch,
      });

      const protection = response.data;

      return {
        enabled: true,
        config: {
          owner,
          repo,
          branch,
          requiredStatusChecks: protection.required_status_checks
            ? {
                strict: protection.required_status_checks.strict ?? false,
                contexts: protection.required_status_checks.contexts || [],
              }
            : undefined,
          requiredPullRequestReviews: protection.required_pull_request_reviews
            ? {
                dismissStaleReviews: protection.required_pull_request_reviews.dismiss_stale_reviews,
                requireCodeOwnerReviews: protection.required_pull_request_reviews.require_code_owner_reviews,
                requiredApprovingReviewCount: protection.required_pull_request_reviews.required_approving_review_count,
              }
            : undefined,
          enforceAdmins: protection.enforce_admins?.enabled ?? false,
          allowForcePushes: protection.allow_force_pushes?.enabled ?? false,
          allowDeletions: protection.allow_deletions?.enabled ?? false,
        },
      };
    } catch (error: any) {
      if (error.status === 404) {
        return { enabled: false };
      }
      return {
        enabled: false,
        error: error.message || 'Failed to get branch protection status',
      };
    }
  }

  /**
   * Add required status checks to existing protection
   */
  async addRequiredStatusChecks(
    owner: string,
    repo: string,
    branch: string,
    contexts: string[]
  ): Promise<void> {
    const current = await this.getProtectionStatus(owner, repo, branch);

    if (!current.enabled || !current.config) {
      throw new Error('Branch protection must be enabled before adding status checks');
    }

    const existingContexts = current.config.requiredStatusChecks?.contexts || [];
    const newContexts = [...new Set([...existingContexts, ...contexts])];

    await this.updateProtection({
      ...current.config,
      requiredStatusChecks: {
        strict: current.config.requiredStatusChecks?.strict ?? true,
        contexts: newContexts,
      },
    });
  }

  /**
   * Remove required status checks from existing protection
   */
  async removeRequiredStatusChecks(
    owner: string,
    repo: string,
    branch: string,
    contexts: string[]
  ): Promise<void> {
    const current = await this.getProtectionStatus(owner, repo, branch);

    if (!current.enabled || !current.config) {
      return; // Nothing to remove
    }

    const existingContexts = current.config.requiredStatusChecks?.contexts || [];
    const newContexts = existingContexts.filter((ctx) => !contexts.includes(ctx));

    await this.updateProtection({
      ...current.config,
      requiredStatusChecks: {
        strict: current.config.requiredStatusChecks?.strict ?? true,
        contexts: newContexts,
      },
    });
  }

  /**
   * Set required status checks (replaces all existing contexts)
   */
  async setRequiredStatusChecks(
    owner: string,
    repo: string,
    branch: string,
    config: RequiredStatusChecksConfig
  ): Promise<void> {
    const current = await this.getProtectionStatus(owner, repo, branch);

    if (!current.enabled || !current.config) {
      throw new Error('Branch protection must be enabled before setting status checks');
    }

    await this.updateProtection({
      ...current.config,
      requiredStatusChecks: config,
    });
  }
}
