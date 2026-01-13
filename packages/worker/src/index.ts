import type { WorkItem } from "@factory/shared";
import { OrchestratorClient } from "./client.js";
import { setupWorkspace, createPullRequest } from "./setup.js";
import {
  loadLearnings,
  saveLearnings,
  getLearningsPath,
  getNewLearningsPath,
} from "./learnings.js";
import { runRalph } from "./ralph.js";

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
    console.log("Extracting new learnings...");
    const newLearningsPath = getNewLearningsPath(repoDir);
    const learnings = await saveLearnings(
      client,
      newLearningsPath,
      config.workItem.spec
    );
    console.log(`Found ${learnings.length} new learnings`);

    console.log("Creating pull request...");
    const prUrl = await createPullRequest(
      repoDir,
      config.workItem,
      config.githubToken
    );

    if (prUrl) {
      console.log(`Pull request created: ${prUrl}`);
    } else {
      console.log("No pull request created (no changes or error)");
    }

    await client.complete(prUrl ?? undefined, result.metrics, learnings);
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
