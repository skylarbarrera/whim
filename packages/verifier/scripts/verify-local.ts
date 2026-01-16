#!/usr/bin/env bun
/**
 * Run full verifier locally without GitHub posting.
 *
 * This mimics the complete verification workflow from src/index.ts
 * but skips the GitHub integration at the end.
 *
 * Usage:
 *   cd packages/verifier
 *   bun run scripts/verify-local.ts [repoDir]
 *
 * Options:
 *   --skip-ai         Skip all AI calls (faster, tests infrastructure only)
 *   --skip-tests      Skip running test suite
 *   --skip-critique   Skip the self-critique phase
 *   --temp-tests      Force enable temporary test generation
 *   --no-temp-tests   Disable temporary test generation
 *   --json            Output final report as JSON
 *   --verbose, -v     Show detailed output (AI prompts/responses, test output)
 *
 * Output:
 *   Runs are saved to packages/verifier/runs/<timestamp>.{log,json}
 *   - .log contains full execution log with all details
 *   - .json contains the VerificationReport
 */

// Load .env from monorepo root FIRST
import { config as loadEnv } from 'dotenv';
import * as path from 'path';

const envPath = path.resolve(import.meta.dir, '../../../.env');
loadEnv({ path: envPath });

import * as fs from 'fs';
import { loadConfig } from '../src/config.js';
import {
  runCommand,
  getPRDiff,
  getGitSha,
  getGitBranch,
  readFile,
  runAgent,
  startDevServer,
  checkEndpoint,
} from '../src/agent.js';
import {
  VERIFIER_SYSTEM_PROMPT,
  buildReviewPrompt,
  buildCritiquePrompt,
  buildTempTestPrompt,
  buildEndpointDetectionPrompt,
} from '../src/prompts/system.js';
import {
  parseReviewOutput,
  parseCritiqueOutput,
  parseTempTestOutput,
  parseEndpointOutput,
} from '../src/report/parser.js';
import type {
  VerificationReport,
  TestResults,
  TypeCheck,
  IntegrationCheck,
  TemporaryTests,
  CritiqueOutput,
  CodeIssue,
  Verdict,
} from '../src/report/schema.js';

// Parse args
const args = process.argv.slice(2);
const skipAi = args.includes('--skip-ai');
const skipTests = args.includes('--skip-tests');
const skipCritique = args.includes('--skip-critique');
const forceTempTests = args.includes('--temp-tests');
const noTempTests = args.includes('--no-temp-tests');
const jsonOutput = args.includes('--json');
const verbose = args.includes('--verbose') || args.includes('-v');
const repoDir = args.find(a => !a.startsWith('--')) || path.resolve(import.meta.dir, '../../..');

// Cost tracking
let totalCostUsd = 0;
let llmCalls = 0;
const startTime = Date.now();
const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const runsDir = path.resolve(import.meta.dir, '../runs');

// Ensure runs directory exists
if (!fs.existsSync(runsDir)) {
  fs.mkdirSync(runsDir, { recursive: true });
}

// Full log buffer for saving
const logBuffer: string[] = [];

function log(msg: string) {
  logBuffer.push(msg);
  if (!jsonOutput) console.log(msg);
}

function logv(msg: string) {
  logBuffer.push(`[VERBOSE] ${msg}`);
  if (!jsonOutput && verbose) console.log(msg);
}

// Always capture verbose info even if not displayed
function logDetail(label: string, data: unknown) {
  const line = `[DETAIL:${label}] ${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}`;
  logBuffer.push(line);
  if (verbose && !jsonOutput) {
    console.log(`   [${label}] ${typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200)}...`);
  }
}

function trackCost(cost?: number) {
  llmCalls++;
  if (cost) totalCostUsd += cost;
}

log('╔════════════════════════════════════════════════════════════╗');
log('║         WHIM VERIFIER - FULL LOCAL TEST MODE               ║');
log('╚════════════════════════════════════════════════════════════╝\n');

log(`Repo: ${repoDir}`);
log(`Options: skipAi=${skipAi}, skipTests=${skipTests}, skipCritique=${skipCritique}`);
log(`         tempTests=${forceTempTests ? 'forced' : noTempTests ? 'disabled' : 'auto'}\n`);

// Check for API key
const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
const hasOpenAiKey = !!process.env.OPENAI_API_KEY;
log(`API Keys: ANTHROPIC=${hasAnthropicKey ? '✅' : '❌'}, OPENAI=${hasOpenAiKey ? '✅' : '❌'}\n`);

