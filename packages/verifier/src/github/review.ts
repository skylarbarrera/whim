/**
 * GitHub PR Review Integration
 *
 * Posts verification reports to GitHub PRs.
 */

import { Octokit } from '@octokit/rest';
import type { VerificationReport, CodeIssue, Verdict } from '../report/schema.js';

/**
 * Options for posting a PR review.
 */
export interface PostReviewOptions {
  githubToken: string;
  owner: string;
  repo: string;
  prNumber: number;
  report: VerificationReport;
}

/**
 * Get verdict emoji.
 */
function getVerdictEmoji(verdict: Verdict): string {
  switch (verdict) {
    case 'pass':
      return '✅';
    case 'needs_work':
      return '⚠️';
    case 'fail':
      return '❌';
  }
}

/**
 * Get status emoji.
 */
function getStatusEmoji(status: string): string {
  switch (status) {
    case 'pass':
      return '✅';
    case 'partial':
      return '⚠️';
    case 'fail':
      return '❌';
    case 'skipped':
      return '⏭️';
    case 'needs_work':
      return '⚠️';
    case 'warnings':
      return '⚠️';
    default:
      return '❓';
  }
}

/**
 * Get severity emoji.
 */
function getSeverityEmoji(severity: string): string {
  switch (severity) {
    case 'error':
      return '🔴';
    case 'warning':
      return '🟡';
    case 'info':
      return 'ℹ️';
    default:
      return '•';
  }
}

/**
 * Format duration as human-readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Format code issues as markdown.
 */
function formatIssues(issues: CodeIssue[]): string {
  if (issues.length === 0) {
    return 'No issues found.';
  }

  return issues
    .map((issue) => {
      const location = issue.line ? `${issue.file}:${issue.line}` : issue.file;
      const suggestion = issue.suggestion ? ` (${issue.suggestion})` : '';
      return `- ${getSeverityEmoji(issue.severity)} \`${location}\` - ${issue.message}${suggestion}`;
    })
    .join('\n');
}

/**
 * Build the PR review body.
 */
function buildReviewBody(report: VerificationReport): string {
  const lines: string[] = [];

  // Header
  lines.push(`## 🔍 Whim Verification Report`);
  lines.push('');
  lines.push(
    `**Verdict: ${getVerdictEmoji(report.verdict)} ${report.verdict.toUpperCase()}** | Verified in ${formatDuration(report.durationMs)} using ${report.harness}`
  );
  lines.push('');

  // Summary
  lines.push(`> ${report.summary}`);
  lines.push('');

  // Spec Compliance
  lines.push(
    `### Spec Compliance: ${getStatusEmoji(report.specCompliance.status)} ${report.specCompliance.status}`
  );
  if (report.specCompliance.status === 'skipped') {
    lines.push('No SPEC.md found - spec compliance check skipped.');
  } else {
    lines.push(
      `${report.specCompliance.requirementsMet}/${report.specCompliance.requirementsChecked} requirements implemented.`
    );
    if (report.specCompliance.missingRequirements.length > 0) {
      lines.push('');
      lines.push('**Missing requirements:**');
      for (const req of report.specCompliance.missingRequirements) {
        lines.push(`- [ ] ${req}`);
      }
    }
    if (report.specCompliance.scopeCreep.length > 0) {
      lines.push('');
      lines.push('**Scope creep detected:**');
      for (const item of report.specCompliance.scopeCreep) {
        lines.push(`- ${item}`);
      }
    }
  }
  lines.push('');

  // Code Review
  lines.push(
    `### Code Review: ${getStatusEmoji(report.codeReview.status)} ${report.codeReview.status}`
  );
  const totalIssues =
    report.codeReview.counts.errors +
    report.codeReview.counts.warnings +
    report.codeReview.counts.info;
  if (totalIssues === 0) {
    lines.push('No critical issues found.');
  } else {
    lines.push(
      `Found ${report.codeReview.counts.errors} errors, ${report.codeReview.counts.warnings} warnings, ${report.codeReview.counts.info} info.`
    );
    lines.push('');

    // Group by category for display
    const categories: Array<[string, CodeIssue[]]> = [
      ['Security', report.codeReview.issuesByCategory.security],
      ['Bugs', report.codeReview.issuesByCategory.bugs],
      ['Performance', report.codeReview.issuesByCategory.performance],
      ['Quality', report.codeReview.issuesByCategory.quality],
      ['API Contract', report.codeReview.issuesByCategory.api_contract],
    ];

    for (const [name, issues] of categories) {
      if (issues.length > 0) {
        lines.push(`**${name}:**`);
        lines.push(formatIssues(issues));
        lines.push('');
      }
    }
  }

  if (report.codeReview.suggestions.length > 0) {
    lines.push('**Suggestions:**');
    for (const suggestion of report.codeReview.suggestions) {
      lines.push(`- ${suggestion}`);
    }
    lines.push('');
  }

  // Test Results
  lines.push(
    `### Tests: ${getStatusEmoji(report.testResults.status)} ${report.testResults.status}`
  );
  if (report.testResults.status === 'skipped') {
    lines.push('Test run skipped.');
  } else {
    lines.push(
      `${report.testResults.testsRun} tests run, ${report.testResults.testsPassed} passed, ${report.testResults.testsFailed} failed`
    );
    if (report.testResults.failingTests.length > 0) {
      lines.push('');
      lines.push('**Failing tests:**');
      for (const test of report.testResults.failingTests.slice(0, 10)) {
        lines.push(`- ${test}`);
      }
      if (report.testResults.failingTests.length > 10) {
        lines.push(`- ... and ${report.testResults.failingTests.length - 10} more`);
      }
    }
    if (report.testResults.coverage !== undefined) {
      lines.push(`Coverage: ${report.testResults.coverage}%`);
    }
  }
  lines.push('');

  // Type Check
  lines.push(
    `### Type Check: ${getStatusEmoji(report.typeCheck.status)} ${report.typeCheck.status}`
  );
  if (report.typeCheck.errors.length === 0) {
    lines.push('No type errors');
  } else {
    lines.push(`${report.typeCheck.errors.length} type errors:`);
    for (const error of report.typeCheck.errors.slice(0, 10)) {
      lines.push(`- \`${error.file}:${error.line}\` - ${error.message}`);
    }
    if (report.typeCheck.errors.length > 10) {
      lines.push(`- ... and ${report.typeCheck.errors.length - 10} more`);
    }
  }
  lines.push('');

  // Integration Check (optional)
  if (report.integrationCheck) {
    lines.push(
      `### Integration: ${getStatusEmoji(report.integrationCheck.status)} ${report.integrationCheck.status}`
    );
    lines.push(`Tested ${report.integrationCheck.endpointsTested.length} endpoints.`);
    if (report.integrationCheck.issues.length > 0) {
      lines.push('');
      lines.push('**Issues:**');
      for (const issue of report.integrationCheck.issues) {
        lines.push(`- ${issue}`);
      }
    }
    lines.push('');
  }

  // Browser Check (optional)
  if (report.browserCheck) {
    lines.push(
      `### Browser Check: ${getStatusEmoji(report.browserCheck.status)} ${report.browserCheck.status}`
    );
    lines.push(`Checked ${report.browserCheck.pagesChecked.length} pages.`);
    if (report.browserCheck.issues.length > 0) {
      lines.push('');
      for (const issue of report.browserCheck.issues) {
        lines.push(
          `- ${getSeverityEmoji(issue.type === 'console_error' ? 'error' : 'warning')} \`${issue.page}\` - ${issue.message}`
        );
      }
    }
    lines.push('');
  }

  // Footer
  lines.push('---');
  lines.push('*🏭 Verified by Whim*');
  if (report.costUsd !== undefined) {
    lines.push(` | Cost: $${report.costUsd.toFixed(4)}`);
  }

  return lines.join('\n');
}

