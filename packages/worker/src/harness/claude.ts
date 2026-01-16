import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Harness, HarnessEvent, HarnessResult, HarnessRunOptions } from './types.js';

/**
 * Claude harness using the official Anthropic Claude Agent SDK.
 *
 * Wraps the SDK's query() function and emits normalized events.
 */
export const claudeHarness: Harness = {
  name: 'claude',

  async run(
    prompt: string,
    options: HarnessRunOptions,
    onEvent: (event: HarnessEvent) => void
  ): Promise<HarnessResult> {
    const startTime = Date.now();

    if (!process.env.ANTHROPIC_API_KEY) {
      const errorMessage = 'Missing ANTHROPIC_API_KEY environment variable';
      onEvent({ type: 'error', message: errorMessage });
      return {
        success: false,
        durationMs: Date.now() - startTime,
        error: errorMessage,
      };
    }

    try {
      const queryResult = query({
        prompt,
        options: {
          cwd: options.cwd,
          permissionMode: 'bypassPermissions',
          allowedTools: options.allowedTools,
          model: options.model,
          systemPrompt: options.systemPrompt,
        },
      });

      let result: HarnessResult = {
        success: false,
        durationMs: 0,
        error: 'No result received',
      };

      for await (const message of queryResult) {
        if (message.type === 'assistant') {
          for (const block of message.message.content) {
            if (block.type === 'tool_use') {
              onEvent({
                type: 'tool_start',
                name: block.name,
                input: JSON.stringify(block.input),
              });
            } else if (block.type === 'text') {
              onEvent({
                type: 'message',
                text: block.text,
              });
            } else if (block.type === 'thinking') {
              onEvent({
                type: 'thinking',
                text: (block as { thinking: string }).thinking,
              });
            }
          }
        } else if (message.type === 'user') {
          for (const block of message.message.content) {
            if (typeof block !== 'string' && block.type === 'tool_result') {
              const toolResult = block as {
                tool_use_id: string;
                content: unknown;
                is_error?: boolean;
              };
              onEvent({
                type: 'tool_end',
                name: toolResult.tool_use_id,
                output: typeof toolResult.content === 'string'
                  ? toolResult.content
                  : JSON.stringify(toolResult.content),
                error: toolResult.is_error,
              });
            }
          }
        } else if (message.type === 'result') {
          if (message.subtype === 'success') {
            result = {
              success: true,
              durationMs: message.duration_ms,
              costUsd: message.total_cost_usd,
              usage: {
                inputTokens: message.usage.input_tokens,
                outputTokens: message.usage.output_tokens,
              },
              output: message.result,
            };
          } else {
            const errorMsg = message as { errors?: string[] };
            result = {
              success: false,
              durationMs: message.duration_ms,
              costUsd: message.total_cost_usd,
              usage: {
                inputTokens: message.usage.input_tokens,
                outputTokens: message.usage.output_tokens,
              },
              error: errorMsg.errors?.[0] ?? 'Unknown error',
            };
          }
        }
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      onEvent({ type: 'error', message: errorMessage });

      return {
        success: false,
        durationMs: Date.now() - startTime,
        error: errorMessage,
      };
    }
  },
};
