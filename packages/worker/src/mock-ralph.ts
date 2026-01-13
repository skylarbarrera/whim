/**
 * Mock Ralph for testing worker lifecycle without burning Claude tokens
 *
 * Emits the same events as real Ralph but with configurable delays and outcomes
 */

import type { OrchestratorClient } from "./client.js";
import type { RalphResult, RalphMetrics, RalphEvent } from "./ralph.js";

export interface MockRalphOptions {
  /** Delay between tool events in ms (default: 100) */
  toolDelay?: number;
  /** Number of tool calls to simulate (default: 10) */
  toolCount?: number;
  /** Should the run succeed? (default: true) */
  shouldSucceed?: boolean;
  /** Error message if failing */
  errorMessage?: string;
  /** Simulate getting stuck */
  shouldGetStuck?: boolean;
  /** Total duration to simulate in ms (default: 5000) */
  totalDuration?: number;
  /** Callbacks */
  onEvent?: (event: RalphEvent) => void;
  onOutput?: (line: string) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function emit(options: MockRalphOptions, event: RalphEvent): void {
  const line = JSON.stringify(event);
  options.onOutput?.(line);
  options.onEvent?.(event);
}

/**
 * Run mock Ralph - simulates the lifecycle without Claude
 */
export async function runMockRalph(
  repoDir: string,
  client: OrchestratorClient,
  options: MockRalphOptions = {}
): Promise<RalphResult> {
  const {
    toolDelay = 100,
    toolCount = 10,
    shouldSucceed = true,
    errorMessage = "Mock error",
    shouldGetStuck = false,
    totalDuration = 5000,
  } = options;

  const metrics: RalphMetrics = {
    tokensIn: 1000,
    tokensOut: 500,
    duration: 0,
    filesModified: 3,
    testsRun: 5,
    testsPassed: shouldSucceed ? 5 : 3,
    testsFailed: shouldSucceed ? 0 : 2,
    testStatus: shouldSucceed ? "passed" : "failed",
  };

  const startTime = Date.now();
  let iteration = 0;

  console.log("Mock Ralph starting...");

  // Emit started event
  emit(options, { event: "started", tasks: 5 });

  // Start iteration
  iteration = 1;
  emit(options, { event: "iteration", n: iteration });

  // Send initial heartbeat
  await client.heartbeat(iteration, "running", {
    in: metrics.tokensIn,
    out: metrics.tokensOut,
  });

  // Simulate tool calls
  const delayPerTool = Math.floor(totalDuration / toolCount);

  for (let i = 0; i < toolCount; i++) {
    await sleep(options.toolDelay ?? delayPerTool);

    // Emit tool event
    const toolTypes = ["read", "write", "bash"] as const;
    const toolType = toolTypes[i % toolTypes.length];

    emit(options, {
      event: "tool",
      type: toolType,
      path: toolType !== "bash" ? `/workspace/repo/src/file${i}.ts` : undefined
    });

    // Send heartbeat on each tool (like the fix we made)
    await client.heartbeat(iteration, "running", {
      in: metrics.tokensIn,
      out: metrics.tokensOut,
    });

    // Simulate file modification
    if (toolType === "write") {
      await client.lockFile([`/workspace/repo/src/file${i}.ts`]);
    }

    // Check for stuck simulation
    if (shouldGetStuck && i === Math.floor(toolCount / 2)) {
      emit(options, { event: "stuck", reason: "Simulated stuck", iterations_without_progress: 3 });
      await client.stuck("Simulated stuck", 3);

      metrics.duration = Date.now() - startTime;
      return {
        success: false,
        error: "Stuck: Simulated stuck",
        metrics,
        iteration,
      };
    }
  }

  // Emit task completions
  for (let i = 1; i <= 5; i++) {
    emit(options, { event: "task_complete", index: i, text: `Task ${i} completed` });
  }

  // Emit iteration done
  emit(options, {
    event: "iteration_done",
    n: iteration,
    duration_ms: Date.now() - startTime,
    stats: {
      toolsStarted: toolCount,
      toolsCompleted: toolCount,
      toolsErrored: 0,
      reads: 3,
      writes: 4,
      commands: 3,
    }
  });

  metrics.duration = Date.now() - startTime;

  if (!shouldSucceed) {
    emit(options, { event: "failed", error: errorMessage });
    return {
      success: false,
      error: errorMessage,
      metrics,
      iteration,
    };
  }

  // Emit complete
  emit(options, { event: "complete", tasks_done: 5, total_duration_ms: metrics.duration });
  console.log("Mock Ralph completed: SUCCESS");

  return {
    success: true,
    metrics,
    iteration,
  };
}
