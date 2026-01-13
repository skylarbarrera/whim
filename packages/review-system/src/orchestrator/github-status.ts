import { Octokit } from '@octokit/rest';
import { PullRequestInfo } from '../types/review-context.js';
import {
  ReviewWorkflowResult,
  ReviewStepResult,
  ReviewStatus,
  ReviewMessage,
  ReviewSeverity,
} from '../types/review-result.js';

/**
 * GitHub check run conclusion values
 */
type CheckConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'action_required';

/**
 * GitHub annotation level values
 */
type AnnotationLevel = 'notice' | 'warning' | 'failure';

/**
 * Reports review results to GitHub via status checks and check runs
 */
export class GitHubStatusReporter {
  private octokit: Octokit;

  constructor(githubToken: string) {
    this.octokit = new Octokit({ auth: githubToken });
  }

  /**
   * Create a GitHub check run for a review workflow
   *
   * @param pr Pull request information
   * @param workflowName Name of the review workflow
   * @returns Check run ID
   */
  async createCheckRun(pr: PullRequestInfo, workflowName: string): Promise<number> {
    const response = await this.octokit.checks.create({
      owner: pr.owner,
      repo: pr.repo,
      name: workflowName,
      head_sha: pr.headSha,
      status: 'in_progress',
      started_at: new Date().toISOString(),
    });

    return response.data.id;
  }

  /**
   * Update a GitHub check run with review results
   *
   * @param pr Pull request information
   * @param checkRunId Check run ID to update
   * @param result Review workflow result
   */
  async updateCheckRun(
    pr: PullRequestInfo,
    checkRunId: number,
    result: ReviewWorkflowResult
  ): Promise<void> {
    const conclusion = this.mapStatusToConclusion(result.status);
    const summary = this.generateSummary(result);
    const text = this.generateDetailedText(result);
    const annotations = this.createAnnotations(result);

    // GitHub API limits annotations to 50 per update
    const limitedAnnotations = annotations.slice(0, 50);

    await this.octokit.checks.update({
      owner: pr.owner,
      repo: pr.repo,
      check_run_id: checkRunId,
      status: 'completed',
      conclusion,
      completed_at: result.completedAt.toISOString(),
      output: {
        title: this.generateTitle(result),
        summary,
        text,
        annotations: limitedAnnotations,
      },
    });
  }

  /**
   * Create annotations from review messages
   *
   * @param result Review workflow result
   * @returns Array of GitHub check run annotations
   */
  createAnnotations(result: ReviewWorkflowResult): Array<{
    path: string;
    start_line: number;
    end_line: number;
    annotation_level: AnnotationLevel;
    message: string;
    title?: string;
  }> {
    const annotations: Array<{
      path: string;
      start_line: number;
      end_line: number;
      annotation_level: AnnotationLevel;
      message: string;
      title?: string;
    }> = [];

    for (const stepResult of result.stepResults) {
      for (const message of stepResult.messages) {
        if (message.file && message.line) {
          annotations.push({
            path: message.file,
            start_line: message.line,
            end_line: message.line,
            annotation_level: this.mapSeverityToLevel(message.severity),
            message: message.message,
            title: message.ruleId || stepResult.stepName,
          });
        }
      }
    }

    return annotations;
  }

  /**
   * Post a commit status (legacy API, simpler than check runs)
   *
   * @param pr Pull request information
   * @param status Review workflow result
   * @param context Status check context name
   */
  async postCommitStatus(
    pr: PullRequestInfo,
    status: ReviewWorkflowResult,
    context: string
  ): Promise<void> {
    const state = this.mapStatusToState(status.status);
    const description = this.generateStatusDescription(status);

    await this.octokit.repos.createCommitStatus({
      owner: pr.owner,
      repo: pr.repo,
      sha: pr.headSha,
      state,
      context,
      description,
    });
  }

  /**
   * Map review status to GitHub check run conclusion
   */
  private mapStatusToConclusion(status: ReviewStatus): CheckConclusion {
    switch (status) {
      case ReviewStatus.PASS:
        return 'success';
      case ReviewStatus.FAIL:
        return 'failure';
      case ReviewStatus.ERROR:
        return 'failure';
      case ReviewStatus.SKIPPED:
        return 'skipped';
      case ReviewStatus.PENDING:
        return 'neutral';
      default:
        return 'neutral';
    }
  }

