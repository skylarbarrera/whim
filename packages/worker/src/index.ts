import { OrchestratorClient } from './client.js';
import { setupWorkspace, createPullRequest, verifyGitAuth, archiveSpec } from './setup.js';
import {
  loadLearnings,
  saveLearnings,
  getLearningsPath,
  getNewLearningsPath,
} from './learnings.js';
import { runRalph } from './ralph.js';
import { runMockRalph } from './mock-ralph.js';
import { runTests } from './testing.js';
import { reviewPullRequest, runReviewFixes, hasActionableIssues } from './review.js';
import type { ExecutionReadyWorkItem } from './types.js';
import {
  readRalphConfig,
  readWhimConfig,
  getDefaultRalphConfig,
  getDefaultWhimConfig,
} from './config.js';
import { runVerificationWorker } from './verification-worker.js';
import { validateEnvironment } from './shared-worker.js';
import type { HarnessName } from '@whim/harness';

/**
 * Get harness from HARNESS env var (overrides config file)
 */
function getHarnessFromEnv(): 'claude' | 'codex' | 'opencode' | undefined {
  const harness = process.env.HARNESS?.toLowerCase();
  if (harness === 'claude' || harness === 'codex' || harness === 'opencode') {
    return harness;
  }
  return undefined;
}

interface WorkerConfig {
  orchestratorUrl: string;
  workerId: string;
  workItem: ExecutionReadyWorkItem;
  githubToken: string;
  workDir: string;
  claudeConfigDir?: string;
}

function getConfig(): WorkerConfig {
  const env = validateEnvironment();

  // Validate execution-ready fields
  if (!env.workItem.spec) {
    throw new Error('Work item must have a spec to execute (spec is null/undefined)');
  }
  if (!env.workItem.branch) {
    throw new Error('Work item must have a branch to execute (branch is null/undefined)');
  }

  // Type narrowing: we've validated spec and branch are present
  const executionReadyWorkItem: ExecutionReadyWorkItem = {
    ...env.workItem,
    spec: env.workItem.spec,
    branch: env.workItem.branch,
  };

  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR;

  return {
    orchestratorUrl: env.orchestratorUrl,
    workerId: env.workerId,
    workItem: executionReadyWorkItem,
    githubToken: env.githubToken,
    workDir: env.workDir,
    claudeConfigDir,
  };
}

