import type { AddWorkItemRequest, AddWorkItemResponse } from "@factory/shared";
import { GitHubAdapter, type GitHubIssue } from "./github.js";
import { SpecGenerator, type GeneratedSpec } from "./spec-gen.js";

interface IntakeConfig {
  githubToken: string;
  anthropicApiKey: string;
  repos: string[];
  orchestratorUrl: string;
  intakeLabel: string;
  pollInterval: number;
}

function loadConfig(): IntakeConfig {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) throw new Error("GITHUB_TOKEN required");

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) throw new Error("ANTHROPIC_API_KEY required");

  const reposEnv = process.env.REPOS;
  if (!reposEnv) throw new Error("REPOS required (comma-separated owner/repo)");

  return {
    githubToken,
    anthropicApiKey,
    repos: reposEnv.split(",").map((r) => r.trim()),
    orchestratorUrl:
      process.env.ORCHESTRATOR_URL ?? "http://orchestrator:3000",
    intakeLabel: process.env.INTAKE_LABEL ?? "ai-factory",
    pollInterval: parseInt(process.env.POLL_INTERVAL ?? "60000", 10),
  };
}

async function submitToOrchestrator(
  orchestratorUrl: string,
  issue: GitHubIssue,
  spec: GeneratedSpec
): Promise<AddWorkItemResponse> {
  const request: AddWorkItemRequest = {
    repo: `${issue.owner}/${issue.repo}`,
    branch: spec.branch,
    spec: spec.spec,
    priority: "medium",
    metadata: {
      issueNumber: issue.number,
      issueUrl: issue.url,
      issueTitle: issue.title,
      generatedAt: spec.metadata.generatedAt,
    },
  };

  const response = await fetch(`${orchestratorUrl}/api/work`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to submit work item: ${response.status} ${error}`);
  }

  return response.json() as Promise<AddWorkItemResponse>;
}

async function processIssue(
  github: GitHubAdapter,
  specGen: SpecGenerator,
  orchestratorUrl: string,
  issue: GitHubIssue
): Promise<void> {
  console.log(
    `Processing issue #${issue.number}: ${issue.title} (${issue.owner}/${issue.repo})`
  );

  try {
    // Mark as processing to prevent duplicate pickup
    await github.markProcessing(issue);

    // Generate spec from issue
    console.log(`Generating spec for issue #${issue.number}...`);
    const spec = await specGen.generate(issue);
    console.log(`Generated spec for branch: ${spec.branch}`);

    // Submit to orchestrator
    console.log(`Submitting work item to orchestrator...`);
    const result = await submitToOrchestrator(orchestratorUrl, issue, spec);
    console.log(`Work item created: ${result.id} (status: ${result.status})`);
  } catch (error) {
    console.error(`Failed to process issue #${issue.number}:`, error);
    // Remove processing label so it can be retried
    await github.markFailed(issue);
    throw error;
  }
}

async function poll(
  github: GitHubAdapter,
  specGen: SpecGenerator,
  orchestratorUrl: string
): Promise<number> {
  console.log("Polling for issues...");
  const issues = await github.poll();
  console.log(`Found ${issues.length} issues to process`);

  let processed = 0;
  for (const issue of issues) {
    try {
      await processIssue(github, specGen, orchestratorUrl, issue);
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

  const specGen = new SpecGenerator({
    apiKey: config.anthropicApiKey,
  });

  // Initial poll
  await poll(github, specGen, config.orchestratorUrl);

  // Set up recurring poll
  setInterval(async () => {
    try {
      await poll(github, specGen, config.orchestratorUrl);
    } catch (error) {
      console.error("Poll failed:", error);
    }
  }, config.pollInterval);

  console.log("Intake service running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

export { GitHubAdapter, SpecGenerator };
export type { IntakeConfig, GitHubIssue, GeneratedSpec };