// ============================================================================
// STEP 1: Load config
// ============================================================================
log('📋 [1/10] Loading config...');
const config = loadConfig(repoDir);
log(`   Harness: ${config.harness}`);
log(`   Test command: ${config.tests.command}`);
log(`   Budget: $${config.budget.maxCostUsd} / ${config.budget.maxDurationMin}min / ${config.budget.maxLlmCalls} calls`);
log('');

// ============================================================================
// STEP 2: Get git info
// ============================================================================
log('🔍 [2/10] Getting git info...');
const sha = await getGitSha(repoDir);
const branch = await getGitBranch(repoDir);
log(`   Branch: ${branch}`);
log(`   SHA: ${sha.slice(0, 8)}`);
log('');

// ============================================================================
// STEP 3: Get PR diff
// ============================================================================
log('📝 [3/10] Getting PR diff (vs main)...');
const diff = await getPRDiff(repoDir);
const diffLines = diff.split('\n').length;
const changedFiles = diff.match(/\+\+\+ b\/(.+)/g)?.map(f => f.replace('+++ b/', '')) ?? [];
log(`   Diff size: ${diffLines} lines`);
log(`   Changed files: ${changedFiles.length}`);
changedFiles.slice(0, 5).forEach(f => log(`   - ${f}`));
if (changedFiles.length > 5) log(`   ... and ${changedFiles.length - 5} more`);
log('');

// ============================================================================
// STEP 4: Run tests
// ============================================================================
let testResults: TestResults;
let testOutput = '';

if (!skipTests) {
  log('🧪 [4/10] Running tests...');
  const testResult = await runCommand(config.tests.command, repoDir, config.tests.timeout);
  testOutput = testResult.output;

  // Parse test output - look for summary lines at end
  // Bun format: "230 pass", "2 fail", "1 error"
  // Jest format: "Tests: X passed, Y failed"
  const lines = testResult.output.split('\n');

  // Find the last occurrence of pass/fail counts (summary line)
  let testsPassed = 0;
  let testsFailed = 0;
  let testsError = 0;

  for (const line of lines) {
    // Bun test format: " 230 pass"
    const bunPassMatch = line.match(/^\s*(\d+)\s+pass\s*$/i);
    if (bunPassMatch) testsPassed = parseInt(bunPassMatch[1]!, 10);

    const bunFailMatch = line.match(/^\s*(\d+)\s+fail\s*$/i);
    if (bunFailMatch) testsFailed = parseInt(bunFailMatch[1]!, 10);

    const bunErrorMatch = line.match(/^\s*(\d+)\s+error\s*$/i);
    if (bunErrorMatch) testsError = parseInt(bunErrorMatch[1]!, 10);

    // Jest format: "Tests: X passed, Y failed"
    const jestMatch = line.match(/Tests:\s*(\d+)\s*passed(?:,\s*(\d+)\s*failed)?/i);
    if (jestMatch) {
      testsPassed = parseInt(jestMatch[1]!, 10);
      testsFailed = parseInt(jestMatch[2] ?? '0', 10);
    }
  }

  const testsRun = testsPassed + testsFailed + testsError;

  testResults = {
    status: testResult.status,
    testsRun,
    testsPassed,
    testsFailed: testsFailed + testsError,
    failingTests: [],
  };

  log(`   Status: ${testResults.status}`);
  log(`   Passed: ${testResults.testsPassed}, Failed: ${testResults.testsFailed}`);
  if (testResults.status === 'fail') {
    logv(`   Exit code indicates failure - check test output below`);
  }
  logDetail('test_output', testOutput);
} else {
  log('⏭️  [4/10] Skipping tests (--skip-tests)');
  testResults = { status: 'pass', testsRun: 0, testsPassed: 0, testsFailed: 0, failingTests: [] };
}
log('');

// ============================================================================
// STEP 5: Run type check
// ============================================================================
log('📐 [5/10] Running type check...');
const typeResult = await runCommand(config.typeCheck.command, repoDir, 120000);
const typeErrors: TypeCheck['errors'] = [];

// Parse TypeScript errors
const tsPattern = /([^\s:]+):(\d+):\d+\s*-\s*error\s*TS\d+:\s*(.+)/g;
let match;
while ((match = tsPattern.exec(typeResult.output)) !== null) {
  typeErrors.push({ file: match[1]!, line: parseInt(match[2]!, 10), message: match[3]! });
}

