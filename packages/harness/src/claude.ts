import { query, type SDKMessage, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Harness, HarnessEvent, HarnessResult, HarnessRunOptions } from "./types.js";

/**
 * Claude harness using the official Claude Agent SDK.
 *
 * Uses the `query` function for agentic execution with streaming events.
 * Requires ANTHROPIC_API_KEY environment variable.
 */
export const claudeHarness: Harness = {
  name: "claude",

  async run(
    prompt: string,
    options: HarnessRunOptions,
    onEvent: (event: HarnessEvent) => void
  ): Promise<HarnessResult> {
    const startTime = Date.now();

    if (!process.env.ANTHROPIC_API_KEY) {
      const errorMessage = "Missing ANTHROPIC_API_KEY environment variable";
      onEvent({ type: "error", message: errorMessage });
      return {
        success: false,
        durationMs: Date.now() - startTime,
        error: errorMessage,
      };
    }

    try {
      onEvent({ type: "message", text: "Starting Claude Agent SDK..." });

      // Create abort controller for timeout
      const abortController = new AbortController();
      const timeoutMs = options.timeoutMs || 300000; // 5 min default
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, timeoutMs);

      const result = query({
        prompt,
        options: {
          abortController,
          model: options.model || "claude-sonnet-4-5-20250929",
          cwd: options.cwd,
          allowedTools: options.allowedTools,
          systemPrompt: options.systemPrompt,
          // Run with full permissions for autonomous operation
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          // Don't persist sessions for worker runs
          persistSession: false,
        },
      });

      let finalOutput = "";
      let totalCostUsd: number | undefined;
      let inputTokens = 0;
      let outputTokens = 0;
      let success = true;
      let errorMessage: string | undefined;

      // Process streaming events
      for await (const message of result) {
        handleSDKMessage(message, onEvent);

        // Capture final result
        if (message.type === "result") {
          const resultMsg = message as SDKResultMessage;
          totalCostUsd = resultMsg.total_cost_usd;
          inputTokens = resultMsg.usage?.input_tokens || 0;
          outputTokens = resultMsg.usage?.output_tokens || 0;

          if (resultMsg.subtype === "success") {
            finalOutput = resultMsg.result || "";
            success = true;
          } else {
            // Error result
            success = false;
            errorMessage = resultMsg.errors?.join(", ") || resultMsg.subtype;
          }
        }
      }

      clearTimeout(timeoutId);

      return {
        success,
        durationMs: Date.now() - startTime,
        costUsd: totalCostUsd,
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
 * Handle SDK messages and emit normalized harness events.
 */
function handleSDKMessage(message: SDKMessage, onEvent: (event: HarnessEvent) => void): void {
  switch (message.type) {
    case "assistant": {
      // Assistant message contains the full BetaMessage
      // Extract text content from the message
      const betaMessage = message.message;
      if (betaMessage?.content) {
        for (const block of betaMessage.content) {
          if (block.type === "text") {
            onEvent({ type: "message", text: block.text });
          } else if (block.type === "tool_use") {
            onEvent({
              type: "tool_start",
              name: block.name,
              input: JSON.stringify(block.input),
            });
          } else if ((block as { type: string }).type === "thinking") {
            onEvent({ type: "thinking", text: (block as { thinking: string }).thinking });
          }
        }
      }
      break;
    }

    case "tool_progress": {
      // Tool progress updates
      onEvent({
        type: "message",
        text: `[Tool progress: ${message.tool_use_id}]`,
      });
      break;
    }

    case "stream_event": {
      // Streaming events - could process for real-time updates
      // For now, we just note them
      break;
    }

    case "system": {
      // System messages (like compact boundaries)
      if (message.subtype === "compact_boundary") {
        onEvent({ type: "message", text: "[Context compacted]" });
      }
      break;
    }

    case "result": {
      // Final result - handled in main loop
      break;
    }

    case "auth_status": {
      // Authentication status updates
      if (message.error) {
        onEvent({ type: "error", message: `Auth error: ${message.error}` });
      }
      break;
    }

    default:
      // Unknown message type - ignore
      break;
  }
}
