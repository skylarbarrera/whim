import type { WorkItem } from "@factory/shared";
import { OrchestratorClient } from "./client.js";
import { setupWorkspace, createPullRequest, PRStep, verifyGitAuth } from "./setup.js";
import {
  loadLearnings,
  saveLearnings,
  getLearningsPath,
  getNewLearningsPath,
} from "./learnings.js";
import { runRalph } from "./ralph.js";
import { runMockRalph } from "./mock-ralph.js";
import { runTests } from "./testing.js";

interface WorkerConfig {
  orchestratorUrl: string;
  workerId: string;
  workItem: WorkItem;
  githubToken: string;
  workDir: string;
  claudeConfigDir?: string;
}

function getConfig(): WorkerConfig {
  const orchestratorUrl = process.env.ORCHESTRATOR_URL;
  if (!orchestratorUrl) {
    throw new Error("ORCHESTRATOR_URL environment variable is required");
  }

  const workerId = process.env.WORKER_ID;
  if (!workerId) {
    throw new Error("WORKER_ID environment variable is required");
  }

  const workItemJson = process.env.WORK_ITEM;
  if (!workItemJson) {
    throw new Error("WORK_ITEM environment variable is required");
  }

  let workItem: WorkItem;
  try {
    workItem = JSON.parse(workItemJson);
  } catch {
    throw new Error("WORK_ITEM must be valid JSON");
  }

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error("GITHUB_TOKEN environment variable is required");
  }

  const workDir = process.env.WORK_DIR ?? "/workspace";
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR;

  return {
    orchestratorUrl,
    workerId,
    workItem,
    githubToken,
    workDir,
    claudeConfigDir,
  };
}

async function main(): Promise<void> {
  console.log("Worker starting...");

  const config = getConfig();
  console.log(`Worker ID: ${config.workerId}`);
  console.log(`Work Item: ${config.workItem.id}`);
  console.log(`Repo: ${config.workItem.repo}`);
  console.log(`Branch: ${config.workItem.branch}`);

  const client = new OrchestratorClient({
    baseUrl: config.orchestratorUrl,
    workerId: config.workerId,
  });

  console.log("Setting up workspace...");
  const repoDir = await setupWorkspace(config.workItem, {
    workDir: config.workDir,
    githubToken: config.githubToken,
    claudeConfigDir: config.claudeConfigDir,
  });
  console.log(`Workspace ready at: ${repoDir}`);

  // Verify git push access BEFORE doing any work
  console.log("Verifying git push access...");
  const authResult = await verifyGitAuth(repoDir, config.githubToken);
  if (!authResult.success) {
    console.error("Git auth verification failed:", authResult.error);
    await client.fail(`Git auth failed: ${authResult.error}`, 0);
    console.log("Failure reported to orchestrator");
    return;
  }
  console.log("Git push access verified");

  console.log("Loading learnings...");
  const learningsPath = getLearningsPath(repoDir);
  await loadLearnings(client, config.workItem.repo, learningsPath);
  console.log("Learnings loaded");

  // Use mock Ralph for testing lifecycle without burning Claude tokens
  const useMock = process.env.MOCK_RALPH === "1" || process.env.MOCK_RALPH === "true";

  if (useMock) {
    console.log("Starting Mock Ralph (MOCK_RALPH=1)...");
  } else {
    console.log("Starting Ralph...");
  }

  const onOutput = (line: string) => {
    console.log(line);
  };

  const result = useMock
    ? await runMockRalph(repoDir, client, {
        toolDelay: 200,
        toolCount: 15,
        totalDuration: 3000,
        shouldSucceed: process.env.MOCK_FAIL !== "1",
        shouldGetStuck: process.env.MOCK_STUCK === "1",
        onOutput,
      })
    : await runRalph(repoDir, client, {
        maxIterations: config.workItem.maxIterations,
        onOutput,
        // Push after each commit so work is never lost
        incrementalPush: {
          enabled: true,
          branch: config.workItem.branch,
        },
      });

  console.log("Ralph completed:", result.success ? "SUCCESS" : "FAILED");

  if (result.success) {
    // Validate tests after Ralph completes
    console.log("Validating tests...");
    const testResult = await runTests(repoDir, {
      timeout: 5 * 60 * 1000, // 5 minutes
    });

    console.log(`Test validation: ${testResult.status}`);
    if (testResult.status === "passed") {
      console.log(`  Tests: ${testResult.testsPassed}/${testResult.testsRun} passed`);
    } else if (testResult.status === "failed") {
      console.log(`  Tests: ${testResult.testsPassed}/${testResult.testsRun} passed, ${testResult.testsFailed} failed`);
      console.log(`  Stderr: ${testResult.stderr.slice(0, 500)}`);
    } else if (testResult.status === "timeout") {
      console.log(`  Tests timed out after ${testResult.duration}ms`);
    } else if (testResult.status === "skipped") {
      console.log(`  No test script found, skipping validation`);
    } else if (testResult.status === "error") {
      console.log(`  Test execution error: ${testResult.error}`);
    }

    // Update metrics with actual test results
    result.metrics.testsRun = testResult.testsRun;
    result.metrics.testsPassed = testResult.testsPassed;
    result.metrics.testsFailed = testResult.testsFailed;
    result.metrics.testStatus = testResult.status;

    console.log("Extracting new learnings...");
    const newLearningsPath = getNewLearningsPath(repoDir);
    const learnings = await saveLearnings(
      client,
      newLearningsPath,
      config.workItem.spec
    );
    console.log(`Found ${learnings.length} new learnings`);

    // Wrap PR creation in try/catch to handle unexpected errors and report partial success
    let prUrl: string | undefined;
    try {
      console.log("Creating pull request...");
      const prResult = await createPullRequest(
        repoDir,
        config.workItem,
        config.githubToken
      );

      if (prResult.status === "success") {
        console.log(`Pull request created: ${prResult.prUrl}`);
        prUrl = prResult.prUrl;
      } else if (prResult.status === "no_changes") {
        console.log("No pull request created (no changes to push)");
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
      console.error("Unexpected error during PR creation:");
      console.error(`  Error: ${prError instanceof Error ? prError.message : String(prError)}`);
      if (prError instanceof Error && prError.stack) {
        console.error(`  Stack: ${prError.stack}`);
      }
      console.log("Work completed but PR creation failed - reporting partial success");
    }

    await client.complete(prUrl, result.metrics, learnings);
    console.log("Completion reported to orchestrator");
  } else {
    console.error("Ralph failed:", result.error);
    await client.fail(result.error ?? "Unknown error", result.iteration);
    console.log("Failure reported to orchestrator");
  }

  console.log("Worker finished");
}

main().catch((error) => {
  console.error("Worker error:", error);
  process.exit(1);
});
