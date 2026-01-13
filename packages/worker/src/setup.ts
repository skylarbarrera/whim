import { spawn } from "node:child_process";
import { mkdir, writeFile, access, cp } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { WorkItem } from "@factory/shared";

export interface WorkspaceConfig {
  workDir: string;
  githubToken: string;
  claudeConfigDir?: string;
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

export async function createPullRequest(
  repoDir: string,
  workItem: WorkItem,
  githubToken: string
): Promise<string | null> {
  const addResult = await exec("git", ["add", "-A"], { cwd: repoDir });
  if (addResult.code !== 0) {
    console.error("Failed to stage changes:", addResult.stderr);
    return null;
  }

  const statusResult = await exec("git", ["status", "--porcelain"], {
    cwd: repoDir,
  });
  if (statusResult.stdout.trim() === "") {
    console.log("No changes to commit");
    return null;
  }

  const commitResult = await exec(
    "git",
    ["commit", "-m", `feat: ${workItem.branch}\n\nImplemented by AI Factory`],
    { cwd: repoDir }
  );

  if (commitResult.code !== 0) {
    console.error("Failed to commit:", commitResult.stderr);
    return null;
  }

  const pushResult = await exec(
    "git",
    ["push", "-u", "origin", workItem.branch],
    { cwd: repoDir }
  );

  if (pushResult.code !== 0) {
    console.error("Failed to push:", pushResult.stderr);
    return null;
  }

  const prResult = await exec(
    "gh",
    [
      "pr",
      "create",
      "--title",
      `[AI Factory] ${workItem.branch}`,
      "--body",
      `Automated PR created by AI Factory.\n\nWork Item ID: ${workItem.id}`,
      "--head",
      workItem.branch,
    ],
    {
      cwd: repoDir,
      env: { GH_TOKEN: githubToken },
    }
  );

  if (prResult.code !== 0) {
    console.error("Failed to create PR:", prResult.stderr);
    return null;
  }

  return prResult.stdout.trim();
}
