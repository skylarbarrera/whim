import { ReviewWorkflowResult, ReviewStatus } from '../types/review-result';

/**
 * Configuration for mapping review results to GitHub status checks
 */
export interface StatusCheckMapping {
  /** The GitHub status context name (e.g., "review/lint", "review/test") */
  context: string;
  /** Human-readable description */
  description: string;
  /** Whether this check is required for merge */
  required: boolean;
  /** Review step name to map from */
  stepName?: string;
}

/**
 * Configuration for status check requirements
 */
export interface StatusCheckRequirements {
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** Target branch (e.g., "main", "master") */
  branch: string;
  /** Require branches to be up to date before merging */
  strict: boolean;
  /** List of status check mappings */
  checks: StatusCheckMapping[];
}

/**
 * GitHub status check state
 */
export type GitHubCheckState = 'error' | 'failure' | 'pending' | 'success';

/**
 * Result of mapping review results to GitHub status checks
 */
export interface MappedStatusCheck {
  /** Status context name */
  context: string;
  /** Status description */
  description: string;
  /** GitHub check state */
  state: GitHubCheckState;
  /** Target URL for details (optional) */
  targetUrl?: string;
}

/**
 * Manages status check requirements and mappings
 */
export class StatusCheckConfig {
  private requirements: Map<string, StatusCheckRequirements> = new Map();

  /**
   * Add or update status check requirements for a repository
   */
  setRequirements(repoKey: string, requirements: StatusCheckRequirements): void {
    this.requirements.set(repoKey, requirements);
  }

  /**
   * Get status check requirements for a repository
   */
  getRequirements(owner: string, repo: string, branch: string): StatusCheckRequirements | undefined {
    const key = `${owner}/${repo}/${branch}`;
    return this.requirements.get(key);
  }

  /**
   * Get all required status check contexts for a repository
   */
  getRequiredContexts(owner: string, repo: string, branch: string): string[] {
    const requirements = this.getRequirements(owner, repo, branch);
    if (!requirements) {
      return [];
    }
    return requirements.checks.filter((check) => check.required).map((check) => check.context);
  }

  /**
   * Map review workflow results to GitHub status checks
   */
  mapReviewResultsToStatusChecks(
    workflowResult: ReviewWorkflowResult,
    requirements: StatusCheckRequirements
  ): MappedStatusCheck[] {
    const mappedChecks: MappedStatusCheck[] = [];

    for (const check of requirements.checks) {
      // Find matching step result
      const stepResult = check.stepName
        ? workflowResult.stepResults.find((result) => result.stepName === check.stepName)
        : undefined;

      if (!stepResult) {
        // If no step found, mark as pending
        mappedChecks.push({
          context: check.context,
          description: check.description,
          state: 'pending',
        });
        continue;
      }

      // Map review status to GitHub check state
      const state = this.mapReviewStatusToCheckState(stepResult.status);

      mappedChecks.push({
        context: check.context,
        description: `${check.description}: ${this.getStatusDescription(stepResult)}`,
        state,
      });
    }

    return mappedChecks;
  }

  /**
   * Map ReviewStatus to GitHub check state
   */
  private mapReviewStatusToCheckState(status: ReviewStatus): GitHubCheckState {
    switch (status) {
      case ReviewStatus.PASS:
        return 'success';
      case ReviewStatus.FAIL:
        return 'failure';
      case ReviewStatus.ERROR:
        return 'error';
      case ReviewStatus.PENDING:
        return 'pending';
      case ReviewStatus.SKIPPED:
        return 'success'; // Skipped is considered successful
      default:
        return 'error';
    }
  }

  /**
   * Get human-readable status description
   */
  private getStatusDescription(stepResult: any): string {
    const { status, messages } = stepResult;

    switch (status) {
      case ReviewStatus.PASS:
        return 'All checks passed';
      case ReviewStatus.FAIL: {
        const errorCount = messages.filter((m: any) => m.severity === 'error').length;
        const warningCount = messages.filter((m: any) => m.severity === 'warning').length;
        return `${errorCount} error(s), ${warningCount} warning(s)`;
      }
      case ReviewStatus.ERROR:
        return stepResult.error?.message || 'Execution error';
      case ReviewStatus.PENDING:
        return 'In progress';
      case ReviewStatus.SKIPPED:
        return 'Skipped';
      default:
        return 'Unknown status';
    }
  }

  /**
   * Check if all required status checks passed
   */
  areRequiredChecksPassing(mappedChecks: MappedStatusCheck[], requirements: StatusCheckRequirements): boolean {
    const requiredContexts = requirements.checks.filter((check) => check.required).map((check) => check.context);

    for (const context of requiredContexts) {
      const check = mappedChecks.find((c) => c.context === context);
      if (!check || check.state !== 'success') {
        return false;
      }
    }

    return true;
  }

  /**
   * Get failing required checks
   */
  getFailingRequiredChecks(mappedChecks: MappedStatusCheck[], requirements: StatusCheckRequirements): string[] {
    const requiredContexts = requirements.checks.filter((check) => check.required).map((check) => check.context);

    const failing: string[] = [];
    for (const context of requiredContexts) {
      const check = mappedChecks.find((c) => c.context === context);
      if (!check || (check.state !== 'success' && check.state !== 'pending')) {
        failing.push(context);
      }
    }

    return failing;
  }

  /**
   * Create default status check requirements for AI-generated PRs
   */
  static createDefaultRequirements(owner: string, repo: string, branch: string): StatusCheckRequirements {
    return {
      owner,
      repo,
      branch,
      strict: true, // Require branches to be up to date
      checks: [
        {
          context: 'review/lint',
          description: 'Code linting and formatting',
          required: true,
          stepName: 'lint',
        },
        {
          context: 'review/test',
          description: 'Automated tests',
          required: true,
          stepName: 'test',
        },
        {
          context: 'review/security',
          description: 'Security scan',
          required: false,
          stepName: 'security',
        },
      ],
    };
  }

  /**
   * Remove all requirements
   */
  clear(): void {
    this.requirements.clear();
  }
}
