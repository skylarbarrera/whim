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

import * as fs from 'fs';
import * as path from 'path';
import type {
  VerificationReport,
  VerifyOptions,
  TestResults,
  TypeCheck,
  IntegrationCheck,
  BrowserCheck,
  TemporaryTests,
  VerificationFeedback,
  ActionItem,
  Verdict,
  CritiqueOutput,
  CostTracking,
  FlakyTest,
} from './report/schema.js';
import { loadConfig, type VerifierConfig } from './config.js';
import { runAgent, runCommand, getPRDiff, getGitSha, getGitBranch, readFile, startDevServer, checkEndpoint } from './agent.js';
import { VERIFIER_SYSTEM_PROMPT, buildReviewPrompt, buildEndpointDetectionPrompt, buildCritiquePrompt, buildBrowserCheckPrompt, buildTempTestPrompt } from './prompts/system.js';
import { parseReviewOutput, parseEndpointOutput, parseCritiqueOutput, parseBrowserOutput, parseTempTestOutput, type DetectedEndpoint, type GeneratedTest } from './report/parser.js';
import { postPRReview, postComment, createCheckRun, updatePRLabels } from './github/review.js';

/**
 * Cost tracker for budget enforcement.
 */
interface CostTracker {
  totalCostUsd: number;
  llmCalls: number;
  startTime: number;
  maxCostUsd: number;
  maxDurationMs: number;
  maxLlmCalls: number;
}

/**
 * Create a new cost tracker.
 */
function createCostTracker(config: VerifierConfig): CostTracker {
  return {
    totalCostUsd: 0,
    llmCalls: 0,
    startTime: Date.now(),
    maxCostUsd: config.budget.maxCostUsd,
    maxDurationMs: config.budget.maxDurationMin * 60 * 1000,
    maxLlmCalls: config.budget.maxLlmCalls,
  };
}

/**
 * Check if budget is exceeded.
 */
function checkBudget(tracker: CostTracker): { exceeded: boolean; limitHit?: 'cost' | 'duration' | 'calls' } {
  const elapsed = Date.now() - tracker.startTime;

  if (tracker.totalCostUsd > tracker.maxCostUsd) {
    return { exceeded: true, limitHit: 'cost' };
  }
  if (elapsed > tracker.maxDurationMs) {
    return { exceeded: true, limitHit: 'duration' };
  }
  if (tracker.llmCalls >= tracker.maxLlmCalls) {
    return { exceeded: true, limitHit: 'calls' };
  }

  return { exceeded: false };
}

/**
 * Track an LLM call's cost.
 */
function trackLlmCall(tracker: CostTracker, costUsd?: number): void {
  tracker.llmCalls++;
  if (costUsd !== undefined) {
    tracker.totalCostUsd += costUsd;
  }
}

/**
 * Get cost tracking summary.
 */
function getCostTracking(tracker: CostTracker): CostTracking {
  const budget = checkBudget(tracker);
  return {
    totalCostUsd: tracker.totalCostUsd,
    llmCalls: tracker.llmCalls,
    totalDurationMs: Date.now() - tracker.startTime,
    budgetExceeded: budget.exceeded,
    limitHit: budget.limitHit,
  };
}

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
 * Group issues by category (helper for critique phase).
 */
function groupIssuesByCategory(issues: import('./report/schema.js').CodeIssue[]): import('./report/schema.js').CodeReview['issuesByCategory'] {
  const result: import('./report/schema.js').CodeReview['issuesByCategory'] = {
    security: [],
    bugs: [],
    performance: [],
    quality: [],
    api_contract: [],
  };

  for (const issue of issues) {
    result[issue.category].push(issue);
  }

  return result;
}

/**
 * Count issues by severity (helper for critique phase).
 */
function countIssuesBySeverity(issues: import('./report/schema.js').CodeIssue[]): import('./report/schema.js').CodeReview['counts'] {
  const counts = { errors: 0, warnings: 0, info: 0 };

  for (const issue of issues) {
    switch (issue.severity) {
      case 'error':
        counts.errors++;
        break;
      case 'warning':
        counts.warnings++;
        break;
      case 'info':
        counts.info++;
        break;
    }
  }

  return counts;
}

