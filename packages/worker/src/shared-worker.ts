import type { WorkItem } from "@whim/shared";
import { mkdir } from "fs/promises";
import { join } from "path";
import { spawn } from "child_process";

/**
 * Validated environment variables required by all workers
 */
export interface WorkerEnvironment {
  orchestratorUrl: string;
  workerId: string;
  workItem: WorkItem;
  githubToken: string;
  workDir: string;
}

/**
 * Validate and extract required environment variables for all worker types
 * @throws Error if any required environment variable is missing or invalid
 */
export function validateEnvironment(): WorkerEnvironment {
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
  } catch (error) {
    throw new Error(`WORK_ITEM must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error("GITHUB_TOKEN environment variable is required");
  }

  const workDir = process.env.WORK_DIR ?? "/workspace";

  return {
    orchestratorUrl,
    workerId,
    workItem,
    githubToken,
    workDir,
  };
}

/**
 * Execute a command and return stdout, stderr, and exit code
 */
export function exec(
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

/**
 * Clone a GitHub repository using authenticated HTTPS
 * @param repo Repository in format "owner/repo"
 * @param token GitHub personal access token
 * @param workDir Working directory to clone into
 * @returns Path to the cloned repository
 * @throws Error if clone fails
 */
export async function cloneRepository(
  repo: string,
  token: string,
  workDir: string
): Promise<string> {
  const repoDir = join(workDir, "repo");

  await mkdir(workDir, { recursive: true });

  // Clone the repository using authenticated HTTPS URL
  const repoUrl = `https://x-access-token:${token}@github.com/${repo}.git`;
  const cloneArgs = ["clone", repoUrl, repoDir];
  const cloneResult = await exec("git", cloneArgs);

  if (cloneResult.code !== 0) {
    throw new Error(`Failed to clone repo ${repo}: ${cloneResult.stderr}`);
  }

  return repoDir;
}

/**
 * Checkout a specific branch in a git repository
 * @param repoDir Path to git repository
 * @param branch Branch name to checkout
 * @throws Error if checkout fails
 */
export async function checkoutBranch(repoDir: string, branch: string): Promise<void> {
  const checkoutArgs = ["checkout", branch];
  const checkoutResult = await exec("git", checkoutArgs, { cwd: repoDir });

  if (checkoutResult.code !== 0) {
    throw new Error(`Failed to checkout branch ${branch}: ${checkoutResult.stderr}`);
  }
}
