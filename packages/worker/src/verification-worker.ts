import { OrchestratorClient } from "./client.js";
import type { VerificationReadyWorkItem } from "./types.js";
import {
  validateEnvironment,
  cloneRepository,
  checkoutBranch,
  exec,
} from "./shared-worker.js";

interface VerificationWorkerConfig {
  orchestratorUrl: string;
  workerId: string;
  workItem: VerificationReadyWorkItem;
  githubToken: string;
  workDir: string;
}

function getVerificationConfig(): VerificationWorkerConfig {
  const env = validateEnvironment();

  // Validate verification-ready fields
  if (!env.workItem.branch) {
    throw new Error("Work item must have a branch for verification (branch is null/undefined)");
  }
  if (env.workItem.prNumber === null || env.workItem.prNumber === undefined) {
    throw new Error("Work item must have a prNumber for verification (prNumber is null/undefined)");
  }

  // Type narrowing: we've validated branch and prNumber are present
  const verificationReadyWorkItem: VerificationReadyWorkItem = {
    ...env.workItem,
    branch: env.workItem.branch,
    prNumber: env.workItem.prNumber,
  };

  return {
    orchestratorUrl: env.orchestratorUrl,
    workerId: env.workerId,
    workItem: verificationReadyWorkItem,
    githubToken: env.githubToken,
    workDir: env.workDir,
  };
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
    // Clone repository
    console.log("Cloning repository...");
    const repoDir = await cloneRepository(
      config.workItem.repo,
      config.githubToken,
      config.workDir
    );
    console.log(`Repository cloned to: ${repoDir}`);

    // Checkout the PR branch
    console.log(`Checking out branch: ${config.workItem.branch}`);
    await checkoutBranch(repoDir, config.workItem.branch);
    console.log(`Branch checked out successfully`);

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