/**
 * Map verdict to GitHub review event.
 */
function getReviewEvent(verdict: Verdict): 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' {
  switch (verdict) {
    case 'pass':
      return 'APPROVE';
    case 'fail':
      return 'REQUEST_CHANGES';
    case 'needs_work':
      return 'REQUEST_CHANGES';
  }
}

/**
 * Post a verification report as a PR review.
 *
 * @param options - Review options
 */
export async function postPRReview(options: PostReviewOptions): Promise<void> {
  const { githubToken, owner, repo, prNumber, report } = options;

  const octokit = new Octokit({ auth: githubToken });

  const body = buildReviewBody(report);
  const event = getReviewEvent(report.verdict);

  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    body,
    event,
  });
}

/**
 * Post inline comments on specific lines.
 *
 * @param options - Review options including inline comments
 */
export async function postInlineComments(
  options: PostReviewOptions & { sha: string }
): Promise<void> {
  const { githubToken, owner, repo, prNumber, report, sha } = options;

  const octokit = new Octokit({ auth: githubToken });

  // Only post inline comments for errors and warnings
  const issues = report.codeReview.issues.filter(
    (issue) => issue.line !== undefined && (issue.severity === 'error' || issue.severity === 'warning')
  );

  // GitHub API limits to 10 comments per request
  const comments = issues.slice(0, 10).map((issue) => ({
    path: issue.file,
    line: issue.line!,
    body: `${getSeverityEmoji(issue.severity)} **${issue.category}**: ${issue.message}${issue.suggestion ? `\n\n💡 Suggestion: ${issue.suggestion}` : ''}`,
  }));

  if (comments.length > 0) {
    await octokit.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: sha,
      event: 'COMMENT',
      comments,
    });
  }
}

/**
 * Post a simple comment (not a review).
 *
 * Useful for partial results or errors.
 */
export async function postComment(options: {
  githubToken: string;
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
}): Promise<void> {
  const { githubToken, owner, repo, prNumber, body } = options;

  const octokit = new Octokit({ auth: githubToken });

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
}
