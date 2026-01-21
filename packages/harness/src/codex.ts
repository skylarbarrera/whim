import { Codex } from "@openai/codex-sdk";
import type { Harness, HarnessEvent, HarnessResult, HarnessRunOptions } from "./types.js";

/**
 * Codex harness using the official OpenAI Codex SDK.
 *
 * Uses `runStreamed()` for streaming events during execution.
 * Requires OPENAI_API_KEY environment variable.
 */
export const codexHarness: Harness = {
  name: "codex",

  async run(
    prompt: string,
    options: HarnessRunOptions,
    onEvent: (event: HarnessEvent) => void
  ): Promise<HarnessResult> {
    const startTime = Date.now();

    if (!process.env.OPENAI_API_KEY) {
      const errorMessage = "Missing OPENAI_API_KEY environment variable";
      onEvent({ type: "error", message: errorMessage });
      return {
        success: false,
        durationMs: Date.now() - startTime,
        error: errorMessage,
      };
    }

    try {
      onEvent({ type: "message", text: "Starting Codex SDK..." });

      const codex = new Codex({
        apiKey: process.env.OPENAI_API_KEY,
      });

      const thread = codex.startThread({
        workingDirectory: options.cwd,
        skipGitRepoCheck: true,
        model: options.model,
        // Full access mode for autonomous operation
        sandboxMode: "danger-full-access",
        approvalPolicy: "never",
      });

      // Set up timeout via AbortController
      const abortController = new AbortController();
      const timeoutMs = options.timeoutMs || 300000; // 5 min default
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, timeoutMs);

      let finalOutput = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let success = true;
      let errorMessage: string | undefined;

      // Run with streaming events
      const { events } = await thread.runStreamed(prompt, {
        signal: abortController.signal,
      });

      for await (const event of events) {
        handleCodexEvent(event, onEvent);

        // Capture completion data
        if (event.type === "turn.completed") {
          inputTokens = event.usage?.input_tokens || 0;
          outputTokens = event.usage?.output_tokens || 0;
        }

        // Capture final response from agent messages
        if (event.type === "item.completed") {
          const item = event.item;
          if (item.type === "agent_message") {
            finalOutput += item.text || "";
          }
        }

        // Handle errors
        if (event.type === "turn.failed") {
          success = false;
          errorMessage = event.error?.message || "Turn failed";
        }

        if (event.type === "error") {
          success = false;
          errorMessage = event.message || "Unknown error";
        }
      }

      clearTimeout(timeoutId);

      return {
        success,
        durationMs: Date.now() - startTime,
        usage: inputTokens > 0 || outputTokens > 0
          ? { inputTokens, outputTokens }
          : undefined,
        output: finalOutput,
        error: errorMessage,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check for abort (timeout)
      if (errorMessage.includes("aborted") || errorMessage.includes("abort")) {
        onEvent({ type: "error", message: `Timeout after ${options.timeoutMs || 300000}ms` });
        return {
          success: false,
          durationMs: Date.now() - startTime,
          error: "Timeout",
        };
      }

      onEvent({ type: "error", message: errorMessage });
      return {
        success: false,
        durationMs: Date.now() - startTime,
        error: errorMessage,
      };
    }
  },
};

/**
 * Thread event types from Codex SDK
 */
type ThreadEvent = {
  type: string;
  item?: ThreadItem;
  usage?: { input_tokens: number; cached_input_tokens: number; output_tokens: number };
  error?: { message: string };
  message?: string;
  thread_id?: string;
};

type ThreadItem = {
  id: string;
  type: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number;
  status?: string;
  changes?: Array<{ path: string; kind: string }>;
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: unknown;
  error?: { message: string };
  items?: Array<{ text: string; completed: boolean }>;
};

/**
 * Handle Codex SDK events and emit normalized harness events.
 */
function handleCodexEvent(event: ThreadEvent, onEvent: (event: HarnessEvent) => void): void {
  switch (event.type) {
    case "thread.started": {
      onEvent({ type: "message", text: `Thread started: ${event.thread_id}` });
      break;
    }

    case "turn.started": {
      onEvent({ type: "message", text: "Turn started" });
      break;
    }

    case "item.started": {
      const item = event.item;
      if (!item) break;

      if (item.type === "command_execution") {
        onEvent({
          type: "tool_start",
          name: "bash",
          input: item.command,
        });
      } else if (item.type === "mcp_tool_call") {
        onEvent({
          type: "tool_start",
          name: `${item.server}:${item.tool}`,
          input: item.arguments ? JSON.stringify(item.arguments) : undefined,
        });
      } else if (item.type === "reasoning") {
        onEvent({ type: "thinking", text: item.text || "" });
      }
      break;
    }

    case "item.updated": {
      const item = event.item;
      if (!item) break;

      // Stream command output as it updates
      if (item.type === "command_execution" && item.aggregated_output) {
        onEvent({ type: "message", text: item.aggregated_output });
      }
      break;
    }

    case "item.completed": {
      const item = event.item;
      if (!item) break;

      if (item.type === "command_execution") {
        onEvent({
          type: "tool_end",
          name: "bash",
          output: item.aggregated_output,
          error: item.status === "failed",
        });
      } else if (item.type === "mcp_tool_call") {
        onEvent({
          type: "tool_end",
          name: `${item.server}:${item.tool}`,
          output: item.result ? JSON.stringify(item.result) : undefined,
          error: item.status === "failed",
        });
      } else if (item.type === "file_change") {
        const changes = item.changes || [];
        const summary = changes.map(c => `${c.kind}: ${c.path}`).join(", ");
        onEvent({ type: "message", text: `File changes: ${summary}` });
      } else if (item.type === "agent_message") {
        onEvent({ type: "message", text: item.text || "" });
      } else if (item.type === "todo_list") {
        const todos = item.items || [];
        const summary = todos.map(t => `${t.completed ? "✓" : "○"} ${t.text}`).join("\n");
        onEvent({ type: "message", text: `Todo list:\n${summary}` });
      } else if (item.type === "error") {
        onEvent({ type: "error", message: item.text || "Unknown error" });
      }
      break;
    }

    case "turn.completed": {
      onEvent({ type: "message", text: "Turn completed" });
      break;
    }

    case "turn.failed": {
      onEvent({ type: "error", message: event.error?.message || "Turn failed" });
      break;
    }

    case "error": {
      onEvent({ type: "error", message: event.message || "Unknown error" });
      break;
    }

    default:
      // Unknown event type - ignore
      break;
  }
}