async function main(): Promise<void> {
  console.log('Worker starting...');

  const config = getConfig();
  console.log(`Worker ID: ${config.workerId}`);
  console.log(`Work Item: ${config.workItem.id}`);
  console.log(`Repo: ${config.workItem.repo}`);
  console.log(`Branch: ${config.workItem.branch}`);

  const client = new OrchestratorClient({
    baseUrl: config.orchestratorUrl,
    workerId: config.workerId,
    repo: config.workItem.repo,
  });

  console.log('Setting up workspace...');
  const repoDir = await setupWorkspace(config.workItem, {
    workDir: config.workDir,
    githubToken: config.githubToken,
    claudeConfigDir: config.claudeConfigDir,
  });
  console.log(`Workspace ready at: ${repoDir}`);

  // Read config files from target repo
  console.log('Reading repository configs...');
  const ralphConfig = (await readRalphConfig(repoDir)) ?? getDefaultRalphConfig();
  const whimConfig = (await readWhimConfig(repoDir)) ?? getDefaultWhimConfig();
  const effectiveHarness = getHarnessFromEnv() ?? ralphConfig.harness ?? 'claude';
  console.log(
    `Ralph harness: ${effectiveHarness}${getHarnessFromEnv() ? ' (from HARNESS env)' : ''}`
  );
  console.log(`Project type: ${whimConfig.type}`);
  console.log(`Verification enabled: ${whimConfig.verification.enabled}`);

  // Verify git push access BEFORE doing any work
  console.log('Verifying git push access...');
  const authResult = await verifyGitAuth(repoDir, config.githubToken);
  if (!authResult.success) {
    console.error('Git auth verification failed:', authResult.error);
    await client.fail(`Git auth failed: ${authResult.error}`, 0);
    console.log('Failure reported to orchestrator');
    return;
  }
  console.log('Git push access verified');

  console.log('Loading learnings...');
  const learningsPath = getLearningsPath(repoDir);
  await loadLearnings(client, config.workItem.repo, learningsPath);
  console.log('Learnings loaded');

  // Use mock Ralph for testing lifecycle without burning Claude tokens
  const useMock = process.env.MOCK_RALPH === '1' || process.env.MOCK_RALPH === 'true';

  if (useMock) {
    console.log('Starting Mock Ralph (MOCK_RALPH=1)...');
  } else {
    console.log('Starting Ralph...');
  }

  const onOutput = (line: string) => {
    console.log(line);
  };

  const result = useMock
    ? await runMockRalph(repoDir, client, {
        toolDelay: 200,
        toolCount: 15,
        totalDuration: 3000,
        shouldSucceed: process.env.MOCK_FAIL !== '1',
        shouldGetStuck: process.env.MOCK_STUCK === '1',
        onOutput,
      })
    : await runRalph(repoDir, client, {
        maxIterations: config.workItem.maxIterations,
        harness:
          getHarnessFromEnv() ??
          (ralphConfig.harness as 'claude' | 'codex' | 'opencode' | undefined),
        onOutput,
        // Push after each commit so work is never lost
        incrementalPush: {
          enabled: true,
          branch: config.workItem.branch,
        },
      });

  console.log('Ralph completed:', result.success ? 'SUCCESS' : 'FAILED');

  if (result.success) {
    // Validate tests after Ralph completes
    console.log('Validating tests...');
    const testResult = await runTests(repoDir, {
      timeout: 5 * 60 * 1000, // 5 minutes
    });

    console.log(`Test validation: ${testResult.status}`);
    if (testResult.status === 'passed') {
      console.log(`  Tests: ${testResult.testsPassed}/${testResult.testsRun} passed`);
    } else if (testResult.status === 'failed') {
      console.log(
        `  Tests: ${testResult.testsPassed}/${testResult.testsRun} passed, ${testResult.testsFailed} failed`
      );
      console.log(`  Stderr: ${testResult.stderr.slice(0, 500)}`);
    } else if (testResult.status === 'timeout') {
      console.log(`  Tests timed out after ${testResult.duration}ms`);
    } else if (testResult.status === 'skipped') {
      console.log(`  No test script found, skipping validation`);
    } else if (testResult.status === 'error') {
      console.log(`  Test execution error: ${testResult.error}`);
    }

    // Update metrics with actual test results
    result.metrics.testsRun = testResult.testsRun;
    result.metrics.testsPassed = testResult.testsPassed;
    result.metrics.testsFailed = testResult.testsFailed;
    result.metrics.testStatus = testResult.status;

    console.log('Extracting new learnings...');
    const newLearningsPath = getNewLearningsPath(repoDir);
    const learnings = await saveLearnings(client, newLearningsPath, config.workItem.spec);
    console.log(`Found ${learnings.length} new learnings`);

    // Run AI review before creating PR
    console.log('Running AI code review...');
    let reviewFindings = await reviewPullRequest(repoDir);
    if (reviewFindings) {
      console.log('AI review completed');
      console.log(`  Spec alignment: ${reviewFindings.specAlignment.score}`);
      console.log(`  Code quality: ${reviewFindings.codeQuality.score}`);

      // If there are actionable issues, run fix agent
      if (hasActionableIssues(reviewFindings)) {
        console.log('Running fix agent for review issues...');
        const fixResult = await runReviewFixes(
          repoDir,
          reviewFindings,
          (getHarnessFromEnv() || ralphConfig.harness) as HarnessName | undefined
        );

        if (fixResult.applied) {
          console.log('Fix agent applied changes');

          // Re-run tests after fixes
          console.log('Re-validating tests after fixes...');
          const postFixTestResult = await runTests(repoDir, {
            timeout: 5 * 60 * 1000,
          });
          console.log(`Post-fix test validation: ${postFixTestResult.status}`);

          // Update metrics
          result.metrics.testsRun = postFixTestResult.testsRun;
          result.metrics.testsPassed = postFixTestResult.testsPassed;
          result.metrics.testsFailed = postFixTestResult.testsFailed;
          result.metrics.testStatus = postFixTestResult.status;

          // Re-review to get updated findings for PR comment
          console.log('Re-running review after fixes...');
          const updatedFindings = await reviewPullRequest(repoDir);
          if (updatedFindings) {
            reviewFindings = updatedFindings;
            console.log(`  Updated spec alignment: ${reviewFindings.specAlignment.score}`);
            console.log(`  Updated code quality: ${reviewFindings.codeQuality.score}`);
          }
        } else {
          console.log(
            `Fix agent did not apply changes: ${fixResult.error ?? 'no actionable issues'}`
          );
        }
      } else {
        console.log('No actionable issues to fix');
      }
    } else {
      console.log('AI review skipped or failed - continuing without review');
    }

    // Wrap PR creation in try/catch to handle unexpected errors and report partial success
    let prUrl: string | undefined;
    try {
      console.log('Creating pull request...');
      const prResult = await createPullRequest(
        repoDir,
        config.workItem,
        config.githubToken,
        reviewFindings ?? undefined
      );

      if (prResult.status === 'success') {
        console.log(`Pull request created: ${prResult.prUrl}`);
        prUrl = prResult.prUrl;

        // Archive spec from active to completed (ralphie v1.1 convention)
        await archiveSpec(repoDir);
      } else if (prResult.status === 'no_changes') {
        console.log('No pull request created (no changes to push)');
      } else {
        console.error(`PR creation failed at step: ${prResult.step}`);
        if (prResult.error) {
          console.error(`  Command: ${prResult.error.command}`);
          console.error(`  Exit code: ${prResult.error.exitCode}`);
          console.error(`  stdout: ${prResult.error.stdout}`);
          console.error(`  stderr: ${prResult.error.stderr}`);
        }
      }
    } catch (prError) {
      // Catch unexpected errors (network failures, gh not found, etc.)
      console.error('Unexpected error during PR creation:');
      console.error(`  Error: ${prError instanceof Error ? prError.message : String(prError)}`);
      if (prError instanceof Error && prError.stack) {
        console.error(`  Stack: ${prError.stack}`);
      }
      console.log('Work completed but PR creation failed - reporting partial success');
    }

    // Extract PR number from URL if available
    let prNumber: number | undefined;
    if (prUrl) {
      const prMatch = prUrl.match(/\/pull\/(\d+)/);
      if (prMatch?.[1]) {
        prNumber = parseInt(prMatch[1], 10);
      }
    }

    // Prepare review data if available
    const reviewData =
      reviewFindings && prNumber
        ? {
            modelUsed: process.env.AI_REVIEW_MODEL || 'claude-sonnet-4-20250514',
            findings: reviewFindings,
          }
        : undefined;

    await client.complete(
      prUrl,
      result.metrics,
      learnings,
      prNumber,
      reviewData,
      whimConfig.verification.enabled
    );
    console.log('Completion reported to orchestrator');
  } else {
    console.error('Ralph failed:', result.error);
    await client.fail(result.error ?? 'Unknown error', result.iteration);
    console.log('Failure reported to orchestrator');
  }

  console.log('Worker finished');
}

// Route to appropriate worker based on WORKER_MODE environment variable
const workerMode = process.env.WORKER_MODE || 'execution';

if (workerMode === 'verification') {
  console.log('Starting in VERIFICATION mode');
  runVerificationWorker().catch((error) => {
    console.error('Verification worker error:', error);
    process.exit(1);
  });
} else {
  console.log('Starting in EXECUTION mode');
  main().catch((error) => {
    console.error('Worker error:', error);
    process.exit(1);
  });
}