  /**
   * Map review status to GitHub commit status state
   */
  private mapStatusToState(
    status: ReviewStatus
  ): 'error' | 'failure' | 'pending' | 'success' {
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
        return 'success';
      default:
        return 'pending';
    }
  }

  /**
   * Map review message severity to GitHub annotation level
   */
  private mapSeverityToLevel(severity: ReviewSeverity): AnnotationLevel {
    switch (severity) {
      case ReviewSeverity.ERROR:
        return 'failure';
      case ReviewSeverity.WARNING:
        return 'warning';
      case ReviewSeverity.INFO:
        return 'notice';
      default:
        return 'notice';
    }
  }

  /**
   * Generate check run title
   */
  private generateTitle(result: ReviewWorkflowResult): string {
    const { passedSteps, failedSteps, errorSteps } = result.summary;

    if (result.status === ReviewStatus.PASS) {
      return `All checks passed (${passedSteps} steps)`;
    } else if (failedSteps > 0) {
      return `${failedSteps} step${failedSteps > 1 ? 's' : ''} failed`;
    } else if (errorSteps > 0) {
      return `${errorSteps} step${errorSteps > 1 ? 's' : ''} errored`;
    }

    return 'Review completed';
  }

  /**
   * Generate check run summary
   */
  private generateSummary(result: ReviewWorkflowResult): string {
    const { totalSteps, passedSteps, failedSteps, errorSteps, skippedSteps } =
      result.summary;
    const duration = (result.totalDurationMs / 1000).toFixed(2);

    return `
**Review Summary**
- Total steps: ${totalSteps}
- Passed: ${passedSteps}
- Failed: ${failedSteps}
- Errors: ${errorSteps}
- Skipped: ${skippedSteps}
- Duration: ${duration}s
    `.trim();
  }

  /**
   * Generate detailed text output
   */
  private generateDetailedText(result: ReviewWorkflowResult): string {
    const sections: string[] = [];

    // Group results by status
    const failedSteps = result.stepResults.filter(
      r => r.status === ReviewStatus.FAIL
    );
    const errorSteps = result.stepResults.filter(
      r => r.status === ReviewStatus.ERROR
    );
    const passedSteps = result.stepResults.filter(
      r => r.status === ReviewStatus.PASS
    );

    // Failed steps section
    if (failedSteps.length > 0) {
      sections.push('## Failed Steps\n');
      for (const step of failedSteps) {
        sections.push(`### ${step.stepName}`);
        sections.push(this.formatStepMessages(step));
      }
    }

    // Error steps section
    if (errorSteps.length > 0) {
      sections.push('## Error Steps\n');
      for (const step of errorSteps) {
        sections.push(`### ${step.stepName}`);
        if (step.error) {
          sections.push(`**Error:** ${step.error.message}`);
        }
        sections.push(this.formatStepMessages(step));
      }
    }

    // Passed steps section
    if (passedSteps.length > 0) {
      sections.push('## Passed Steps\n');
      for (const step of passedSteps) {
        const duration = (step.durationMs / 1000).toFixed(2);
        sections.push(`- ${step.stepName} (${duration}s)`);
      }
    }

    return sections.join('\n\n');
  }

  /**
   * Format messages for a step result
   */
  private formatStepMessages(step: ReviewStepResult): string {
    if (step.messages.length === 0) {
      return 'No messages';
    }

    const lines: string[] = [];
    for (const message of step.messages) {
      const icon = this.getSeverityIcon(message.severity);
      const location = message.file
        ? `${message.file}${message.line ? `:${message.line}` : ''}`
        : '';
      lines.push(`${icon} ${location ? `**${location}**: ` : ''}${message.message}`);
      if (message.suggestion) {
        lines.push(`  *Suggestion: ${message.suggestion}*`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get emoji icon for severity
   */
  private getSeverityIcon(severity: ReviewSeverity): string {
    switch (severity) {
      case ReviewSeverity.ERROR:
        return '❌';
      case ReviewSeverity.WARNING:
        return '⚠️';
      case ReviewSeverity.INFO:
        return 'ℹ️';
      default:
        return '•';
    }
  }

  /**
   * Generate commit status description (140 char limit)
   */
  private generateStatusDescription(result: ReviewWorkflowResult): string {
    const { passedSteps, failedSteps, errorSteps } = result.summary;

    if (result.status === ReviewStatus.PASS) {
      return `All ${passedSteps} checks passed`;
    } else if (failedSteps > 0) {
      return `${failedSteps} check${failedSteps > 1 ? 's' : ''} failed`;
    } else if (errorSteps > 0) {
      return `${errorSteps} check${errorSteps > 1 ? 's' : ''} errored`;
    }

    return 'Review in progress';
  }
}
