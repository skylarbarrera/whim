/**
 * Whim Verifier
 *
 * Autonomous PR verification agent.
 *
 * @example
 * ```typescript
 * import { verify } from '@whim/verifier';
 *
 * const report = await verify({
 *   repoDir: '/workspace',
 *   prNumber: 123,
 *   harness: 'claude',
 *   githubToken: process.env.GITHUB_TOKEN,
 * });
 * ```
 */

import type {
  VerificationReport,
  VerifyOptions,
  TestResults,
  TypeCheck,
  IntegrationCheck,
  VerificationFeedback,
  ActionItem,
  Verdict,
} from './report/schema.js';
import { loadConfig, type VerifierConfig } from './config.js';
import { runAgent, runCommand, getPRDiff, getGitSha, getGitBranch, readFile, startDevServer, checkEndpoint } from './agent.js';
import { VERIFIER_SYSTEM_PROMPT, buildReviewPrompt, buildEndpointDetectionPrompt } from './prompts/system.js';
import { parseReviewOutput, parseEndpointOutput, type DetectedEndpoint } from './report/parser.js';
import { postPRReview, postComment, createCheckRun, updatePRLabels } from './github/review.js';

// Re-export types
export type {
  VerificationReport,
  VerifyOptions,
} from './report/schema.js';
export type { VerifierConfig } from './config.js';
export { loadConfig, DEFAULT_CONFIG } from './config.js';

/**
 * Emit a verifier event to stdout.
 */
function emitEvent(type: string, data: unknown): void {
  console.log(`[VERIFIER:${type}] ${JSON.stringify(data)}`);
}

/**
 * Parse test output to extract test counts.
 */
function parseTestOutput(output: string): Pick<TestResults, 'testsRun' | 'testsPassed' | 'testsFailed' | 'failingTests'> {
  // Try to detect common test runner formats
  let testsRun = 0;
  let testsPassed = 0;
  let testsFailed = 0;
  const failingTests: string[] = [];

  // Jest/Vitest pattern: "Tests: X passed, Y failed, Z total"
  const jestMatch = output.match(/Tests:\s*(\d+)\s*passed(?:,\s*(\d+)\s*failed)?(?:,\s*(\d+)\s*total)?/i);
  if (jestMatch) {
    testsPassed = parseInt(jestMatch[1] ?? '0', 10);
    testsFailed = parseInt(jestMatch[2] ?? '0', 10);
    testsRun = parseInt(jestMatch[3] ?? '0', 10) || testsPassed + testsFailed;
  }

  // Bun test pattern: "X pass, Y fail"
  const bunMatch = output.match(/(\d+)\s*pass(?:ed)?,?\s*(\d+)\s*fail/i);
  if (bunMatch && !jestMatch) {
    testsPassed = parseInt(bunMatch[1] ?? '0', 10);
    testsFailed = parseInt(bunMatch[2] ?? '0', 10);
    testsRun = testsPassed + testsFailed;
  }

  // Extract failing test names (common patterns)
  const failPatterns = [
    /FAIL\s+(.+)/g,
    /✗\s+(.+)/g,
    /✕\s+(.+)/g,
    /×\s+(.+)/g,
  ];
  for (const pattern of failPatterns) {
    let match;
    while ((match = pattern.exec(output)) !== null) {
      if (match[1] && !failingTests.includes(match[1])) {
        failingTests.push(match[1].trim());
      }
    }
  }

  return { testsRun, testsPassed, testsFailed, failingTests };
}

/**
 * Parse type check output to extract errors.
 */
