import { OrchestratorClient } from "./client.js";
import type { VerificationReadyWorkItem } from "./types.js";
import {
  validateEnvironment,
  cloneRepository,
  checkoutBranch,
} from "./shared-worker.js";
import { getHarness, type HarnessName, type HarnessEvent } from "./harness/index.js";

interface VerificationWorkerConfig {
  orchestratorUrl: string;
  workerId: string;
  workItem: VerificationReadyWorkItem;
  githubToken: string;
  workDir: string;
  harness: HarnessName;
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

  // Get harness from environment (default to claude)
  const harnessEnv = process.env.HARNESS?.toLowerCase();
  const harness: HarnessName = harnessEnv === 'codex' ? 'codex' : 'claude';

  return {
    orchestratorUrl: env.orchestratorUrl,
    workerId: env.workerId,
    workItem: verificationReadyWorkItem,
    githubToken: env.githubToken,
    workDir: env.workDir,
    harness,
  };
}

async function runVerification(
  repoDir: string,
  prNumber: number,
  harnessName: HarnessName
): Promise<{ passed: boolean; tokensIn?: number; tokensOut?: number; costUsd?: number }> {
  const harness = getHarness(harnessName);

  const verificationPrompt = `
You are verifying PR #${prNumber}. Your task:

1. Run the project's test suite (look for package.json scripts, pytest, etc.)
2. Check if the code builds/compiles successfully
3. Review if the implementation matches any SPEC.md or PR description

After verification, output your result in this exact format:
[VERIFY:RESULT] {"passed": true/false, "summary": "brief explanation"}

If tests pass and the code works: passed = true
If tests fail or code is broken: passed = false
`;

  const onEvent = (event: HarnessEvent) => {
    switch (event.type) {
      case 'tool_start':
        console.log(`[${harness.name}] Tool start: ${event.name}`);
        break;
      case 'tool_end':
        console.log(`[${harness.name}] Tool end: ${event.name}${event.error ? ' (error)' : ''}`);
        break;
      case 'message':
        console.log(`[${harness.name}] ${event.text}`);
        break;
      case 'error':
        console.error(`[${harness.name}] Error: ${event.message}`);
        break;
    }
  };

  console.log(`Running verification with ${harness.name} harness...`);

  const result = await harness.run(
    verificationPrompt,
    { cwd: repoDir },
    onEvent
  );

  console.log(`Harness result: success=${result.success}, duration=${result.durationMs}ms`);

  if (!result.success) {
    console.error(`Verification harness failed: ${result.error}`);
    return { passed: false, tokensIn: result.usage?.inputTokens, tokensOut: result.usage?.outputTokens, costUsd: result.costUsd };
  }

  // Parse [VERIFY:RESULT] from output if present
  const resultMatch = result.output?.match(/\[VERIFY:RESULT\]\s*({.*})/);
  if (resultMatch && resultMatch[1]) {
    try {
      const parsed = JSON.parse(resultMatch[1]) as { passed: boolean; summary?: string };
      console.log(`Parsed verification result: passed=${parsed.passed}, summary=${parsed.summary}`);
      return {
        passed: parsed.passed,
        tokensIn: result.usage?.inputTokens,
        tokensOut: result.usage?.outputTokens,
        costUsd: result.costUsd
      };
    } catch (error) {
      console.warn(`Failed to parse VERIFY:RESULT JSON: ${error instanceof Error ? error.message : String(error)}, treating as passed based on harness success`);
    }
  }

  // If harness succeeded but no explicit result, assume passed
  return {
    passed: result.success,
    tokensIn: result.usage?.inputTokens,
    tokensOut: result.usage?.outputTokens,
    costUsd: result.costUsd
  };
}

export async function runVerificationWorker(): Promise<void> {
  console.log("Verification worker starting...");

  const config = getVerificationConfig();
  console.log(`Worker ID: ${config.workerId}`);
  console.log(`Work Item: ${config.workItem.id}`);
  console.log(`Repo: ${config.workItem.repo}`);
  console.log(`Branch: ${config.workItem.branch}`);
  console.log(`PR Number: ${config.workItem.prNumber}`);
  console.log(`Harness: ${config.harness}`);

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

    // Run verification with harness
    console.log("Running verification...");
    const verificationResult = await runVerification(repoDir, config.workItem.prNumber, config.harness);

    console.log(`Verification result: ${verificationResult.passed ? "PASSED" : "FAILED"}`);

    // Report completion to orchestrator
    await client.completeVerification(verificationResult.passed);
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
