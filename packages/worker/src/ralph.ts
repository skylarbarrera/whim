import { spawn, type ChildProcess } from "node:child_process";
import type { OrchestratorClient } from "./client.js";

/**
 * Ralph headless event types (JSON from stdout)
 */
export type RalphEventType =
  | "started"
  | "iteration"
  | "tool"
  | "commit"
  | "task_complete"
  | "iteration_done"
  | "stuck"
  | "complete"
  | "failed";

export interface RalphEvent {
  event: RalphEventType;
  [key: string]: unknown;
}

export interface RalphMetrics {
  tokensIn: number;
  tokensOut: number;
  duration: number;
  filesModified: number;
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  testStatus?: "passed" | "failed" | "timeout" | "skipped" | "error";
}

export interface RalphResult {
  success: boolean;
  error?: string;
  metrics: RalphMetrics;
  iteration: number;
}

/**
 * Parse a JSON event line from Ralph's headless output
 */
export function parseRalphEvent(line: string): RalphEvent | null {
  try {
    const event = JSON.parse(line);
    if (event && typeof event.event === "string") {
      return event as RalphEvent;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Run Ralph in headless mode
 */
export async function runRalph(
  repoDir: string,
  client: OrchestratorClient,
  options: {
    maxIterations?: number;
    stuckThreshold?: number;
    onEvent?: (event: RalphEvent) => void;
    onOutput?: (line: string) => void;
  } = {}
): Promise<RalphResult> {
  const metrics: RalphMetrics = {
    tokensIn: 0,
    tokensOut: 0,
    duration: 0,
    filesModified: 0,
    testsRun: 0,
    testsPassed: 0,
    testsFailed: 0,
    testStatus: undefined,
  };

  let iteration = 0;
  let success = false;
  let error: string | undefined;

  const startTime = Date.now();

  // Spawn Ralph in headless mode
  const args = [
    "run",
    "--headless",
    "--all",
  ];

  if (options.maxIterations) {
    args.push("-n", String(options.maxIterations));
  }

  if (options.stuckThreshold) {
    args.push("--stuck-threshold", String(options.stuckThreshold));
  }

  const proc = spawn("ralph", args, {
    cwd: repoDir,
    shell: false,
    env: process.env,
  });

  const processLine = async (line: string): Promise<void> => {
    options.onOutput?.(line);

    const event = parseRalphEvent(line);
    if (!event) {
      return;
    }

    options.onEvent?.(event);

    switch (event.event) {
      case "started": {
        console.log(`Ralph started: ${event.tasks} tasks`);
        break;
      }

      case "iteration": {
        iteration = (event.n as number) ?? iteration + 1;
        await client.heartbeat(iteration, "running", {
          in: metrics.tokensIn,
          out: metrics.tokensOut,
        });
        break;
      }

      case "tool": {
        // Send heartbeat on every tool call to prevent stale detection
        await client.heartbeat(iteration, "running", {
          in: metrics.tokensIn,
          out: metrics.tokensOut,
        });
        if (event.type === "write" && event.path) {
          metrics.filesModified++;
          await client.lockFile([event.path as string]);
        }
        break;
      }

      case "iteration_done": {
        const stats = event.stats as Record<string, number> | undefined;
        if (stats) {
          metrics.tokensIn += stats.tokensIn ?? 0;
          metrics.tokensOut += stats.tokensOut ?? 0;
        }
        break;
      }

      case "stuck": {
        const reason = (event.reason as string) ?? "Unknown reason";
        const attempts = (event.iterations_without_progress as number) ?? 1;
        await client.stuck(reason, attempts);
        break;
      }

      case "complete": {
        success = true;
        metrics.testsRun = (event.tests_run as number) ?? 0;
        metrics.testsPassed = (event.tests_passed as number) ?? 0;
        break;
      }

      case "failed": {
        success = false;
        error = (event.error as string) ?? "Unknown error";
        await client.fail(error, iteration);
        break;
      }
    }
  };

  return new Promise((resolve, reject) => {
    let stdoutBuffer = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        processLine(line).catch(console.error);
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (line.trim()) {
          options.onOutput?.(`[stderr] ${line}`);
        }
      }
    });

    proc.on("close", (code) => {
      if (stdoutBuffer) {
        processLine(stdoutBuffer).catch(console.error);
      }

      metrics.duration = Date.now() - startTime;

      // Ralph exit codes: 0=complete, 1=stuck, 2=max iterations, 3=error
      if (code === 0) {
        success = true;
      } else if (code === 1) {
        error = error ?? "Stuck: no progress";
      } else if (code === 2) {
        error = error ?? "Max iterations reached";
      } else if (!success && !error) {
        error = `Process exited with code ${code}`;
      }

      resolve({
        success,
        error,
        metrics,
        iteration,
      });
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

export function createMockRalphProcess(
  events: RalphEvent[]
): {
  process: ChildProcess;
  emitEvent: (event: RalphEvent) => void;
  close: (code: number) => void;
} {
  const proc = spawn("echo", [], { shell: false });

  return {
    process: proc,
    emitEvent: (event: RalphEvent) => {
      proc.stdout?.emit("data", Buffer.from(JSON.stringify(event) + "\n"));
    },
    close: (code: number) => {
      proc.emit("close", code);
    },
  };
}
