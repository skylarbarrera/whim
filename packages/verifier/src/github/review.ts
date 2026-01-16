/**
 * GitHub PR Review Integration
 *
 * Posts verification reports to GitHub PRs with:
 * - PR review API with inline comments
 * - GitHub Checks API for status checks
 * - Collapsible sections for detailed output
 */

import { Octokit } from '@octokit/rest';
import type { VerificationReport, CodeIssue, Verdict, TestResults, TypeCheck } from '../report/schema.js';

/**
 * Options for posting a PR review.
 */
export interface PostReviewOptions {
  githubToken: string;
  owner: string;
  repo: string;
  prNumber: number;
  sha: string;
  report: VerificationReport;
}

/**
 * Options for creating a status check.
 */
export interface CreateCheckOptions {
  githubToken: string;
  owner: string;
  repo: string;
  sha: string;
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
 * Get category emoji.
 */
function getCategoryEmoji(category: string): string {
  switch (category) {
    case 'security':
      return '🔒';
    case 'bugs':
      return '🐛';
    case 'performance':
      return '⚡';
    case 'quality':
      return '✨';
    case 'api_contract':
      return '📋';
    default:
      return '📝';
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
 * Create a collapsible details section.
 */
function collapsible(summary: string, content: string, open = false): string {
  return `<details${open ? ' open' : ''}>
<summary>${summary}</summary>

${content}

</details>`;
}

/**
 * Format code issues as markdown table.
 */
function formatIssuesTable(issues: CodeIssue[]): string {
  if (issues.length === 0) {
    return '_No issues found._';
  }

  const lines = [
    '| Severity | File | Line | Message |',
    '|----------|------|------|---------|',
  ];

  for (const issue of issues.slice(0, 20)) {
    const severity = `${getSeverityEmoji(issue.severity)} ${issue.severity}`;
    const file = `\`${issue.file}\``;
    const line = issue.line ? `${issue.line}` : '-';
    const message = issue.suggestion
      ? `${issue.message}<br/>💡 _${issue.suggestion}_`
      : issue.message;
    lines.push(`| ${severity} | ${file} | ${line} | ${message} |`);
  }

  if (issues.length > 20) {
    lines.push(`| | | | _...and ${issues.length - 20} more issues_ |`);
  }

  return lines.join('\n');
}

/**
 * Format failing tests.
 */
function formatFailingTests(tests: string[]): string {
  if (tests.length === 0) return '';

  const items = tests.slice(0, 15).map((t) => `- \`${t}\``);
  if (tests.length > 15) {
    items.push(`- _...and ${tests.length - 15} more_`);
  }

  return items.join('\n');
}

/**
 * Format type errors.
 */
function formatTypeErrors(errors: TypeCheck['errors']): string {
  if (errors.length === 0) return '';

  const items = errors.slice(0, 10).map(
    (e) => `- \`${e.file}:${e.line}\` - ${e.message}`
  );
  if (errors.length > 10) {
    items.push(`- _...and ${errors.length - 10} more_`);
  }

  return items.join('\n');
}

/**
 * Build the quick summary line.
 */
function buildQuickSummary(report: VerificationReport): string {
  const parts: string[] = [];

  // Tests
  if (report.testResults.status !== 'skipped') {
    const testIcon = report.testResults.testsFailed === 0 ? '✅' : '❌';
    parts.push(`${testIcon} Tests: ${report.testResults.testsPassed}/${report.testResults.testsRun}`);
  }

  // Types
  const typeIcon = report.typeCheck.status === 'pass' ? '✅' : '❌';
  parts.push(`${typeIcon} Types: ${report.typeCheck.errors.length} errors`);

  // Issues
  const issueCount = report.codeReview.counts.errors + report.codeReview.counts.warnings;
  const issueIcon = report.codeReview.counts.errors === 0 ? '✅' : '⚠️';
  parts.push(`${issueIcon} Issues: ${issueCount}`);

  return parts.join(' | ');
}

/**
 * Build the PR review body with collapsible sections.
 */
function buildReviewBody(report: VerificationReport): string {
  const lines: string[] = [];

  // Header
  lines.push(`## 🔍 Whim Verification Report`);
  lines.push('');
  lines.push(
    `**Verdict: ${getVerdictEmoji(report.verdict)} ${report.verdict.toUpperCase()}** | ⏱️ ${formatDuration(report.durationMs)} | 🤖 ${report.harness}`
  );
  lines.push('');
  lines.push(`> ${report.summary}`);
  lines.push('');

  // Quick summary bar
  lines.push(`### 📊 Quick Summary`);
  lines.push(buildQuickSummary(report));
  lines.push('');

  // Required Checks Section
  lines.push('---');
  lines.push('### Required Checks');
  lines.push('');

  // Spec Compliance
  const specTitle = `${getStatusEmoji(report.specCompliance.status)} **Spec Compliance**: ${report.specCompliance.status}`;
  if (report.specCompliance.status === 'skipped') {
    lines.push(`${specTitle} - _No SPEC.md found_`);
  } else {
    let specContent = `**${report.specCompliance.requirementsMet}/${report.specCompliance.requirementsChecked}** requirements implemented.\n`;

    if (report.specCompliance.missingRequirements.length > 0) {
      specContent += '\n**Missing requirements:**\n';
      for (const req of report.specCompliance.missingRequirements) {
        specContent += `- [ ] ${req}\n`;
      }
    }

    if (report.specCompliance.scopeCreep.length > 0) {
      specContent += '\n**⚠️ Scope creep detected:**\n';
      for (const item of report.specCompliance.scopeCreep) {
        specContent += `- ${item}\n`;
      }
    }

    if (report.specCompliance.notes.length > 0) {
      specContent += '\n**Notes:**\n';
      for (const note of report.specCompliance.notes) {
        specContent += `- ${note}\n`;
      }
    }

    lines.push(collapsible(specTitle, specContent));
  }
  lines.push('');

  // Test Results
  const testTitle = `${getStatusEmoji(report.testResults.status)} **Tests**: ${report.testResults.status}`;
  if (report.testResults.status === 'skipped') {
    lines.push(`${testTitle} - _Test run skipped_`);
  } else {
    let testContent = `**${report.testResults.testsPassed}/${report.testResults.testsRun}** tests passed`;
    if (report.testResults.testsFailed > 0) {
      testContent += ` (${report.testResults.testsFailed} failed)`;
    }
    testContent += '\n';

    if (report.testResults.coverage !== undefined) {
      testContent += `\n📈 Coverage: **${report.testResults.coverage}%**\n`;
    }

    if (report.testResults.failingTests.length > 0) {
      testContent += '\n**Failing tests:**\n';
      testContent += formatFailingTests(report.testResults.failingTests);
    }

    const shouldOpen = report.testResults.testsFailed > 0;
    lines.push(collapsible(testTitle, testContent, shouldOpen));
  }
  lines.push('');

  // Type Check
  const typeTitle = `${getStatusEmoji(report.typeCheck.status)} **Type Check**: ${report.typeCheck.status}`;
  if (report.typeCheck.errors.length === 0) {
    lines.push(`${typeTitle} - _No type errors_`);
  } else {
    let typeContent = `**${report.typeCheck.errors.length}** type errors found:\n\n`;
    typeContent += formatTypeErrors(report.typeCheck.errors);
    lines.push(collapsible(typeTitle, typeContent, true));
  }
  lines.push('');

  // Code Review
  const reviewTitle = `${getStatusEmoji(report.codeReview.status)} **Code Review**: ${report.codeReview.status}`;
  const totalIssues =
    report.codeReview.counts.errors +
    report.codeReview.counts.warnings +
    report.codeReview.counts.info;

  if (totalIssues === 0) {
    lines.push(`${reviewTitle} - _No issues found_`);
  } else {
    let reviewContent = `Found **${report.codeReview.counts.errors}** errors, **${report.codeReview.counts.warnings}** warnings, **${report.codeReview.counts.info}** info.\n\n`;

    // Group by category
    const categories: Array<[string, string, CodeIssue[]]> = [
      ['security', 'Security', report.codeReview.issuesByCategory.security],
      ['bugs', 'Bugs', report.codeReview.issuesByCategory.bugs],
      ['performance', 'Performance', report.codeReview.issuesByCategory.performance],
      ['quality', 'Quality', report.codeReview.issuesByCategory.quality],
      ['api_contract', 'API Contract', report.codeReview.issuesByCategory.api_contract],
    ];

    for (const [key, name, issues] of categories) {
      if (issues.length > 0) {
        reviewContent += `#### ${getCategoryEmoji(key)} ${name} (${issues.length})\n\n`;
        reviewContent += formatIssuesTable(issues);
        reviewContent += '\n\n';
      }
    }

    if (report.codeReview.suggestions.length > 0) {
      reviewContent += '#### 💡 Suggestions\n\n';
      for (const suggestion of report.codeReview.suggestions) {
        reviewContent += `- ${suggestion}\n`;
      }
    }

    const shouldOpen = report.codeReview.counts.errors > 0;
    lines.push(collapsible(reviewTitle, reviewContent, shouldOpen));
  }
  lines.push('');

  // Optional Checks Section
  const hasOptional =
    report.integrationCheck ||
    report.browserCheck ||
    report.performanceCheck ||
    report.temporaryTests;

  if (hasOptional) {
    lines.push('---');
    lines.push('### Optional Checks');
    lines.push('');

    // Integration Check
    if (report.integrationCheck) {
      const intTitle = `${getStatusEmoji(report.integrationCheck.status)} **Integration**: ${report.integrationCheck.status}`;
      let intContent = `Tested **${report.integrationCheck.endpointsTested.length}** endpoints:\n\n`;

      for (const endpoint of report.integrationCheck.endpointsTested) {
        intContent += `- \`${endpoint}\`\n`;
      }

      if (report.integrationCheck.issues.length > 0) {
        intContent += '\n**Issues:**\n';
        for (const issue of report.integrationCheck.issues) {
          intContent += `- ❌ ${issue}\n`;
        }
      }

      lines.push(collapsible(intTitle, intContent, report.integrationCheck.status === 'fail'));
      lines.push('');
    }

    // Browser Check
    if (report.browserCheck) {
      const browserTitle = `${getStatusEmoji(report.browserCheck.status)} **Browser Check**: ${report.browserCheck.status}`;
      let browserContent = `Checked **${report.browserCheck.pagesChecked.length}** pages:\n\n`;

      for (const page of report.browserCheck.pagesChecked) {
        browserContent += `- \`${page}\`\n`;
      }

      if (report.browserCheck.issues.length > 0) {
        browserContent += '\n**Issues:**\n';
        for (const issue of report.browserCheck.issues) {
          const icon = issue.type === 'console_error' ? '🔴' : '🟡';
          browserContent += `- ${icon} \`${issue.page}\` - ${issue.message}\n`;
        }
      }

      lines.push(collapsible(browserTitle, browserContent, report.browserCheck.status === 'fail'));
      lines.push('');
    }

    // Performance Check
    if (report.performanceCheck) {
      const perfTitle = `${getStatusEmoji(report.performanceCheck.status)} **Performance**: ${report.performanceCheck.status}`;
      let perfContent = '';

      if (report.performanceCheck.buildSizeKb) {
        perfContent += `Build size: **${report.performanceCheck.buildSizeKb}KB**\n\n`;
      }

      if (report.performanceCheck.bundleAnalysis) {
        perfContent += `Total bundle: **${report.performanceCheck.bundleAnalysis.totalSizeKb}KB**\n\n`;
        perfContent += 'Largest chunks:\n';
        for (const chunk of report.performanceCheck.bundleAnalysis.largestChunks) {
          perfContent += `- \`${chunk.name}\`: ${chunk.sizeKb}KB\n`;
        }
      }

      if (report.performanceCheck.issues.length > 0) {
        perfContent += '\n**Issues:**\n';
        for (const issue of report.performanceCheck.issues) {
          perfContent += `- ⚠️ ${issue}\n`;
        }
      }

      lines.push(collapsible(perfTitle, perfContent));
      lines.push('');
    }
  }

  // Footer
  lines.push('---');
  const footerParts = ['🏭 _Verified by [Whim](https://github.com/whim-ai/whim)_'];
  if (report.costUsd !== undefined) {
    footerParts.push(`💰 $${report.costUsd.toFixed(4)}`);
  }
  lines.push(footerParts.join(' | '));

  return lines.join('\n');
}

/**
 * Build inline comment for an issue.
 */
function buildInlineComment(issue: CodeIssue): string {
  const lines = [
    `${getSeverityEmoji(issue.severity)} **${getCategoryEmoji(issue.category)} ${issue.category.replace('_', ' ')}**`,
    '',
    issue.message,
  ];

  if (issue.suggestion) {
    lines.push('');
    lines.push(`💡 **Suggestion:** ${issue.suggestion}`);
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
 * Map verdict to check conclusion.
 */
function getCheckConclusion(
  verdict: Verdict
): 'success' | 'failure' | 'neutral' | 'action_required' {
  switch (verdict) {
    case 'pass':
      return 'success';
    case 'fail':
      return 'failure';
    case 'needs_work':
      return 'action_required';
  }
}

/**
 * Build check run annotations from code issues.
 */
function buildAnnotations(
  report: VerificationReport
): Array<{
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'notice' | 'warning' | 'failure';
  message: string;
  title: string;
}> {
  const annotations: Array<{
    path: string;
    start_line: number;
    end_line: number;
    annotation_level: 'notice' | 'warning' | 'failure';
    message: string;
    title: string;
  }> = [];

  // Add code review issues
  for (const issue of report.codeReview.issues) {
    if (issue.line) {
      annotations.push({
        path: issue.file,
        start_line: issue.line,
        end_line: issue.line,
        annotation_level:
          issue.severity === 'error' ? 'failure' : issue.severity === 'warning' ? 'warning' : 'notice',
        message: issue.suggestion ? `${issue.message}\n\nSuggestion: ${issue.suggestion}` : issue.message,
        title: `${issue.category}: ${issue.severity}`,
      });
    }
  }

  // Add type errors
  for (const error of report.typeCheck.errors) {
    annotations.push({
      path: error.file,
      start_line: error.line,
      end_line: error.line,
      annotation_level: 'failure',
      message: error.message,
      title: 'Type Error',
    });
  }

  // GitHub limits to 50 annotations per request
  return annotations.slice(0, 50);
}

/**
 * Post a verification report as a PR review with inline comments.
 *
 * @param options - Review options
 */
export async function postPRReview(options: PostReviewOptions): Promise<void> {
  const { githubToken, owner, repo, prNumber, sha, report } = options;

  const octokit = new Octokit({ auth: githubToken });

  const body = buildReviewBody(report);
  const event = getReviewEvent(report.verdict);

  // Collect inline comments for errors and warnings with line numbers
  const inlineIssues = report.codeReview.issues.filter(
    (issue) =>
      issue.line !== undefined &&
      (issue.severity === 'error' || issue.severity === 'warning')
  );

  // GitHub API allows up to 50 comments per review
  const comments = inlineIssues.slice(0, 50).map((issue) => ({
    path: issue.file,
    line: issue.line!,
    body: buildInlineComment(issue),
  }));

  // Post review with inline comments in a single API call
  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    commit_id: sha,
    body,
    event,
    comments: comments.length > 0 ? comments : undefined,
  });
}

/**
 * Create a GitHub Check Run for the verification.
 *
 * This integrates with GitHub's Checks API to show verification
 * status directly in the PR checks section.
 *
 * @param options - Check options
 */
export async function createCheckRun(options: CreateCheckOptions): Promise<void> {
  const { githubToken, owner, repo, sha, report } = options;

  const octokit = new Octokit({ auth: githubToken });

  const conclusion = getCheckConclusion(report.verdict);
  const annotations = buildAnnotations(report);

  // Build summary text
  const summaryLines = [
    `## Verdict: ${getVerdictEmoji(report.verdict)} ${report.verdict.toUpperCase()}`,
    '',
    report.summary,
    '',
    '### Results',
    '',
    `| Check | Status |`,
    `|-------|--------|`,
    `| Spec Compliance | ${getStatusEmoji(report.specCompliance.status)} ${report.specCompliance.status} |`,
    `| Tests | ${getStatusEmoji(report.testResults.status)} ${report.testResults.testsPassed}/${report.testResults.testsRun} |`,
    `| Type Check | ${getStatusEmoji(report.typeCheck.status)} ${report.typeCheck.errors.length} errors |`,
    `| Code Review | ${getStatusEmoji(report.codeReview.status)} ${report.codeReview.counts.errors} errors, ${report.codeReview.counts.warnings} warnings |`,
  ];

  if (report.integrationCheck) {
    summaryLines.push(
      `| Integration | ${getStatusEmoji(report.integrationCheck.status)} ${report.integrationCheck.endpointsTested.length} endpoints |`
    );
  }

  await octokit.checks.create({
    owner,
    repo,
    name: 'Whim Verifier',
    head_sha: sha,
    status: 'completed',
    conclusion,
    started_at: new Date(Date.now() - report.durationMs).toISOString(),
    completed_at: new Date().toISOString(),
    output: {
      title: `Verification ${report.verdict}`,
      summary: summaryLines.join('\n'),
      text: buildReviewBody(report),
      annotations: annotations.length > 0 ? annotations : undefined,
    },
  });
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

/**
 * Update PR labels based on verification result.
 *
 * @param options - Label options
 */
export async function updatePRLabels(options: {
  githubToken: string;
  owner: string;
  repo: string;
  prNumber: number;
  verdict: Verdict;
}): Promise<void> {
  const { githubToken, owner, repo, prNumber, verdict } = options;

  const octokit = new Octokit({ auth: githubToken });

  // Remove any existing verification labels
  const labelsToRemove = ['verified', 'verification-failed', 'needs-work'];
  for (const label of labelsToRemove) {
    try {
      await octokit.issues.removeLabel({
        owner,
        repo,
        issue_number: prNumber,
        name: label,
      });
    } catch {
      // Label might not exist, ignore
    }
  }

  // Add new label based on verdict
  const labelToAdd = verdict === 'pass' ? 'verified' : verdict === 'fail' ? 'verification-failed' : 'needs-work';

  try {
    await octokit.issues.addLabels({
      owner,
      repo,
      issue_number: prNumber,
      labels: [labelToAdd],
    });
  } catch {
    // Label might not exist in repo, ignore
  }
}
