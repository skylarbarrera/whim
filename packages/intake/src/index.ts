import type { AddWorkItemRequest, AddWorkItemResponse, WorkItem } from "@whim/shared";
import { GitHubAdapter, type GitHubIssue } from "./github.js";

interface IntakeConfig {
  githubToken: string;
  repos: string[];
  orchestratorUrl: string;
  intakeLabel: string;
  pollInterval: number;
}

function loadConfig(): IntakeConfig {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) throw new Error("GITHUB_TOKEN required");

  const reposEnv = process.env.REPOS;
  if (!reposEnv) throw new Error("REPOS required (comma-separated owner/repo)");

  return {
    githubToken,
    repos: reposEnv.split(",").map((r) => r.trim()),
    orchestratorUrl:
      process.env.ORCHESTRATOR_URL ?? "http://orchestrator:3000",
    intakeLabel: process.env.INTAKE_LABEL ?? "whim",
    pollInterval: parseInt(process.env.POLL_INTERVAL ?? "60000", 10),
  };
}

const ORCHESTRATOR_TIMEOUT_MS = parseInt(
  process.env.ORCHESTRATOR_TIMEOUT_MS ?? "30000",
  10
);

const SPEC_GEN_POLL_INTERVAL_MS = parseInt(
  process.env.SPEC_GEN_POLL_INTERVAL_MS ?? "5000",
  10
);

const SPEC_GEN_TIMEOUT_MS = parseInt(
  process.env.SPEC_GEN_TIMEOUT_MS ?? "600000", // 10 minutes
  10
);

/**
 * Submit a work item with description (triggers async spec generation)
 */
async function submitToOrchestrator(
  orchestratorUrl: string,
  issue: GitHubIssue
): Promise<AddWorkItemResponse> {
  const description = `# ${issue.title}\n\n${issue.body ?? "No description provided"}`;

  const request: AddWorkItemRequest = {
    repo: `${issue.owner}/${issue.repo}`,
    description,
    source: "github",
    sourceRef: `issue:${issue.number}`,
    priority: "medium",
    metadata: {
      issueNumber: issue.number,
      issueUrl: issue.url,
      issueTitle: issue.title,
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ORCHESTRATOR_TIMEOUT_MS);

  try {
    const response = await fetch(`${orchestratorUrl}/api/work`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to submit work item: ${response.status} ${error}`);
    }

    return response.json() as Promise<AddWorkItemResponse>;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Orchestrator request timed out after ${ORCHESTRATOR_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Poll work item status until spec generation completes
 */
async function pollWorkItemStatus(
  orchestratorUrl: string,
  workItemId: string
): Promise<WorkItem> {
  const startTime = Date.now();

  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= SPEC_GEN_TIMEOUT_MS) {
      throw new Error(`Spec generation timed out after ${SPEC_GEN_TIMEOUT_MS}ms`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ORCHESTRATOR_TIMEOUT_MS);

    try {
      const response = await fetch(`${orchestratorUrl}/api/work/${workItemId}`, {
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to get work item status: ${response.status} ${error}`);
      }

      const workItem = (await response.json()) as WorkItem;

      // Check status
      if (workItem.status === "queued" || workItem.status === "assigned" || workItem.status === "in_progress") {
        // Spec generation complete, work item is ready
        return workItem;
      }

      if (workItem.status === "failed") {
        throw new Error(`Spec generation failed: ${workItem.error ?? "Unknown error"}`);
      }

      if (workItem.status === "generating") {
        // Still generating, wait and poll again
        await new Promise((resolve) => setTimeout(resolve, SPEC_GEN_POLL_INTERVAL_MS));
        continue;
      }

      // Unexpected status
      throw new Error(`Unexpected work item status: ${workItem.status}`);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Status check timed out after ${ORCHESTRATOR_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

async function processIssue(
  github: GitHubAdapter,
  orchestratorUrl: string,
  issue: GitHubIssue
): Promise<void> {
  console.log(
    `Processing issue #${issue.number}: ${issue.title} (${issue.owner}/${issue.repo})`
  );

  try {
    // Mark as processing to prevent duplicate pickup
    await github.markProcessing(issue);

    // Submit to orchestrator (triggers async spec generation)
    console.log(`Submitting work item to orchestrator...`);
    const result = await submitToOrchestrator(orchestratorUrl, issue);
    console.log(`Work item created: ${result.id} (status: ${result.status})`);

    // Poll until spec generation completes
    console.log(`Waiting for spec generation to complete...`);
    const workItem = await pollWorkItemStatus(orchestratorUrl, result.id);
    console.log(`Spec generation complete for branch: ${workItem.branch}`);
    console.log(`Work item now ${workItem.status} and ready for execution`);
  } catch (error) {
    console.error(`Failed to process issue #${issue.number}:`, error);

    // Post error comment to GitHub
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown error occurred";
    await github.postComment(
      issue.owner,
      issue.repo,
      issue.number,
      `❌ Failed to process issue: ${errorMessage}\n\nPlease check the logs for more details.`
    );

    // Remove processing label so it can be retried
    await github.markFailed(issue);
    throw error;
  }
}

async function poll(
  github: GitHubAdapter,
  orchestratorUrl: string
): Promise<number> {
  console.log("Polling for issues...");
  const issues = await github.poll();
  console.log(`Found ${issues.length} issues to process`);

  let processed = 0;
  for (const issue of issues) {
    try {
      await processIssue(github, orchestratorUrl, issue);
      processed++;
    } catch {
      // Error already logged, continue to next issue
    }
  }

  return processed;
}

async function main(): Promise<void> {
  console.log("Starting intake service...");

  const config = loadConfig();
  console.log(`Watching repos: ${config.repos.join(", ")}`);
  console.log(`Intake label: ${config.intakeLabel}`);
  console.log(`Poll interval: ${config.pollInterval}ms`);

  const github = new GitHubAdapter({
    token: config.githubToken,
    repos: config.repos,
    intakeLabel: config.intakeLabel,
  });

  // Initial poll
  await poll(github, config.orchestratorUrl);

  // Set up recurring poll with overlap guard
  let polling = false;
  const pollIntervalId = setInterval(async () => {
    if (polling) {
      console.log("Previous poll still running, skipping this interval");
      return;
    }
    polling = true;
    try {
      await poll(github, config.orchestratorUrl);
    } catch (error) {
      console.error("Poll failed:", error);
    } finally {
      polling = false;
    }
  }, config.pollInterval);

  // Graceful shutdown handler
  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    clearInterval(pollIntervalId);
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  console.log("Intake service running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

export { GitHubAdapter };
export type { IntakeConfig, GitHubIssue };