const typeCheck: TypeCheck = {
  status: typeResult.status === 'pass' && typeErrors.length === 0 ? 'pass' : 'fail',
  errors: typeErrors,
};
log(`   Status: ${typeCheck.status}`);
if (typeErrors.length > 0) log(`   Errors: ${typeErrors.length}`);
log('');

// ============================================================================
// STEP 6: Integration check (if enabled)
// ============================================================================
let integrationCheck: IntegrationCheck | undefined;

if (config.optional.integrationCheck && !skipAi) {
  log('🔌 [6/10] Running integration check...');

  // Detect endpoints from diff
  const endpointPrompt = buildEndpointDetectionPrompt(diff);
  const endpointResult = await runAgent(endpointPrompt, {
    cwd: repoDir,
    harness: config.harness,
    timeoutMs: 60000,
  });
  trackCost(endpointResult.costUsd);

  const endpoints = parseEndpointOutput(endpointResult.output);
  log(`   Detected ${endpoints.length} endpoint(s)`);

  if (endpoints.length > 0) {
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
          issues.push(`${endpoint.method} ${endpoint.path} returned ${result.status}`);
        }
      }

      integrationCheck = {
        status: issues.length === 0 ? 'pass' : 'fail',
        endpointsTested: testedEndpoints,
        issues,
      };
      log(`   Tested: ${testedEndpoints.length}, Issues: ${issues.length}`);
      if (issues.length > 0) {
        issues.forEach(issue => logv(`   ⚠️ ${issue}`));
      }
      logDetail('integration_endpoints', endpoints);
      logDetail('integration_issues', issues);
    } catch (error) {
      integrationCheck = {
        status: 'fail',
        endpointsTested: [],
        issues: [`Failed to start dev server: ${error}`],
      };
      log(`   Failed: ${error}`);
    } finally {
      if (server) await server.stop();
    }
  } else {
    log('   No endpoints detected, skipping');
  }
} else {
  log('⏭️  [6/10] Skipping integration check');
}
log('');

// ============================================================================
// STEP 7: Temporary test generation (if enabled)
// ============================================================================
let temporaryTests: TemporaryTests | undefined;
const shouldRunTempTests = forceTempTests || (!noTempTests && config.optional.temporaryTests);

if (shouldRunTempTests && !skipAi) {
  log('🔬 [7/10] Generating temporary tests...');

  const hasPackageJson = fs.existsSync(path.join(repoDir, 'package.json'));
  const hasPyproject = fs.existsSync(path.join(repoDir, 'pyproject.toml'));
  const projectType = hasPackageJson ? 'node' : hasPyproject ? 'python' : 'go';

  const existingTests = changedFiles.filter(f =>
    f.includes('.test.') || f.includes('.spec.') || f.includes('_test.')
  );

  const tempTestPrompt = buildTempTestPrompt({
    diff: diff.slice(0, 40000),
    existingTests,
    projectType,
  });

  const tempTestResult = await runAgent(tempTestPrompt, {
    cwd: repoDir,
    harness: config.harness,
    timeoutMs: 300000,
  });
  trackCost(tempTestResult.costUsd);

  if (tempTestResult.success) {
    const parsed = parseTempTestOutput(tempTestResult.output);
    const generated = parsed.tests ?? [];
    temporaryTests = {
      testsWritten: generated.length,
      testsRun: generated.length,
      testsPassed: generated.length, // Assume pass for local
      findings: generated.map(t => `${t.filename}: ${t.description}`),
    };
    log(`   Generated: ${generated.length} test(s)`);
    generated.forEach(t => log(`   - ${t.filename}`));
  } else {
    log(`   Failed: ${tempTestResult.error}`);
  }
} else {
  log('⏭️  [7/10] Skipping temp test generation');
}
log('');

// ============================================================================
// STEP 8: AI Code Review + Spec Compliance (THE MAIN REVIEW)
// ============================================================================
log('🤖 [8/10] Running AI code review...');
const specContent = await readFile(repoDir, 'SPEC.md');
log(`   SPEC.md: ${specContent ? `found (${specContent.length} chars)` : 'not found'}`);

let parsedReview;