function parseTypeErrors(output: string): TypeCheck['errors'] {
  const errors: TypeCheck['errors'] = [];

  // TypeScript error pattern: "file.ts(line,col): error TS..."
  const tsPattern = /([^\s(]+)\((\d+),\d+\):\s*error\s*TS\d+:\s*(.+)/g;
  let match;
  while ((match = tsPattern.exec(output)) !== null) {
    errors.push({
      file: match[1]!,
      line: parseInt(match[2]!, 10),
      message: match[3]!,
    });
  }

  // Alternative pattern: "file.ts:line:col - error TS..."
  const altPattern = /([^\s:]+):(\d+):\d+\s*-\s*error\s*TS\d+:\s*(.+)/g;
  while ((match = altPattern.exec(output)) !== null) {
    errors.push({
      file: match[1]!,
      line: parseInt(match[2]!, 10),
      message: match[3]!,
    });
  }

  return errors;
}

/**
 * Detect API endpoints from diff.
 */
async function detectEndpoints(repoDir: string, diff: string): Promise<DetectedEndpoint[]> {
  // Quick heuristic check - if no route patterns, skip AI call
  const routePatterns = [
    /\.(get|post|put|delete|patch)\s*\(/i,
    /router\.(get|post|put|delete|patch)/i,
    /app\.(get|post|put|delete|patch)/i,
    /api\/.*\.ts/,
    /export\s+(async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)/,
  ];

  const hasRoutes = routePatterns.some((p) => p.test(diff));
  if (!hasRoutes) {
    return [];
  }

  // Use AI to detect endpoints
  const prompt = buildEndpointDetectionPrompt(diff);
  const result = await runAgent(prompt, { cwd: repoDir, timeoutMs: 60000 });

  if (!result.success) {
    console.warn('Endpoint detection failed:', result.error);
    return [];
  }

  return parseEndpointOutput(result.output);
}

/**
 * Build verification feedback from report.
 */
function buildFeedback(report: VerificationReport): VerificationFeedback | undefined {
  if (report.verdict === 'pass') {
    return undefined;
  }

  const actionItems: ActionItem[] = [];

  // Add test failures as priority 1
  for (const test of report.testResults.failingTests.slice(0, 5)) {
    actionItems.push({
      priority: 1,
      type: 'test_failure',
      description: `Failing test: ${test}`,
    });
  }

  // Add type errors as priority 1
  for (const error of report.typeCheck.errors.slice(0, 5)) {
    actionItems.push({
      priority: 1,
      type: 'type_error',
      description: error.message,
      file: error.file,
      line: error.line,
    });
  }

  // Add missing spec requirements as priority 1
  for (const req of report.specCompliance.missingRequirements.slice(0, 5)) {
    actionItems.push({
      priority: 1,
      type: 'spec_missing',
      description: `Missing requirement: ${req}`,
    });
  }

  // Add code review issues
  for (const issue of report.codeReview.issues) {
    if (issue.severity === 'error') {
      actionItems.push({
        priority: issue.category === 'security' ? 1 : 2,
        type: issue.category === 'security' ? 'security' : 'bug',
        description: issue.message,
        file: issue.file,
        line: issue.line,
        suggestion: issue.suggestion,
      });
    }
  }

  return {
    actionItems: actionItems.slice(0, 20), // Limit to 20 items
    failingTests: report.testResults.failingTests.length > 0
      ? report.testResults.failingTests.map((name) => ({
          name,
          error: 'See test output',
          file: 'unknown',
        }))
      : undefined,
    typeErrors: report.typeCheck.errors.length > 0 ? report.typeCheck.errors : undefined,
    missingRequirements: report.specCompliance.missingRequirements.length > 0
      ? report.specCompliance.missingRequirements
      : undefined,
  };
}

/**
 * Determine overall verdict from check results.
 */
function determineVerdict(
  testStatus: 'pass' | 'fail' | 'skipped',
  typeStatus: 'pass' | 'fail',
  specStatus: 'pass' | 'partial' | 'fail' | 'skipped',
  reviewStatus: 'pass' | 'needs_work' | 'fail',
  integrationStatus: 'pass' | 'fail' | null,
  config: VerifierConfig
): Verdict {
  // Fail conditions
  if (testStatus === 'fail') return 'fail';
  if (typeStatus === 'fail') return 'fail';
  if (specStatus === 'fail') return 'fail';
  if (reviewStatus === 'fail') return 'fail';
  if (integrationStatus === 'fail') return 'fail';

  // Needs work conditions
  if (specStatus === 'partial') return 'needs_work';
  if (reviewStatus === 'needs_work') return 'needs_work';

  return 'pass';
}

/**
 * Parse repository owner and name from repo string.
 */
function parseRepo(repo: string): { owner: string; name: string } {
  const parts = repo.split('/');
  if (parts.length === 2) {
    return { owner: parts[0]!, name: parts[1]! };
  }
  // Assume it's just the name, use "owner" as placeholder
  return { owner: 'owner', name: repo };
}

/**
 * Verify a PR.
 *
 * This is the main entry point for verification.
 *
 * @param options - Verification options
 * @returns Verification report
 */
export async function verify(options: VerifyOptions): Promise<VerificationReport> {
  const startTime = Date.now();
  const { repoDir, prNumber, harness, githubToken } = options;

  emitEvent('START', { pr_number: prNumber, harness });

  // 1. Load config
  const config = loadConfig(repoDir);

  // 2. Get git info
  const sha = options.sha ?? await getGitSha(repoDir);
  const branch = options.branch ?? await getGitBranch(repoDir);
  const repo = options.repo ?? 'unknown/unknown';
  const { owner, name: repoName } = parseRepo(repo);

  // 3. Get PR diff
  emitEvent('CHECK', { check: 'get_diff', status: 'running' });
  const diff = await getPRDiff(repoDir);
  emitEvent('CHECK', { check: 'get_diff', status: 'done' });

  // 4. Run tests (no AI needed)
  emitEvent('CHECK', { check: 'test_run', status: 'running' });
  const testResult = await runCommand(config.tests.command, repoDir, config.tests.timeout);
  const testParsed = parseTestOutput(testResult.output);
  const testResults: TestResults = {
    status: testResult.status,
    ...testParsed,
  };
  emitEvent('CHECK', {
    check: 'test_run',
    status: testResults.status,
    tests_run: testResults.testsRun,
    tests_passed: testResults.testsPassed,
  });

  // 5. Run type check (no AI needed)
  emitEvent('CHECK', { check: 'type_check', status: 'running' });
  const typeResult = await runCommand(config.typeCheck.command, repoDir, 120000);
  const typeErrors = parseTypeErrors(typeResult.output);
  const typeCheck: TypeCheck = {
    status: typeResult.status === 'pass' && typeErrors.length === 0 ? 'pass' : 'fail',
    errors: typeErrors,
  };
  emitEvent('CHECK', {
    check: 'type_check',
    status: typeCheck.status,
    error_count: typeErrors.length,
  });

  // 6. Integration check (if enabled and endpoints detected)
  let integrationCheck: IntegrationCheck | undefined;
  if (config.optional.integrationCheck) {
    emitEvent('CHECK', { check: 'integration', status: 'running' });
    const endpoints = await detectEndpoints(repoDir, diff);

    if (endpoints.length > 0) {
      // Start dev server
      let server;
      try {
        server = await startDevServer(
          config.build.devCommand,
          repoDir,
          config.build.port,
          config.build.startupTimeout
        );

        const issues: string[] = [];
        const testedEndpoints: string[] = [];

        for (const endpoint of endpoints.slice(0, 10)) {
          const url = `http://localhost:${config.build.port}${endpoint.path}`;
          const result = await checkEndpoint(url, endpoint.method);
          testedEndpoints.push(`${endpoint.method} ${endpoint.path}`);

          if (!result.ok) {
            issues.push(
              `${endpoint.method} ${endpoint.path} returned ${result.status}${result.error ? `: ${result.error}` : ''}`
            );
          }
        }

        integrationCheck = {
          status: issues.length === 0 ? 'pass' : 'fail',
          endpointsTested: testedEndpoints,
          issues,
        };
      } catch (error) {
        integrationCheck = {
          status: 'fail',
          endpointsTested: [],
          issues: [`Failed to start dev server: ${error}`],
        };
      } finally {
        if (server) {
          await server.stop();
        }
      }

      emitEvent('CHECK', {
        check: 'integration',
        status: integrationCheck.status,
        endpoints_tested: integrationCheck.endpointsTested.length,
      });
    } else {
      emitEvent('CHECK', { check: 'integration', status: 'skipped', reason: 'no endpoints' });
    }
  }

  // 7. AI: Spec compliance + code review
  emitEvent('CHECK', { check: 'ai_review', status: 'running' });
  const specContent = await readFile(repoDir, 'SPEC.md');
  const reviewPrompt = buildReviewPrompt({
    specContent,
    diff,
    testResults: { status: testResults.status, output: testResult.output },
    typeResults: { status: typeCheck.status, output: typeResult.output },
    integrationResults: integrationCheck
      ? { status: integrationCheck.status, output: integrationCheck.issues.join('\n') }
      : undefined,
  });

  const agentResult = await runAgent(
    VERIFIER_SYSTEM_PROMPT + '\n\n' + reviewPrompt,
    { cwd: repoDir, timeoutMs: 180000 }
  );

  const parsedReview = parseReviewOutput(agentResult.output);
  emitEvent('CHECK', {
    check: 'ai_review',
    status: 'done',
    issues_found: parsedReview.codeReview.issues.length,
  });

  // 8. Determine verdict
  const verdict = determineVerdict(
    testResults.status,
    typeCheck.status,
    parsedReview.specCompliance.status,
    parsedReview.codeReview.status,
    integrationCheck?.status ?? null,
    config
  );

  // 9. Build report
  const report: VerificationReport = {
    prNumber,
    repo,
    branch,
    sha,
    verifiedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    harness,
    verdict,
    summary: parsedReview.summary,
    specCompliance: {
      ...parsedReview.specCompliance,
      scopeCreepIsBlocking: config.thresholds.failOnScopeCreep,
    },
    codeReview: parsedReview.codeReview,
    testResults,
    typeCheck,
    integrationCheck,
    costUsd: agentResult.costUsd,
  };

  // Add feedback if not passing
  report.feedback = buildFeedback(report);

  emitEvent('COMPLETE', report);

  // 10. Post to GitHub
  try {
    // Post PR review with inline comments
    await postPRReview({
      githubToken,
      owner,
      repo: repoName,
      prNumber,
      sha,
      report,
    });

    // Create GitHub Check Run for status check integration
    try {
      await createCheckRun({
        githubToken,
        owner,
        repo: repoName,
        sha,
        report,
      });
    } catch (checkError) {
      // Check runs require GitHub App permissions, may fail for personal tokens
      console.warn('Failed to create check run (may require GitHub App):', checkError);
    }

    // Update PR labels (optional, best-effort)
    try {
      await updatePRLabels({
        githubToken,
        owner,
        repo: repoName,
        prNumber,
        verdict: report.verdict,
      });
    } catch {
      // Labels may not exist in the repo, ignore
    }
  } catch (error) {
    console.error('Failed to post PR review:', error);
    // Try to post a simple comment as fallback
    try {
      await postComment({
        githubToken,
        owner,
        repo: repoName,
        prNumber,
        body: `## 🔍 Whim Verification Report\n\n**Verdict: ${report.verdict.toUpperCase()}**\n\n${report.summary}\n\n*Failed to post full review. See logs for details.*`,
      });
    } catch {
      console.error('Failed to post comment fallback');
    }
  }

  return report;
}
