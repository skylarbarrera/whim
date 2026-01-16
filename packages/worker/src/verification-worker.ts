import type { WorkItem } from "@whim/shared";
import { OrchestratorClient } from "./client.js";
import type { VerificationReadyWorkItem } from "./types.js";
import { mkdir } from "fs/promises";
import { join } from "path";
import { spawn } from "child_process";

/**
 * Execute a command and return stdout, stderr, and exit code
 */
function exec(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

interface VerificationWorkerConfig {
  orchestratorUrl: string;
  workerId: string;
  workItem: VerificationReadyWorkItem;
  githubToken: string;
  workDir: string;
}

function getVerificationConfig(): VerificationWorkerConfig {
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

  // Validate verification-ready fields
  if (!workItem.branch) {
    throw new Error("Work item must have a branch for verification (branch is null/undefined)");
  }
  if (workItem.prNumber === null || workItem.prNumber === undefined) {
    throw new Error("Work item must have a prNumber for verification (prNumber is null/undefined)");
  }

  // Type narrowing: we've validated branch and prNumber are present
  const verificationReadyWorkItem: VerificationReadyWorkItem = {
    ...workItem,
    branch: workItem.branch,
    prNumber: workItem.prNumber,
  };

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error("GITHUB_TOKEN environment variable is required");
  }

  const workDir = process.env.WORK_DIR ?? "/workspace";

  return {
    orchestratorUrl,
    workerId,
    workItem: verificationReadyWorkItem,
    githubToken,
    workDir,
  };
}

async function cloneAndCheckout(
  repo: string,
  branch: string,
  githubToken: string,
  workDir: string
): Promise<string> {
  const repoDir = join(workDir, "repo");

  await mkdir(workDir, { recursive: true });

  // Clone the repository
  const repoUrl = `https://x-access-token:${githubToken}@github.com/${repo}.git`;
  const cloneArgs = ["clone", repoUrl, repoDir];
  const cloneResult = await exec("git", cloneArgs);

  if (cloneResult.code !== 0) {
    throw new Error(`Failed to clone repo: ${cloneResult.stderr}`);
  }

  // Checkout the PR branch
  const checkoutArgs = ["checkout", branch];
  const checkoutResult = await exec("git", checkoutArgs, { cwd: repoDir });

  if (checkoutResult.code !== 0) {
    throw new Error(`Failed to checkout branch ${branch}: ${checkoutResult.stderr}`);
  }

  return repoDir;
}

async function runWhimVerify(repoDir: string, prNumber: number): Promise<boolean> {
  // Run whim verify with --pr flag
  // Exit code 0 = pass, 1 = fail
  const verifyResult = await exec("whim", ["verify", "--pr", String(prNumber)], { cwd: repoDir });

  console.log(`whim verify exit code: ${verifyResult.code}`);
  if (verifyResult.stdout) {
    console.log(`stdout: ${verifyResult.stdout}`);
  }
  if (verifyResult.stderr) {
    console.log(`stderr: ${verifyResult.stderr}`);
  }

  return verifyResult.code === 0;
}

export async function runVerificationWorker(): Promise<void> {
  console.log("Verification worker starting...");

  const config = getVerificationConfig();
  console.log(`Worker ID: ${config.workerId}`);
  console.log(`Work Item: ${config.workItem.id}`);
  console.log(`Repo: ${config.workItem.repo}`);
  console.log(`Branch: ${config.workItem.branch}`);
  console.log(`PR Number: ${config.workItem.prNumber}`);

  const client = new OrchestratorClient({
    baseUrl: config.orchestratorUrl,
    workerId: config.workerId,
    repo: config.workItem.repo,
  });

  try {
    // Clone repo and checkout the PR branch
    console.log("Cloning repository and checking out branch...");
    const repoDir = await cloneAndCheckout(
      config.workItem.repo,
      config.workItem.branch,
      config.githubToken,
      config.workDir
    );
    console.log(`Repository ready at: ${repoDir}`);

    // Run whim verify
    console.log("Running whim verify...");
    const verificationPassed = await runWhimVerify(repoDir, config.workItem.prNumber);

    console.log(`Verification result: ${verificationPassed ? "PASSED" : "FAILED"}`);

    // Report completion to orchestrator
    await client.completeVerification(verificationPassed);
    console.log("Verification completion reported to orchestrator");
  } catch (error) {
    console.error("Verification worker error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    await client.fail(errorMessage, 0);
    console.log("Failure reported to orchestrator");
    throw error;
  }

  console.log("Verification worker finished");
}