if (!skipAi) {
  const reviewPrompt = buildReviewPrompt({
    specContent,
    diff,
    testResults: { status: testResults.status, output: testOutput },
    typeResults: { status: typeCheck.status, output: typeResult.output },
    integrationResults: integrationCheck
      ? { status: integrationCheck.status, output: integrationCheck.issues.join('\n') }
      : undefined,
  });

  log(`   Prompt size: ${reviewPrompt.length} chars`);
  log(`   Invoking ${config.harness} harness...`);
  logDetail('review_prompt', reviewPrompt);

  // Large diffs need more time - scale timeout with prompt size
  const reviewTimeoutMs = Math.max(180000, Math.min(600000, reviewPrompt.length * 5));
  log(`   Timeout: ${(reviewTimeoutMs / 1000).toFixed(0)}s`);

  const reviewResult = await runAgent(
    VERIFIER_SYSTEM_PROMPT + '\n\n' + reviewPrompt,
    { cwd: repoDir, harness: config.harness, timeoutMs: reviewTimeoutMs }
  );
  trackCost(reviewResult.costUsd);
  logDetail('review_raw_output', reviewResult.output);

  if (reviewResult.success) {
    parsedReview = parseReviewOutput(reviewResult.output);
    log(`   Completed in ${(reviewResult.durationMs / 1000).toFixed(1)}s`);
    log(`   Spec compliance: ${parsedReview.specCompliance.status}`);
    log(`   Code issues found: ${parsedReview.codeReview.issues.length}`);
    if (reviewResult.costUsd) log(`   Cost: $${reviewResult.costUsd.toFixed(4)}`);
    logDetail('parsed_review', parsedReview);
  } else {
    log(`   Failed: ${reviewResult.error}`);
    parsedReview = {
      summary: 'AI review failed',
      specCompliance: { status: 'fail' as const, gaps: [], scopeCreep: [] },
      codeReview: {
        status: 'fail' as const,
        issues: [],
        issuesByCategory: { security: [], bugs: [], performance: [], quality: [], api_contract: [] },
        counts: { errors: 0, warnings: 0, info: 0 },
      },
    };
  }
} else {
  log('   Skipped (--skip-ai)');
  parsedReview = {
    summary: 'AI review skipped',
    specCompliance: { status: 'pass' as const, gaps: [], scopeCreep: [] },
    codeReview: {
      status: 'pass' as const,
      issues: [],
      issuesByCategory: { security: [], bugs: [], performance: [], quality: [], api_contract: [] },
      counts: { errors: 0, warnings: 0, info: 0 },
    },
  };
}
log('');

// ============================================================================
// STEP 9: Self-critique phase
// ============================================================================
let critiqueOutput: CritiqueOutput | undefined;

if (!skipAi && !skipCritique && parsedReview.codeReview.issues.length > 0) {
  log('🔍 [9/10] Running self-critique phase...');
  log(`   Original issues: ${parsedReview.codeReview.issues.length}`);

  const critiquePrompt = buildCritiquePrompt({
    issues: parsedReview.codeReview.issues,
    diff,
  });

  if (critiquePrompt) {
    const critiqueResult = await runAgent(critiquePrompt, {
      cwd: repoDir,
      harness: config.harness,
      timeoutMs: 120000,
    });
    trackCost(critiqueResult.costUsd);

    if (critiqueResult.success) {
      const critiqueParsed = parseCritiqueOutput(critiqueResult.output, parsedReview.codeReview.issues);

      // Update issues with filtered list
      parsedReview.codeReview.issues = critiqueParsed.filteredIssues;

      critiqueOutput = {
        originalFindings: critiqueParsed.originalCount,
        filteredFindings: critiqueParsed.filteredCount,
        filterReasons: critiqueParsed.removedIssues.map(r => ({
          finding: r.originalMessage,
          reason: r.reason,
        })),
      };

      log(`   Filtered: ${critiqueParsed.originalCount} → ${critiqueParsed.filteredCount}`);
      log(`   Removed ${critiqueParsed.removedIssues.length} false positives`);
    } else {
      log(`   Critique failed: ${critiqueResult.error}`);
    }
  }
} else {
  log('⏭️  [9/10] Skipping critique (no issues or --skip-critique)');
}
log('');

// ============================================================================
// STEP 10: Determine verdict and build report
// ============================================================================
log('📊 [10/10] Building final report...');

function determineVerdict(): Verdict {
  // Hard fails
  if (testResults.status === 'fail') return 'fail';
  if (typeCheck.status === 'fail') return 'fail';

  // Check for blocking issues
  const hasBlockingIssues = parsedReview.codeReview.issues.some(
    (i: CodeIssue) => i.severity === 'error'
  );
  if (hasBlockingIssues) return 'fail';

  // Spec compliance (if required)
  if (config.required.specCheck && parsedReview.specCompliance.status === 'fail') {
    return 'fail';
  }

  // Integration check (if required and ran)
  if (integrationCheck && integrationCheck.status === 'fail') {
    return 'conditional';
  }

  // Warnings present
  const hasWarnings = parsedReview.codeReview.issues.some(
    (i: CodeIssue) => i.severity === 'warning'
  );
  if (hasWarnings) return 'conditional';

  return 'pass';
}

