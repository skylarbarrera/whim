import { spawn } from "node:child_process";
import { mkdir, writeFile, access, cp } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { WorkItem } from "@factory/shared";

export interface WorkspaceConfig {
  workDir: string;
  githubToken: string;
  claudeConfigDir?: string;
}

/**
 * Steps in the PR creation flow for error tracking
 */
export enum PRStep {
  STAGE = "stage",
  COMMIT = "commit",
  CHECK_UNPUSHED = "check_unpushed",
  PUSH = "push",
  CREATE_PR = "create_pr",
}

/**
 * Detailed error information from a failed PR step
 */
export interface PRError {
  step: PRStep;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Result of PR creation attempt with detailed status
 */
export interface PRResult {
  status: "success" | "no_changes" | "error";
  step: PRStep;
  prUrl?: string;
  error?: PRError;
}

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

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function setupWorkspace(
  workItem: WorkItem,
  config: WorkspaceConfig
): Promise<string> {
  const repoDir = join(config.workDir, "repo");

  await mkdir(config.workDir, { recursive: true });

  const repoUrl = `https://x-access-token:${config.githubToken}@github.com/${workItem.repo}.git`;
  const cloneResult = await exec("git", [
    "clone",
    "--depth",
    "1",
    repoUrl,
    repoDir,
  ]);

  if (cloneResult.code !== 0) {
    throw new Error(`Failed to clone repo: ${cloneResult.stderr}`);
  }

  const checkoutResult = await exec(
    "git",
    ["checkout", "-b", workItem.branch],
    { cwd: repoDir }
  );

  if (checkoutResult.code !== 0) {
    throw new Error(`Failed to create branch: ${checkoutResult.stderr}`);
  }

  await configureGit(repoDir);

  const specPath = join(repoDir, "SPEC.md");
  await writeFile(specPath, workItem.spec, "utf-8");

  if (config.claudeConfigDir) {
    const destClaudeDir = join(repoDir, ".claude");
    await copyClaudeConfig(config.claudeConfigDir, destClaudeDir);
  }

  // Initialize Ralph (creates .claude/ralph.md and .ai/ralph/)
  const initResult = await exec("ralph", ["init"], { cwd: repoDir });
  if (initResult.code !== 0) {
    console.warn("Ralph init warning:", initResult.stderr);
  }

  // Commit the initial setup so Ralph doesn't complain about uncommitted changes
  await exec("git", ["add", "-A"], { cwd: repoDir });
  await exec("git", ["commit", "-m", "chore: initialize workspace for AI Factory"], { cwd: repoDir });

  return repoDir;
}

async function configureGit(repoDir: string): Promise<void> {
  await exec("git", ["config", "user.email", "factory@ai.local"], {
    cwd: repoDir,
  });
  await exec("git", ["config", "user.name", "AI Factory Worker"], {
    cwd: repoDir,
  });
}

async function copyClaudeConfig(
  sourceDir: string,
  destDir: string
): Promise<void> {
  if (!(await fileExists(sourceDir))) {
    return;
  }

  await mkdir(destDir, { recursive: true });

  const filesToCopy = ["CLAUDE.md", "mcp.json", "settings.json"];

  for (const file of filesToCopy) {
    const sourcePath = join(sourceDir, file);
    const destPath = join(destDir, file);

    if (await fileExists(sourcePath)) {
      await cp(sourcePath, destPath);
    }
  }
}

/**
 * Log detailed command failure information
 */
function logCommandFailure(
  step: PRStep,
  command: string,
  args: string[],
  result: { stdout: string; stderr: string; code: number }
): void {
  const fullCommand = `${command} ${args.join(" ")}`;
  console.error(`[PR] Step ${step} FAILED`);
  console.error(`[PR]   Command: ${fullCommand}`);
  console.error(`[PR]   Exit code: ${result.code}`);
  if (result.stdout.trim()) {
    console.error(`[PR]   stdout: ${result.stdout.trim()}`);
  }
  if (result.stderr.trim()) {
    console.error(`[PR]   stderr: ${result.stderr.trim()}`);
  }
}

/**
 * Create a PRError from a command result
 */
function createPRError(
  step: PRStep,
  command: string,
  args: string[],
  result: { stdout: string; stderr: string; code: number }
): PRError {
  return {
    step,
    command: `${command} ${args.join(" ")}`,
    exitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function createPullRequest(
  repoDir: string,
  workItem: WorkItem,
  githubToken: string
): Promise<PRResult> {
  console.log("[PR] Starting PR creation for branch:", workItem.branch);

  // Step 1: Stage any uncommitted changes (Ralph may have left some)
  console.log("[PR] Step 1/5: Staging changes...");
  const addArgs = ["add", "-A"];
  const addResult = await exec("git", addArgs, { cwd: repoDir });
  if (addResult.code !== 0) {
    logCommandFailure(PRStep.STAGE, "git", addArgs, addResult);
    return {
      status: "error",
      step: PRStep.STAGE,
      error: createPRError(PRStep.STAGE, "git", addArgs, addResult),
    };
  }
  console.log("[PR] Step 1/5: Staging complete");

  // Step 2: Check for uncommitted changes and commit if present
  console.log("[PR] Step 2/5: Checking for uncommitted changes...");
  const statusResult = await exec("git", ["status", "--porcelain"], {
    cwd: repoDir,
  });
  if (statusResult.stdout.trim() !== "") {
    console.log("[PR] Found uncommitted changes, committing...");
    const commitArgs = ["commit", "-m", `feat: ${workItem.branch}\n\nImplemented by AI Factory`];
    const commitResult = await exec("git", commitArgs, { cwd: repoDir });

    if (commitResult.code !== 0) {
      logCommandFailure(PRStep.COMMIT, "git", commitArgs, commitResult);
      return {
        status: "error",
        step: PRStep.COMMIT,
        error: createPRError(PRStep.COMMIT, "git", commitArgs, commitResult),
      };
    }
    console.log("[PR] Step 2/5: Committed successfully");
  } else {
    console.log("[PR] Step 2/5: No uncommitted changes (Ralph already committed)");
  }

  // Step 3: Check for unpushed commits
  console.log("[PR] Step 3/5: Checking for unpushed commits...");
  // Use origin/HEAD if available, otherwise try origin/main or origin/master
  let unpushedCount = 0;
  const refs = ["origin/HEAD", "origin/main", "origin/master"];

  for (const ref of refs) {
    const unpushedResult = await exec(
      "git",
      ["rev-list", "--count", `${ref}..HEAD`],
      { cwd: repoDir }
    );
    if (unpushedResult.code === 0) {
      unpushedCount = parseInt(unpushedResult.stdout.trim(), 10) || 0;
      console.log(`[PR] Found ${unpushedCount} unpushed commits (vs ${ref})`);
      break;
    }
  }

  // Also check git log to show what commits exist
  const logResult = await exec(
    "git",
    ["log", "--oneline", "-5"],
    { cwd: repoDir }
  );
  console.log("[PR] Recent commits:\n" + logResult.stdout);

  if (unpushedCount === 0) {
    // Fallback: check if branch exists on remote
    const branchCheckResult = await exec(
      "git",
      ["ls-remote", "--heads", "origin", workItem.branch],
      { cwd: repoDir }
    );
    if (branchCheckResult.stdout.trim() !== "") {
      console.log("[PR] Branch already exists on remote, checking for PR...");
    } else {
      console.log("[PR] Branch not on remote, will attempt push anyway");
      unpushedCount = 1; // Force push attempt for new branches
    }
  }

  if (unpushedCount === 0) {
    console.log("[PR] Step 3/5: No commits to push");
    return {
      status: "no_changes",
      step: PRStep.CHECK_UNPUSHED,
    };
  }
  console.log("[PR] Step 3/5: Found commits to push");

  // Step 4: Push to remote
  console.log(`[PR] Step 4/5: Pushing ${unpushedCount} commits to origin/${workItem.branch}...`);
  const pushArgs = ["push", "-u", "origin", workItem.branch];
  const pushResult = await exec("git", pushArgs, { cwd: repoDir });

  if (pushResult.code !== 0) {
    logCommandFailure(PRStep.PUSH, "git", pushArgs, pushResult);
    return {
      status: "error",
      step: PRStep.PUSH,
      error: createPRError(PRStep.PUSH, "git", pushArgs, pushResult),
    };
  }
  console.log("[PR] Step 4/5: Push successful");

  // Step 5: Create PR
  console.log("[PR] Step 5/5: Creating pull request...");
  const prArgs = [
    "pr",
    "create",
    "--title",
    `[AI Factory] ${workItem.branch}`,
    "--body",
    `Automated PR created by AI Factory.\n\nWork Item ID: ${workItem.id}`,
    "--head",
    workItem.branch,
  ];
  const prResult = await exec("gh", prArgs, {
    cwd: repoDir,
    env: { GH_TOKEN: githubToken },
  });

  if (prResult.code !== 0) {
    logCommandFailure(PRStep.CREATE_PR, "gh", prArgs, prResult);
    return {
      status: "error",
      step: PRStep.CREATE_PR,
      error: createPRError(PRStep.CREATE_PR, "gh", prArgs, prResult),
    };
  }

  const prUrl = prResult.stdout.trim();
  console.log("[PR] Step 5/5: Created PR:", prUrl);
  return {
    status: "success",
    step: PRStep.CREATE_PR,
    prUrl,
  };
}