/**
 * Run tests with flaky test detection.
 *
 * If tests fail, re-runs failing tests once. Tests that pass on retry are marked as flaky.
 */
async function runTestsWithFlakyDetection(
  command: string,
  cwd: string,
  timeoutMs: number
): Promise<{
  status: 'pass' | 'fail';
  output: string;
  flakyTests: FlakyTest[];
  exitCode: number;
}> {
  // First run
  const firstRun = await runCommand(command, cwd, timeoutMs);
  const firstParsed = parseTestOutput(firstRun.output);

  // If all tests pass, no flaky detection needed
  if (firstRun.status === 'pass' || firstParsed.failingTests.length === 0) {
    return {
      status: firstRun.status,
      output: firstRun.output,
      flakyTests: [],
      exitCode: firstRun.exitCode,
    };
  }

  // Re-run to detect flaky tests
  emitEvent('CHECK', { check: 'test_retry', status: 'running', failing_tests: firstParsed.failingTests.length });

  const retryRun = await runCommand(command, cwd, timeoutMs);
  const retryParsed = parseTestOutput(retryRun.output);

  // Find tests that failed first time but passed on retry
  const flakyTests: FlakyTest[] = [];
  for (const failedTest of firstParsed.failingTests) {
    if (!retryParsed.failingTests.includes(failedTest)) {
      flakyTests.push({
        name: failedTest,
        passedOnRetry: true,
      });
    }
  }

  // Determine final status:
  // - If retry passes completely, status is 'pass' (but we report flaky tests)
  // - If retry still has failures (that aren't flaky), status is 'fail'
  const nonFlakyFailures = retryParsed.failingTests.filter(
    (test) => !flakyTests.some((flaky) => flaky.name === test)
  );

  emitEvent('CHECK', {
    check: 'test_retry',
    status: 'done',
    flaky_count: flakyTests.length,
    still_failing: nonFlakyFailures.length,
  });

  return {
    status: retryRun.status === 'pass' || nonFlakyFailures.length === 0 ? 'pass' : 'fail',
    output: retryRun.output,
    flakyTests,
    exitCode: retryRun.exitCode,
  };
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
 * Detect if the diff contains frontend changes.
 *
 * Checks for common frontend file extensions and patterns.
 */
function detectFrontendChanges(diff: string): boolean {
  const frontendPatterns = [
    // File extensions
    /\+\+\+.*\.tsx?\s/,      // .tsx, .ts (TypeScript/React)
    /\+\+\+.*\.jsx?\s/,      // .jsx, .js (JavaScript/React)
    /\+\+\+.*\.vue\s/,       // .vue (Vue)
    /\+\+\+.*\.svelte\s/,    // .svelte (Svelte)
    /\+\+\+.*\.css\s/,       // .css
    /\+\+\+.*\.scss\s/,      // .scss
    /\+\+\+.*\.less\s/,      // .less
    /\+\+\+.*\.html\s/,      // .html

    // Common frontend directories
    /\+\+\+.*\/pages\//,     // Next.js pages
    /\+\+\+.*\/app\//,       // Next.js app router
    /\+\+\+.*\/components\//,// React components
    /\+\+\+.*\/src\/.*\.(tsx|jsx)/,

    // React imports/exports
    /import\s+.*from\s+['"]react['"]/,
    /import\s+.*from\s+['"]next\//,
    /import\s+.*from\s+['"]vue['"]/,

    // JSX patterns
    /<[A-Z][a-zA-Z]*[^>]*>/,  // React component usage
    /className=/,             // React className
    /onClick=/,               // Event handlers
  ];

  return frontendPatterns.some((pattern) => pattern.test(diff));
}

/**
 * Check if agent-browser CLI is available.
 */
async function isAgentBrowserAvailable(): Promise<boolean> {
  try {
    const result = await runCommand('which agent-browser', process.cwd(), 5000);
    return result.status === 'pass';
  } catch {
    return false;
  }
}

/**
 * Detect project type from repository contents.
 */
function detectProjectType(repoDir: string): 'node' | 'python' | 'go' {
  // Check for package.json (Node.js)
  if (fs.existsSync(path.join(repoDir, 'package.json'))) {
    return 'node';
  }
  // Check for pyproject.toml or requirements.txt (Python)
  if (
    fs.existsSync(path.join(repoDir, 'pyproject.toml')) ||
    fs.existsSync(path.join(repoDir, 'requirements.txt')) ||
    fs.existsSync(path.join(repoDir, 'setup.py'))
  ) {
    return 'python';
  }
  // Check for go.mod (Go)
  if (fs.existsSync(path.join(repoDir, 'go.mod'))) {
    return 'go';
  }
  // Default to node
  return 'node';
}

/**
 * Find existing test files related to changed files.
 */
function findRelatedTests(repoDir: string, diff: string): string[] {
  const tests: string[] = [];

  // Extract changed file paths from diff
  const changedFiles = diff.match(/\+\+\+ b\/(.+)/g) ?? [];
  const changedPaths = changedFiles.map((f) => f.replace('+++ b/', ''));

  for (const filePath of changedPaths) {
    // Skip test files themselves
    if (filePath.includes('.test.') || filePath.includes('_test.') || filePath.includes('.spec.')) {
      tests.push(filePath);
      continue;
    }

    // Look for corresponding test file
    const baseName = path.basename(filePath, path.extname(filePath));
    const dirName = path.dirname(filePath);

    // Common test file patterns
    const patterns = [
      path.join(dirName, `${baseName}.test.ts`),
      path.join(dirName, `${baseName}.test.tsx`),
      path.join(dirName, `${baseName}.spec.ts`),
      path.join(dirName, `${baseName}_test.py`),
      path.join(dirName, `${baseName}_test.go`),
      path.join(dirName, '__tests__', `${baseName}.test.ts`),
      path.join(dirName, '__tests__', `${baseName}.test.tsx`),
    ];

    for (const pattern of patterns) {
      const fullPath = path.join(repoDir, pattern);
      if (fs.existsSync(fullPath)) {
        tests.push(pattern);
      }
    }
  }

  return [...new Set(tests)]; // Dedupe
}

/**
 * Get the temp test directory path.
 */
function getTempTestDir(repoDir: string): string {
  return path.join(repoDir, '.whim', 'tmp-tests');
}

/**
 * Write temporary test files to .whim/tmp-tests/.
 */
async function writeTempTests(repoDir: string, tests: GeneratedTest[]): Promise<string[]> {
  const tempDir = getTempTestDir(repoDir);

  // Create temp test directory
  await fs.promises.mkdir(tempDir, { recursive: true });

  const writtenFiles: string[] = [];

  for (const test of tests) {
    const filePath = path.join(tempDir, test.filename);
    await fs.promises.writeFile(filePath, test.content, 'utf8');
    writtenFiles.push(filePath);
  }

  return writtenFiles;
}

/**
 * Clean up temporary test files.
 */
async function cleanupTempTests(repoDir: string): Promise<void> {
  const tempDir = getTempTestDir(repoDir);

  try {
    // Check if directory exists
    await fs.promises.access(tempDir);

    // Remove all files in temp directory
    const files = await fs.promises.readdir(tempDir);
    for (const file of files) {
      await fs.promises.unlink(path.join(tempDir, file));
    }

    // Remove the directory itself
    await fs.promises.rmdir(tempDir);
  } catch {
    // Directory doesn't exist or already cleaned up
  }
}

/**
 * Run temporary tests and return results.
 */
async function runTemporaryTests(
  repoDir: string,
  config: VerifierConfig,
  diff: string,
  costTracker: CostTracker
): Promise<TemporaryTests | undefined> {
  emitEvent('CHECK', { check: 'temp_tests', status: 'running' });

  const projectType = detectProjectType(repoDir);
  const existingTests = findRelatedTests(repoDir, diff);

  // Build prompt for test generation
  const prompt = buildTempTestPrompt({
    diff,
    existingTests,
    projectType,
  });

  // Generate tests via AI
  const agentResult = await runAgent(
    VERIFIER_SYSTEM_PROMPT + '\n\n' + prompt,
    { cwd: repoDir, timeoutMs: 180000 }
  );

  trackLlmCall(costTracker, agentResult.costUsd);

  if (!agentResult.success) {
    emitEvent('CHECK', { check: 'temp_tests', status: 'failed', error: agentResult.error });
    return {
      testsWritten: 0,
      testsRun: 0,
      testsPassed: 0,
      findings: [`Failed to generate tests: ${agentResult.error}`],
    };
  }

  // Parse generated tests
  const parsed = parseTempTestOutput(agentResult.output);

  // If skipped or no tests generated
  if (parsed.skippedReason || parsed.tests.length === 0) {
    emitEvent('CHECK', {
      check: 'temp_tests',
      status: 'skipped',
      reason: parsed.skippedReason ?? 'No coverage gaps found',
    });
    return {
      testsWritten: 0,
      testsRun: 0,
      testsPassed: 0,
      findings: parsed.coverageGaps.length > 0
        ? [`Coverage gaps identified but skipped: ${parsed.skippedReason}`]
        : [],
    };
  }

  // Write tests to temp directory
  let writtenFiles: string[] = [];
  try {
    writtenFiles = await writeTempTests(repoDir, parsed.tests);
    emitEvent('CHECK', { check: 'temp_tests', status: 'written', count: writtenFiles.length });
  } catch (error) {
    emitEvent('CHECK', { check: 'temp_tests', status: 'failed', error: String(error) });
    return {
      testsWritten: 0,
      testsRun: 0,
      testsPassed: 0,
      findings: [`Failed to write tests: ${error}`],
    };
  }

  // Run the tests
  const testCommand = projectType === 'node'
    ? `npx vitest run ${getTempTestDir(repoDir)} --reporter=verbose`
    : projectType === 'python'
      ? `pytest ${getTempTestDir(repoDir)} -v`
      : `go test ${getTempTestDir(repoDir)}/...`;

  const testResult = await runCommand(testCommand, repoDir, config.tests.timeout);
  const testParsed = parseTestOutput(testResult.output);

  // Clean up temp tests (always, even on failure)
  try {
    await cleanupTempTests(repoDir);
  } catch (error) {
    console.warn('Failed to cleanup temp tests:', error);
  }

  // Build findings from test results
  const findings: string[] = [];
  for (const gap of parsed.coverageGaps) {
    findings.push(`Coverage gap: ${gap}`);
  }
  for (const failedTest of testParsed.failingTests) {
    findings.push(`Test failed: ${failedTest}`);
  }

  emitEvent('CHECK', {
    check: 'temp_tests',
    status: testResult.status,
    tests_written: writtenFiles.length,
    tests_run: testParsed.testsRun,
    tests_passed: testParsed.testsPassed,
    tests_failed: testParsed.testsFailed,
  });

  return {
    testsWritten: writtenFiles.length,
    testsRun: testParsed.testsRun,
    testsPassed: testParsed.testsPassed,
    findings,
  };
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

  // Add temporary test findings as priority 2
  if (report.temporaryTests?.findings) {
    for (const finding of report.temporaryTests.findings.slice(0, 5)) {
      actionItems.push({
        priority: 2,
        type: 'review',
        description: finding,
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
  browserStatus: 'pass' | 'warnings' | 'fail' | null,
  config: VerifierConfig
): Verdict {
  // Fail conditions
  if (testStatus === 'fail') return 'fail';
  if (typeStatus === 'fail') return 'fail';
  if (specStatus === 'fail') return 'fail';
  if (reviewStatus === 'fail') return 'fail';
  if (integrationStatus === 'fail') return 'fail';
  if (browserStatus === 'fail') return 'fail';

  // Needs work conditions
  if (specStatus === 'partial') return 'needs_work';
  if (reviewStatus === 'needs_work') return 'needs_work';
  if (browserStatus === 'warnings') return 'needs_work';

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

  // Phase 3: Initialize cost tracker for budget enforcement
  const costTracker = createCostTracker(config);

  // 2. Get git info
  const sha = options.sha ?? await getGitSha(repoDir);
  const branch = options.branch ?? await getGitBranch(repoDir);
  const repo = options.repo ?? 'unknown/unknown';
  const { owner, name: repoName } = parseRepo(repo);

  // 3. Get PR diff
  emitEvent('CHECK', { check: 'get_diff', status: 'running' });
  const diff = await getPRDiff(repoDir);
  emitEvent('CHECK', { check: 'get_diff', status: 'done' });

  // 4. Run tests with flaky detection (Phase 3)
  emitEvent('CHECK', { check: 'test_run', status: 'running' });
  const testResult = await runTestsWithFlakyDetection(config.tests.command, repoDir, config.tests.timeout);
  const testParsed = parseTestOutput(testResult.output);
  const testResults: TestResults = {
    status: testResult.status,
    ...testParsed,
    flakyTests: testResult.flakyTests.length > 0 ? testResult.flakyTests : undefined,
  };
  emitEvent('CHECK', {
    check: 'test_run',
    status: testResults.status,
    tests_run: testResults.testsRun,
    tests_passed: testResults.testsPassed,
    flaky_tests: testResult.flakyTests.length,
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

  // 7. Browser check (if enabled and frontend changes detected)
  let browserCheck: BrowserCheck | undefined;
  const hasFrontendChanges = detectFrontendChanges(diff);

  if (config.optional.browserCheck && hasFrontendChanges) {
    emitEvent('CHECK', { check: 'browser', status: 'running' });

    // Check if agent-browser is available
    const agentBrowserAvailable = await isAgentBrowserAvailable();

    if (!agentBrowserAvailable) {
      emitEvent('CHECK', {
        check: 'browser',
        status: 'skipped',
        reason: 'agent-browser CLI not installed. Install with: npm install -g agent-browser && agent-browser install',
      });
    } else {
      // Start dev server for browser check
      let server;
      try {
        server = await startDevServer(
          config.build.devCommand,
          repoDir,
          config.build.port,
          config.build.startupTimeout
        );

        // Build and run browser check prompt
        const browserPrompt = buildBrowserCheckPrompt({
          port: config.build.port,
          pages: config.browser.pages,
        });

        const browserResult = await runAgent(
          VERIFIER_SYSTEM_PROMPT + '\n\n' + browserPrompt,
          { cwd: repoDir, timeoutMs: 180000 }
        );

        // Track LLM cost
        trackLlmCall(costTracker, browserResult.costUsd);

        // Parse browser check output
        const parsedBrowser = parseBrowserOutput(browserResult.output);

        browserCheck = {
          status: parsedBrowser.status,
          pagesChecked: parsedBrowser.pagesChecked,
          issues: parsedBrowser.issues,
          screenshots: parsedBrowser.screenshots,
        };

        emitEvent('CHECK', {
          check: 'browser',
          status: browserCheck.status,
          pages_checked: browserCheck.pagesChecked.length,
          issues_found: browserCheck.issues.length,
        });
      } catch (error) {
        browserCheck = {
          status: 'fail',
          pagesChecked: [],
          issues: [{
            page: 'unknown',
            type: 'render',
            message: `Failed to run browser check: ${error}`,
          }],
        };
        emitEvent('CHECK', {
          check: 'browser',
          status: 'fail',
          error: String(error),
        });
      } finally {
        if (server) {
          await server.stop();
        }
      }
    }
  } else if (config.optional.browserCheck && !hasFrontendChanges) {
    emitEvent('CHECK', { check: 'browser', status: 'skipped', reason: 'no frontend changes detected' });
  }

  // 8. Temporary test generation (if enabled)
  let temporaryTests: TemporaryTests | undefined;
  const tempTestBudgetCheck = checkBudget(costTracker);

  if (config.optional.temporaryTests && !tempTestBudgetCheck.exceeded) {
    try {
      temporaryTests = await runTemporaryTests(repoDir, config, diff, costTracker);
    } catch (error) {
      emitEvent('CHECK', { check: 'temp_tests', status: 'failed', error: String(error) });
      temporaryTests = {
        testsWritten: 0,
        testsRun: 0,
        testsPassed: 0,
        findings: [`Failed to run temporary tests: ${error}`],
      };
    }
  } else if (tempTestBudgetCheck.exceeded) {
    emitEvent('CHECK', { check: 'temp_tests', status: 'skipped', reason: 'budget exceeded' });
  }

  // 9. AI: Spec compliance + code review
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

  // Phase 3: Track LLM call cost
  trackLlmCall(costTracker, agentResult.costUsd);

  let parsedReview = parseReviewOutput(agentResult.output);
  emitEvent('CHECK', {
    check: 'ai_review',
    status: 'done',
    issues_found: parsedReview.codeReview.issues.length,
  });

  // Phase 3: Self-critique phase (CRITIQUE)
  let critiqueOutput: CritiqueOutput | undefined;
  const budgetCheck = checkBudget(costTracker);

  if (parsedReview.codeReview.issues.length > 0 && !budgetCheck.exceeded) {
    const critiquePrompt = buildCritiquePrompt({
      issues: parsedReview.codeReview.issues,
      diff,
    });

    if (critiquePrompt) {
      emitEvent('PHASE', { phase: 'critique', status: 'running', original_issues: parsedReview.codeReview.issues.length });

      const critiqueResult = await runAgent(critiquePrompt, { cwd: repoDir, timeoutMs: 120000 });
      trackLlmCall(costTracker, critiqueResult.costUsd);

      const critiqueParsed = parseCritiqueOutput(critiqueResult.output, parsedReview.codeReview.issues);

      // Update code review with filtered issues
      parsedReview = {
        ...parsedReview,
        codeReview: {
          ...parsedReview.codeReview,
          issues: critiqueParsed.filteredIssues,
          issuesByCategory: groupIssuesByCategory(critiqueParsed.filteredIssues),
          counts: countIssuesBySeverity(critiqueParsed.filteredIssues),
        },
      };

      critiqueOutput = {
        originalFindings: critiqueParsed.originalCount,
        filteredFindings: critiqueParsed.filteredCount,
        filterReasons: critiqueParsed.removedIssues.map((r) => ({
          finding: r.originalMessage,
          reason: r.reason,
        })),
      };

      emitEvent('PHASE', {
        phase: 'critique',
        status: 'done',
        original: critiqueParsed.originalCount,
        filtered: critiqueParsed.filteredCount,
        removed: critiqueParsed.removedIssues.length,
      });
    }
  } else if (budgetCheck.exceeded) {
    emitEvent('BUDGET_EXCEEDED', { limit: budgetCheck.limitHit, ...getCostTracking(costTracker) });
  }

  // 9. Determine verdict
  const verdict = determineVerdict(
    testResults.status,
    typeCheck.status,
    parsedReview.specCompliance.status,
    parsedReview.codeReview.status,
    integrationCheck?.status ?? null,
    browserCheck?.status ?? null,
    config
  );

  // 10. Build report
  const finalCostTracking = getCostTracking(costTracker);
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
    temporaryTests,
    integrationCheck,
    browserCheck,
    costUsd: finalCostTracking.totalCostUsd,
    // Phase 3: Include critique and cost tracking
    critique: critiqueOutput,
    costTracking: finalCostTracking,
  };

  // Add feedback if not passing
  report.feedback = buildFeedback(report);

  emitEvent('COMPLETE', report);

  // 11. Post to GitHub
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