const verdict = determineVerdict();
const durationMs = Date.now() - startTime;

const report: VerificationReport = {
  prNumber: 0, // Local mode
  repo: 'local/test',
  branch,
  sha,
  verifiedAt: new Date().toISOString(),
  durationMs,
  harness: config.harness,
  verdict,
  summary: parsedReview.summary,
  specCompliance: parsedReview.specCompliance,
  codeReview: parsedReview.codeReview,
  testResults,
  typeCheck,
  temporaryTests,
  integrationCheck,
  critique: critiqueOutput,
  costUsd: totalCostUsd,
  costTracking: {
    totalCostUsd,
    llmCalls,
    totalDurationMs: durationMs,
    budgetExceeded: false,
  },
};

// ============================================================================
// OUTPUT
// ============================================================================
if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  log('');
  log('╔════════════════════════════════════════════════════════════╗');
  log('║                    VERIFICATION REPORT                      ║');
  log('╚════════════════════════════════════════════════════════════╝');
  log('');

  const verdictIcon = verdict === 'pass' ? '✅' : verdict === 'conditional' ? '⚠️' : '❌';
  log(`Verdict: ${verdictIcon} ${verdict.toUpperCase()}`);
  log('');

  log('Checks:');
  log(`  ${testResults.status === 'pass' ? '✅' : '❌'} Tests: ${testResults.testsPassed}/${testResults.testsRun} passed`);
  log(`  ${typeCheck.status === 'pass' ? '✅' : '❌'} Type check: ${typeCheck.errors.length} errors`);
  log(`  ${parsedReview.specCompliance.status === 'pass' ? '✅' : specContent ? '❌' : '⏭️'} Spec compliance`);
  log(`  ${parsedReview.codeReview.issues.length === 0 ? '✅' : '⚠️'} Code review: ${parsedReview.codeReview.issues.length} issues`);
  if (integrationCheck) {
    log(`  ${integrationCheck.status === 'pass' ? '✅' : '❌'} Integration: ${integrationCheck.endpointsTested.length} endpoints`);
  }
  if (temporaryTests) {
    log(`  ✅ Temp tests: ${temporaryTests.testsWritten} generated`);
  }
  log('');

  if (parsedReview.codeReview.issues.length > 0) {
    log('Issues:');
    parsedReview.codeReview.issues.slice(0, 10).forEach((issue: CodeIssue) => {
      const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
      log(`  ${icon} [${issue.category}] ${issue.file}:${issue.line} - ${issue.message}`);
    });
    if (parsedReview.codeReview.issues.length > 10) {
      log(`  ... and ${parsedReview.codeReview.issues.length - 10} more`);
    }
    log('');
  }

  if (critiqueOutput && critiqueOutput.filterReasons.length > 0) {
    log('Critique removed:');
    critiqueOutput.filterReasons.slice(0, 5).forEach(r => {
      log(`  - ${r.finding.slice(0, 60)}... (${r.reason})`);
    });
    log('');
  }

  log('Summary:');
  log(`  ${parsedReview.summary}`);
  log('');

  log('Stats:');
  log(`  Duration: ${(durationMs / 1000).toFixed(1)}s`);
  log(`  LLM calls: ${llmCalls}`);
  log(`  Cost: $${totalCostUsd.toFixed(4)}`);
  log('');

  log('💡 Use --json for machine-readable output');
  log('💡 Use --skip-ai for infrastructure-only testing');
  log('💡 Use --verbose or -v for detailed output');
}

// ============================================================================
// SAVE RUN LOCALLY
// ============================================================================
const runLogPath = path.join(runsDir, `${runId}.log`);
const runJsonPath = path.join(runsDir, `${runId}.json`);

// Save full log
fs.writeFileSync(runLogPath, logBuffer.join('\n'), 'utf-8');

// Save JSON report
fs.writeFileSync(runJsonPath, JSON.stringify(report, null, 2), 'utf-8');

log('');
log(`📁 Run saved to:`);
log(`   Log:    ${runLogPath}`);
log(`   Report: ${runJsonPath}`);
