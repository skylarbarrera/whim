/**
 * Agent Integration
 *
 * Wrapper for invoking the AI harness for verification tasks.
 * Note: The actual harness implementation is in @whim/worker.
 * This module provides a simplified interface for the verifier.
 */

import { spawn } from 'child_process';
import * as path from 'path';

/**
 * Agent run options.
 */
export interface AgentRunOptions {
  cwd: string;
  timeoutMs?: number;
}

/**
 * Agent run result.
 */
export interface AgentRunResult {
  success: boolean;
  output: string;
  durationMs: number;
  costUsd?: number;
  error?: string;
}

/**
 * Run a prompt through the AI agent.
 *
 * For MVP, this uses Claude Code CLI directly.
 * Future: Use the harness abstraction from @whim/worker.
 *
 * @param prompt - The prompt to run
 * @param options - Run options
 * @returns Result of the run
 */
export async function runAgent(
  prompt: string,
  options: AgentRunOptions
): Promise<AgentRunResult> {
  const startTime = Date.now();
  const timeout = options.timeoutMs ?? 300000; // 5 min default

  return new Promise((resolve) => {
    let output = '';
    let error = '';

    // Use Claude Code CLI in print mode
    const proc = spawn(
      'claude',
      ['--print', '--dangerously-skip-permissions'],
      {
        cwd: options.cwd,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    // Send prompt to stdin
    proc.stdin.write(prompt);
    proc.stdin.end();

    proc.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      error += data.toString();
    });

    // Set timeout
    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({
        success: false,
        output,
        durationMs: Date.now() - startTime,
        error: `Timeout after ${timeout}ms`,
      });
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      resolve({
        success: code === 0,
        output,
        durationMs: Date.now() - startTime,
        error: code !== 0 ? error || `Exit code ${code}` : undefined,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        output,
        durationMs: Date.now() - startTime,
        error: err.message,
      });
    });
  });
}

/**
 * Run a command and capture output.
 *
 * @param command - The command to run
 * @param cwd - Working directory
 * @param timeoutMs - Timeout in milliseconds
 * @returns Command result
 */
export async function runCommand(
  command: string,
  cwd: string,
  timeoutMs = 300000
): Promise<{ status: 'pass' | 'fail'; output: string; exitCode: number }> {
  return new Promise((resolve) => {
    let output = '';

    const proc = spawn('sh', ['-c', command], {
      cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      output += data.toString();
    });

    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({
        status: 'fail',
        output: output + '\n[TIMEOUT]',
        exitCode: -1,
      });
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      resolve({
        status: code === 0 ? 'pass' : 'fail',
        output,
        exitCode: code ?? -1,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      resolve({
        status: 'fail',
        output: output + '\n' + err.message,
        exitCode: -1,
      });
    });
  });
}

/**
 * Get PR diff using git.
 *
 * @param cwd - Repository directory
 * @param baseBranch - Base branch to compare against
 * @returns The diff output
 */
export async function getPRDiff(cwd: string, baseBranch = 'main'): Promise<string> {
  const result = await runCommand(`git diff ${baseBranch}...HEAD`, cwd);
  return result.output;
}

/**
 * Get current git SHA.
 *
 * @param cwd - Repository directory
 * @returns The current commit SHA
 */
export async function getGitSha(cwd: string): Promise<string> {
  const result = await runCommand('git rev-parse HEAD', cwd);
  return result.output.trim();
}

/**
 * Get current git branch.
 *
 * @param cwd - Repository directory
 * @returns The current branch name
 */
export async function getGitBranch(cwd: string): Promise<string> {
  const result = await runCommand('git rev-parse --abbrev-ref HEAD', cwd);
  return result.output.trim();
}

/**
 * Read a file from the repository.
 *
 * @param cwd - Repository directory
 * @param filePath - Relative path to file
 * @returns File contents or null if not found
 */
export async function readFile(cwd: string, filePath: string): Promise<string | null> {
  const fullPath = path.join(cwd, filePath);
  const result = await runCommand(`cat "${fullPath}"`, cwd);
  if (result.status === 'pass') {
    return result.output;
  }
  return null;
}

/**
 * Start a dev server.
 *
 * @param command - The command to start the server
 * @param cwd - Working directory
 * @param port - Expected port
 * @param timeoutMs - Startup timeout
 * @returns Server process handle
 */
export async function startDevServer(
  command: string,
  cwd: string,
  port: number,
  timeoutMs = 60000
): Promise<{
  process: ReturnType<typeof spawn>;
  stop: () => Promise<void>;
}> {
  const proc = spawn('sh', ['-c', command], {
    cwd,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });

  // Wait for server to be ready by polling the port
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const check = await runCommand(`curl -s -o /dev/null -w "%{http_code}" http://localhost:${port}`, cwd, 5000);
    if (check.output.includes('200') || check.output.includes('404') || check.output.includes('302')) {
      // Server is up (any response means it's listening)
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  return {
    process: proc,
    stop: async () => {
      if (proc.pid) {
        // Kill the process group
        try {
          process.kill(-proc.pid, 'SIGTERM');
        } catch {
          proc.kill('SIGTERM');
        }
      }
    },
  };
}

/**
 * Check an HTTP endpoint.
 *
 * @param url - The URL to check
 * @param method - HTTP method
 * @returns Check result
 */
export async function checkEndpoint(
  url: string,
  method = 'GET'
): Promise<{
  status: number;
  ok: boolean;
  body: string;
  error?: string;
}> {
  const result = await runCommand(
    `curl -s -X ${method} -w "\\n%{http_code}" "${url}"`,
    process.cwd(),
    10000
  );

  if (result.status === 'fail') {
    return {
      status: 0,
      ok: false,
      body: '',
      error: result.output,
    };
  }

  const lines = result.output.trim().split('\n');
  const statusLine = lines.pop();
  const status = parseInt(statusLine ?? '0', 10);
  const body = lines.join('\n');

  return {
    status,
    ok: status >= 200 && status < 400,
    body,
  };
}
