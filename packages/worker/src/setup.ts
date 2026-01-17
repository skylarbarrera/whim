import { spawn } from "node:child_process";
import { mkdir, writeFile, access, cp } from "node:fs/promises";
import { join } from "node:path";
import { formatReviewComment, type ReviewFindings } from "./prompts/review-prompt.js";
import type { ExecutionReadyWorkItem } from "./types.js";

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

/**
 * Result of git authentication verification
 */
export interface GitAuthResult {
  success: boolean;
  error?: string;
  scopes?: string[];
}

/**
 * Verify git push access BEFORE starting work.
 * Creates a test branch, pushes it, then cleans up.
 * This catches auth issues (like missing workflow scope) early.
 */
export async function verifyGitAuth(
  repoDir: string,
  _githubToken: string
): Promise<GitAuthResult> {
  const testBranch = `whim-auth-test-${Date.now()}`;

  console.log("[AUTH] Verifying git push access...");

  // Step 1: Create test branch
  const branchResult = await exec("git", ["checkout", "-b", testBranch], { cwd: repoDir });
  if (branchResult.code !== 0) {
    return { success: false, error: `Failed to create test branch: ${branchResult.stderr}` };
  }

  // Step 2: Create empty commit (no workflow files to avoid scope issues)
  const commitResult = await exec(
    "git",
    ["commit", "--allow-empty", "-m", "test: verify git push access"],
    { cwd: repoDir }
  );
  if (commitResult.code !== 0) {
    // Clean up
    await exec("git", ["checkout", "-"], { cwd: repoDir });
    await exec("git", ["branch", "-D", testBranch], { cwd: repoDir });
    return { success: false, error: `Failed to create test commit: ${commitResult.stderr}` };
  }

  // Step 3: Try to push
  const pushResult = await exec("git", ["push", "-u", "origin", testBranch], { cwd: repoDir });

  // Step 4: Clean up - switch back and delete branches regardless of push result
  await exec("git", ["checkout", "-"], { cwd: repoDir });
  await exec("git", ["branch", "-D", testBranch], { cwd: repoDir });

  if (pushResult.code !== 0) {
    // Check for specific scope errors
    const stderr = pushResult.stderr.toLowerCase();
    if (stderr.includes("workflow") && stderr.includes("scope")) {
      return {
        success: false,
        error: "Token missing 'workflow' scope - cannot push workflow files. Re-auth with: gh auth login --scopes workflow"
      };
    }
    if (stderr.includes("permission") || stderr.includes("denied") || stderr.includes("403")) {
      return {
        success: false,
        error: `Push access denied. Ensure token has 'repo' scope. Error: ${pushResult.stderr}`
      };
    }
    return { success: false, error: `Push failed: ${pushResult.stderr}` };
  }

  // Step 5: Delete remote test branch
  await exec("git", ["push", "origin", "--delete", testBranch], { cwd: repoDir });

  console.log("[AUTH] Git push access verified successfully");
  return { success: true };
}

