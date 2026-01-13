import { spawn, type ChildProcess } from "node:child_process";
import type { OrchestratorClient } from "./client.js";

export type RalphEventType =
  | "ITERATION"
  | "FILE_EDIT"
  | "STUCK"
  | "COMPLETE"
  | "FAILED";

export interface RalphEvent {
  type: RalphEventType;
  data: Record<string, unknown>;
  raw: string;
}

export interface RalphMetrics {
  tokensIn: number;
  tokensOut: number;
  duration: number;
  filesModified: number;
  testsRun: number;
  testsPassed: number;
}

export interface RalphResult {
  success: boolean;
  error?: string;
  metrics: RalphMetrics;
  iteration: number;
}

const EVENT_PATTERN = /\[RALPH:(\w+)\](?:\s*(.*))?/;

export function parseRalphEvent(line: string): RalphEvent | null {
  const match = line.match(EVENT_PATTERN);
  if (!match) {
    return null;
  }

  const type = match[1] as RalphEventType;
  const dataStr = match[2]?.trim() || "";

  let data: Record<string, unknown> = {};

  if (dataStr) {
    try {
      data = JSON.parse(dataStr);
    } catch {
      data = { message: dataStr };
    }
  }

  return { type, data, raw: line };
}

export async function runRalph(
  repoDir: string,
  client: OrchestratorClient,
  options: {
    maxIterations?: number;
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
  };

  let iteration = 0;
  let success = false;
  let error: string | undefined;

  const startTime = Date.now();

  const proc = spawn("claude", ["--dangerously-skip-permissions"], {
    cwd: repoDir,
    shell: false,
    env: {
      ...process.env,
      CLAUDE_MAX_ITERATIONS: String(options.maxIterations ?? 100),
    },
  });

  const processLine = async (line: string): Promise<void> => {
    options.onOutput?.(line);

    const event = parseRalphEvent(line);
    if (!event) {
      return;
    }

    options.onEvent?.(event);

    switch (event.type) {
      case "ITERATION": {
        iteration = (event.data.iteration as number) ?? iteration + 1;
        const tokens = event.data.tokens as
          | { in?: number; out?: number }
          | undefined;
        if (tokens) {
          metrics.tokensIn += tokens.in ?? 0;
          metrics.tokensOut += tokens.out ?? 0;
        }
        await client.heartbeat(iteration, "running", {
          in: metrics.tokensIn,
          out: metrics.tokensOut,
        });
        break;
      }

      case "FILE_EDIT": {
        const files = event.data.files as string[] | undefined;
        if (files && files.length > 0) {
          metrics.filesModified += files.length;
          await client.lockFile(files);
        }
        break;
      }

      case "STUCK": {
        const reason = (event.data.reason as string) ?? "Unknown reason";
        const attempts = (event.data.attempts as number) ?? 1;
        await client.stuck(reason, attempts);
        break;
      }

      case "COMPLETE": {
        success = true;
        if (event.data.testsRun !== undefined) {
          metrics.testsRun = event.data.testsRun as number;
        }
        if (event.data.testsPassed !== undefined) {
          metrics.testsPassed = event.data.testsPassed as number;
        }
        break;
      }

      case "FAILED": {
        success = false;
        error = (event.data.error as string) ?? "Unknown error";
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

      if (code !== 0 && !success && !error) {
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
      const line = `[RALPH:${event.type}] ${JSON.stringify(event.data)}`;
      proc.stdout?.emit("data", Buffer.from(line + "\n"));
    },
    close: (code: number) => {
      proc.emit("close", code);
    },
  };
}
