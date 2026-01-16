import { Codex } from '@openai/codex-sdk';
import type { Harness, HarnessEvent, HarnessResult, HarnessRunOptions } from './types.js';

/**
 * Codex harness using the official OpenAI Codex SDK.
 *
 * Wraps the SDK's Thread.runStreamed() and emits normalized events.
 */
export const codexHarness: Harness = {
  name: 'codex',

  async run(
    prompt: string,
    options: HarnessRunOptions,
    onEvent: (event: HarnessEvent) => void
  ): Promise<HarnessResult> {
    const startTime = Date.now();

    if (!process.env.OPENAI_API_KEY) {
      const errorMessage = 'Missing OPENAI_API_KEY environment variable';
      onEvent({ type: 'error', message: errorMessage });
      return {
        success: false,
        durationMs: Date.now() - startTime,
        error: errorMessage,
      };
    }

    try {
      const codex = new Codex();
      const thread = codex.startThread({
        workingDirectory: options.cwd,
        model: options.model,
        approvalPolicy: 'never',
        sandboxMode: 'workspace-write',
      });

      const { events } = await thread.runStreamed(prompt);

      let result: HarnessResult = {
        success: false,
        durationMs: 0,
        error: 'No result received',
      };

      let collectedOutput = '';

      for await (const event of events) {
        switch (event.type) {
          case 'item.started':
          case 'item.updated': {
            const item = event.item;
            if (item.type === 'command_execution') {
              onEvent({
                type: 'tool_start',
                name: 'Bash',
                input: item.command,
              });
            } else if (item.type === 'mcp_tool_call') {
              onEvent({
                type: 'tool_start',
                name: item.tool,
                input: JSON.stringify(item.arguments),
              });
            } else if (item.type === 'reasoning') {
              onEvent({
                type: 'thinking',
                text: item.text,
              });
            } else if (item.type === 'agent_message') {
              onEvent({
                type: 'message',
                text: item.text,
              });
            }
            break;
          }

          case 'item.completed': {
            const item = event.item;
            if (item.type === 'command_execution') {
              onEvent({
                type: 'tool_end',
                name: 'Bash',
                output: item.aggregated_output,
                error: item.status === 'failed',
              });
            } else if (item.type === 'mcp_tool_call') {
              onEvent({
                type: 'tool_end',
                name: item.tool,
                output: item.result
                  ? JSON.stringify(item.result.content)
                  : item.error?.message,
                error: item.status === 'failed',
              });
            } else if (item.type === 'file_change') {
              onEvent({
                type: 'tool_end',
                name: 'FileChange',
                output: item.changes.map((c: { kind: string; path: string }) => `${c.kind}: ${c.path}`).join('\n'),
                error: item.status === 'failed',
              });
            } else if (item.type === 'agent_message') {
              collectedOutput = item.text;
            } else if (item.type === 'error') {
              onEvent({
                type: 'error',
                message: item.message,
              });
            }
            break;
          }

          case 'turn.completed': {
            result = {
              success: true,
              durationMs: Date.now() - startTime,
              usage: event.usage ? {
                inputTokens: event.usage.input_tokens,
                outputTokens: event.usage.output_tokens,
              } : undefined,
              output: collectedOutput || undefined,
            };
            break;
          }

          case 'turn.failed': {
            result = {
              success: false,
              durationMs: Date.now() - startTime,
              error: event.error.message,
            };
            break;
          }

          case 'error': {
            onEvent({
              type: 'error',
              message: event.message,
            });
            result = {
              success: false,
              durationMs: Date.now() - startTime,
              error: event.message,
            };
            break;
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
