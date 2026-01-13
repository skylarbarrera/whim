import type { WorkItem } from "@factory/shared";
import { OrchestratorClient } from "./client.js";
import { setupWorkspace, createPullRequest, PRStep } from "./setup.js";
import {
  loadLearnings,
  saveLearnings,
  getLearningsPath,
  getNewLearningsPath,
} from "./learnings.js";
import { runRalph } from "./ralph.js";
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

  console.log("Loading learnings...");
  const learningsPath = getLearningsPath(repoDir);
  await loadLearnings(client, config.workItem.repo, learningsPath);
  console.log("Learnings loaded");

  console.log("Starting Ralph...");
  const result = await runRalph(repoDir, client, {
    maxIterations: config.workItem.maxIterations,
    onEvent: (event) => {
      console.log(`[RALPH:${event.type}]`, event.data);
    },
    onOutput: (line) => {
      console.log(line);
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

    console.log("Extracting new learnings...");
    const newLearningsPath = getNewLearningsPath(repoDir);
    const learnings = await saveLearnings(
      client,
      newLearningsPath,
      config.workItem.spec
    );
    console.log(`Found ${learnings.length} new learnings`);

    console.log("Creating pull request...");
    const prResult = await createPullRequest(
      repoDir,
      config.workItem,
      config.githubToken
    );

    if (prResult.status === "success") {
      console.log(`Pull request created: ${prResult.prUrl}`);
    } else if (prResult.status === "no_changes") {
      console.log("No pull request created (no changes to push)");
    } else {
      console.error(`PR creation failed at step: ${prResult.step}`);
      if (prResult.error) {
        console.error(`  Command: ${prResult.error.command}`);
        console.error(`  Exit code: ${prResult.error.exitCode}`);
      }
    }

    await client.complete(prResult.prUrl, result.metrics, learnings);
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