export async function setupWorkspace(
  workItem: ExecutionReadyWorkItem,
  config: WorkspaceConfig
): Promise<string> {
  const repoDir = join(config.workDir, "repo");

  await mkdir(config.workDir, { recursive: true });

  const repoUrl = `https://x-access-token:${config.githubToken}@github.com/${workItem.repo}.git`;
  // Note: We don't log the full URL since it contains the token
  const cloneArgs = ["clone", "--depth", "1", repoUrl, repoDir];
  const cloneResult = await exec("git", cloneArgs);

  if (cloneResult.code !== 0) {
    // Log with sanitized URL (don't expose token)
    const safeArgs = ["clone", "--depth", "1", `https://***@github.com/${workItem.repo}.git`, repoDir];
    logSetupCommandResult("git clone", "git", safeArgs, cloneResult);
    throw new Error(`Failed to clone repo: ${cloneResult.stderr}`);
  }

  const checkoutArgs = ["checkout", "-b", workItem.branch];
  const checkoutResult = await exec("git", checkoutArgs, { cwd: repoDir });

  if (checkoutResult.code !== 0) {
    logSetupCommandResult("git checkout", "git", checkoutArgs, checkoutResult);
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
  const ralphInitArgs = ["init"];
  const initResult = await exec("ralph", ralphInitArgs, { cwd: repoDir });
  if (initResult.code !== 0) {
    logSetupCommandResult("ralph init", "ralph", ralphInitArgs, initResult);
    console.warn("[SETUP] Ralph init failed but continuing (may not be fatal)");
  }

  // Commit the initial setup so Ralph doesn't complain about uncommitted changes
  const addArgs = ["add", "-A"];
  const addResult = await exec("git", addArgs, { cwd: repoDir });
  if (addResult.code !== 0) {
    logSetupCommandResult("git add (initial)", "git", addArgs, addResult);
    throw new Error(`Failed to stage initial files: ${addResult.stderr}`);
  }

  const commitArgs = ["commit", "-m", "chore: initialize workspace for Whim"];
  const commitResult = await exec("git", commitArgs, { cwd: repoDir });
  if (commitResult.code !== 0) {
    logSetupCommandResult("git commit (initial)", "git", commitArgs, commitResult);
    throw new Error(`Failed to commit initial setup: ${commitResult.stderr}`);
  }

  return repoDir;
}

async function configureGit(repoDir: string): Promise<void> {
  const emailArgs = ["config", "user.email", "whim@ai.local"];
  const emailResult = await exec("git", emailArgs, { cwd: repoDir });
  if (emailResult.code !== 0) {
    logSetupCommandResult("git config user.email", "git", emailArgs, emailResult);
    throw new Error(`Failed to configure git email: ${emailResult.stderr}`);
  }

  const nameArgs = ["config", "user.name", "Whim Worker"];
  const nameResult = await exec("git", nameArgs, { cwd: repoDir });
  if (nameResult.code !== 0) {
    logSetupCommandResult("git config user.name", "git", nameArgs, nameResult);
    throw new Error(`Failed to configure git name: ${nameResult.stderr}`);
  }
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
 * Log detailed command failure information for PR steps
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
 * Log command result for setup steps (non-PR commands)
 * Used for debugging failed setup operations
 */
function logSetupCommandResult(
  context: string,
  command: string,
  args: string[],
  result: { stdout: string; stderr: string; code: number }
): void {
  const fullCommand = `${command} ${args.join(" ")}`;
  console.error(`[SETUP] ${context} FAILED`);
  console.error(`[SETUP]   Command: ${fullCommand}`);
  console.error(`[SETUP]   Exit code: ${result.code}`);
  if (result.stdout.trim()) {
    console.error(`[SETUP]   stdout: ${result.stdout.trim()}`);
  }
  if (result.stderr.trim()) {
    console.error(`[SETUP]   stderr: ${result.stderr.trim()}`);
  }
}

/**
 * Retry configuration for network operations
 */
interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

/**
 * Check if a command result indicates a transient/retryable error
 * Common patterns:
 * - Network errors (connection reset, timeout)
 * - Server errors (5xx HTTP status)
 * - Rate limiting (429)
 */
export function isRetryableError(result: { stdout: string; stderr: string; code: number }): boolean {
  const output = (result.stdout + result.stderr).toLowerCase();

  // Network connectivity issues
  if (output.includes("connection reset") ||
      output.includes("connection refused") ||
      output.includes("connection timed out") ||
      output.includes("network is unreachable") ||
      output.includes("temporary failure") ||
      output.includes("could not resolve host") ||
      output.includes("ssl connect error") ||
      output.includes("unable to access")) {
    return true;
  }

  // Server-side errors (5xx)
  if (output.includes("500") ||
      output.includes("502") ||
      output.includes("503") ||
      output.includes("504") ||
      output.includes("internal server error") ||
      output.includes("service unavailable") ||
      output.includes("bad gateway")) {
    return true;
  }

  // Rate limiting
  if (output.includes("rate limit") ||
      output.includes("429") ||
      output.includes("too many requests")) {
    return true;
  }

  return false;
}

/**
 * Sleep for a specified duration with exponential backoff + jitter
 */
function sleep(attempt: number, config: RetryConfig): Promise<void> {
  // Exponential backoff: base * 2^attempt
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  // Add jitter: ±25% randomness
  const jitter = exponentialDelay * (0.75 + Math.random() * 0.5);
  // Cap at max delay
  const delay = Math.min(jitter, config.maxDelayMs);

  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Execute a command with retry logic for transient failures
 */
async function execWithRetry(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<{ stdout: string; stderr: string; code: number }> {
  let lastResult: { stdout: string; stderr: string; code: number } | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[RETRY] Attempt ${attempt + 1}/${config.maxRetries + 1} for: ${command} ${args.join(" ")}`);
      await sleep(attempt - 1, config);
    }

    lastResult = await exec(command, args, options);

    // Success - return immediately
    if (lastResult.code === 0) {
      if (attempt > 0) {
        console.log(`[RETRY] Succeeded on attempt ${attempt + 1}`);
      }
      return lastResult;
    }

    // Check if this is a retryable error
    if (!isRetryableError(lastResult)) {
      // Not retryable, return immediately
      if (attempt > 0) {
        console.log(`[RETRY] Non-retryable error, giving up after ${attempt + 1} attempts`);
      }
      return lastResult;
    }

    // Log retry attempt
    console.log(`[RETRY] Transient error detected, will retry...`);
    console.log(`[RETRY]   Exit code: ${lastResult.code}`);
    if (lastResult.stderr.trim()) {
      // Truncate to first 200 chars for logging
      const stderrPreview = lastResult.stderr.trim().slice(0, 200);
      console.log(`[RETRY]   stderr: ${stderrPreview}${lastResult.stderr.length > 200 ? "..." : ""}`);
    }
  }

  // All retries exhausted
  console.log(`[RETRY] All ${config.maxRetries + 1} attempts failed`);
  return lastResult!;
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
  workItem: ExecutionReadyWorkItem,
  githubToken: string,
  reviewFindings?: ReviewFindings
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
    const commitArgs = ["commit", "-m", `feat: ${workItem.branch}\n\nImplemented by Whim`];
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

  // Step 4: Push to remote (with retry for transient failures)
  console.log(`[PR] Step 4/5: Pushing ${unpushedCount} commits to origin/${workItem.branch}...`);
  const pushArgs = ["push", "-u", "origin", workItem.branch];
  const pushResult = await execWithRetry("git", pushArgs, { cwd: repoDir });

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

  // Log token presence (masked for security)
  const tokenLength = githubToken?.length || 0;
  const tokenMask = tokenLength > 0
    ? `${githubToken.substring(0, 4)}...(${tokenLength} chars)`
    : "(empty)";
  console.log(`[PR] Using GitHub token: ${tokenMask}`);

  // Extract issue metadata for PR body
  const issueNumber = workItem.metadata?.issueNumber as number | undefined;
  const issueTitle = workItem.metadata?.issueTitle as string | undefined;

  // Build PR title - include issue title if available
  const prTitle = issueTitle
    ? `[Whim] ${issueTitle}`
    : `[Whim] ${workItem.branch}`;

  // Build comprehensive PR body
  const prBodyParts: string[] = [
    "## Summary",
    "",
    `This PR was automatically generated by Whim to address ${issueNumber ? `issue #${issueNumber}` : "a work item"}.`,
    "",
  ];

  if (issueTitle) {
    prBodyParts.push(`**Issue:** ${issueTitle}`, "");
  }

  prBodyParts.push(
    "## Changes",
    "",
    "See commit history for detailed changes.",
    "",
  );

  // Add closing reference if we have an issue number
  if (issueNumber) {
    prBodyParts.push(
      "---",
      "",
      `Closes #${issueNumber}`,
      "",
    );
  }

  prBodyParts.push(
    "---",
    `*Work Item ID: ${workItem.id}*`,
  );

  const prBody = prBodyParts.join("\n");

  const prArgs = [
    "pr",
    "create",
    "--title",
    prTitle,
    "--body",
    prBody,
    "--head",
    workItem.branch,
  ];

  // Pass both GH_TOKEN and GITHUB_TOKEN for maximum compatibility
  // gh CLI checks GH_TOKEN first, then GITHUB_TOKEN
  // Also preserve GH_HOST if set (for GitHub Enterprise)
  const ghEnv: NodeJS.ProcessEnv = {
    GH_TOKEN: githubToken,
    GITHUB_TOKEN: githubToken,
  };
  if (process.env.GH_HOST) {
    ghEnv.GH_HOST = process.env.GH_HOST;
  }

  console.log("[PR] Running: gh", prArgs.join(" "));
  // Use retry for PR creation (GitHub API can have transient failures)
  const prResult = await execWithRetry("gh", prArgs, {
    cwd: repoDir,
    env: ghEnv,
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

  // Post-PR: Update issue if we have issue metadata
  if (issueNumber) {
    const [owner, repo] = workItem.repo.split("/");
    if (owner && repo) {
      // Add comment to issue with PR link
      console.log(`[PR] Posting comment to issue #${issueNumber}...`);
      const commentBody = `🤖 **Whim Update**\n\nA pull request has been created to address this issue:\n\n➡️ ${prUrl}\n\nThe PR will automatically close this issue when merged.`;
      const commentArgs = [
        "issue",
        "comment",
        String(issueNumber),
        "--body",
        commentBody,
        "--repo",
        workItem.repo,
      ];
      const commentResult = await exec("gh", commentArgs, {
        cwd: repoDir,
        env: ghEnv,
      });
      if (commentResult.code !== 0) {
        console.warn(`[PR] Failed to comment on issue #${issueNumber}:`, commentResult.stderr);
      } else {
        console.log(`[PR] Posted comment to issue #${issueNumber}`);
      }

      // Update issue labels: remove processing, add pr-ready
      console.log(`[PR] Updating labels on issue #${issueNumber}...`);
      const labelArgs = [
        "issue",
        "edit",
        String(issueNumber),
        "--remove-label", "ai-processing",
        "--add-label", "ai-pr-ready",
        "--repo",
        workItem.repo,
      ];
      const labelResult = await exec("gh", labelArgs, {
        cwd: repoDir,
        env: ghEnv,
      });
      if (labelResult.code !== 0) {
        console.warn(`[PR] Failed to update labels on issue #${issueNumber}:`, labelResult.stderr);
      } else {
        console.log(`[PR] Updated labels on issue #${issueNumber}`);
      }
    }
  }

  // Post AI review comment if available
  if (reviewFindings && prUrl) {
    console.log("[PR] Posting AI review comment...");
    const reviewComment = formatReviewComment(reviewFindings);
    const reviewArgs = [
      "pr",
      "comment",
      prUrl,
      "--body",
      reviewComment,
    ];
    const reviewResult = await exec("gh", reviewArgs, {
      cwd: repoDir,
      env: ghEnv,
    });
    if (reviewResult.code !== 0) {
      console.warn("[PR] Failed to post AI review comment:", reviewResult.stderr);
    } else {
      console.log("[PR] Posted AI review comment");
    }
  }

  return {
    status: "success",
    step: PRStep.CREATE_PR,
    prUrl,
  };
}
