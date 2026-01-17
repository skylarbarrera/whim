import { createOpencode, createOpencodeClient } from '@opencode-ai/sdk';
import type { Harness, HarnessEvent, HarnessResult, HarnessRunOptions } from './types.js';

/**
 * OpenCode harness using the official OpenCode SDK.
 *
 * Supports both local server startup and connecting to existing servers.
 * Uses createOpencode for full server management or createOpencodeClient for
 * connecting to existing instances.
 */
export const opencodeHarness: Harness = {
  name: 'opencode',

  async run(
    prompt: string,
    options: HarnessRunOptions,
    onEvent: (event: HarnessEvent) => void
  ): Promise<HarnessResult> {
    const startTime = Date.now();

    try {
      onEvent({ type: 'message', text: 'Starting OpenCode SDK...' });

      // Configuration for OpenCode
      const hostname = process.env.OPENCODE_HOST || '127.0.0.1';
      const port = parseInt(process.env.OPENCODE_PORT || '4096');
      const baseUrl = `http://${hostname}:${port}`;

      let client;
      let server;

      // Try to connect to existing server first
      try {
        onEvent({ type: 'message', text: `Connecting to OpenCode server at ${baseUrl}...` });
        client = createOpencodeClient({ baseUrl });

        // Test connection by trying to list sessions
        await client.session.list();
        onEvent({ type: 'message', text: 'Connected to OpenCode server' });
      } catch (connectError) {
        // If connection fails, try to start a new server
        onEvent({
          type: 'message',
          text: 'No running OpenCode server found, starting new instance...',
        });

        const opencode = await createOpencode({
          hostname,
          port,
          timeout: 10000, // 10 second timeout for server start
          config: {
            model: options.model || 'anthropic/claude-3-5-sonnet-20241022',
          },
        });

        client = opencode.client;
        server = opencode.server;
        onEvent({ type: 'message', text: `Started OpenCode server at ${server.url}` });
      }

      // Create a session for this execution
      onEvent({ type: 'message', text: 'Creating OpenCode session...' });

      const session = await client.session.create({
        body: {
          title: `Whim Task - ${new Date().toISOString()}`,
        },
      });

      if (!session.data) {
        throw new Error('Failed to create session');
      }

      const sessionId = session.data.id;
      onEvent({ type: 'message', text: `Created session: ${sessionId}` });

      // Set up timeout via AbortController
      const abortController = new AbortController();
      const timeoutMs = options.timeoutMs || 300000; // 5 min default
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, timeoutMs);

      let finalOutput = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let success = true;
      let errorMessage: string | undefined;

      try {
        // Send the prompt to OpenCode
        onEvent({ type: 'message', text: 'Sending prompt to OpenCode...' });

        const result = await client.session.prompt({
          path: { id: sessionId },
          body: {
            model: options.model
              ? {
                  providerID: options.model.split('/')[0] || 'anthropic',
                  modelID: options.model,
                }
              : undefined,
            parts: [{ type: 'text', text: prompt }],
            system: options.systemPrompt,
          },
        });

        // Process the response
        if (result.data && result.data.parts) {
          for (const part of result.data.parts) {
            if (part.type === 'text') {
              finalOutput += part.text || '';
              onEvent({ type: 'message', text: part.text || '' });
            } else if (part.type === 'reasoning') {
              onEvent({ type: 'thinking', text: part.text || '' });
            } else if (part.type === 'tool') {
              const toolState = part.state;
              if (toolState.status === 'pending' || toolState.status === 'running') {
                onEvent({
                  type: 'tool_start',
                  name: part.tool || 'unknown',
                  input: toolState.input ? JSON.stringify(toolState.input) : undefined,
                });
              } else if (toolState.status === 'completed' || toolState.status === 'error') {
                onEvent({
                  type: 'tool_end',
                  name: part.tool || 'unknown',
                  output: toolState.status === 'completed' ? toolState.output : undefined,
                  error: toolState.status === 'error',
                });
              }
            } else if (part.type === 'step-start') {
              onEvent({
                type: 'message',
                text: `Step started: ${part.snapshot ? 'with snapshot' : 'no snapshot'}`,
              });
            } else if (part.type === 'step-finish') {
              onEvent({ type: 'message', text: `Step finished: ${part.reason}` });
              inputTokens += part.tokens.input;
              outputTokens += part.tokens.output;
            }
          }
        }

        // Get session messages to extract usage and additional events
        const messages = await client.session.messages({
          path: { id: sessionId },
        });

        // Extract usage from assistant messages
        if (messages.data) {
          for (const messageInfo of messages.data) {
            const message = messageInfo.info;
            if (message && message.role === 'assistant' && message.tokens) {
              inputTokens += message.tokens.input || 0;
              outputTokens += message.tokens.output || 0;
            }
          }
        }
      } catch (promptError) {
        success = false;
        errorMessage = promptError instanceof Error ? promptError.message : String(promptError);
        onEvent({ type: 'error', message: errorMessage });
      }

      clearTimeout(timeoutId);

      // Cleanup session
      try {
        await client.session.delete({
          path: { id: sessionId },
        });
        onEvent({ type: 'message', text: 'Session cleaned up' });
      } catch (cleanupError) {
        // Don't fail the operation if cleanup fails
        console.warn('Failed to cleanup session:', cleanupError);
      }

      // Close server if we started it
      if (server) {
        try {
          server.close();
          onEvent({ type: 'message', text: 'OpenCode server stopped' });
        } catch (closeError) {
          console.warn('Failed to close server:', closeError);
        }
      }

      return {
        success,
        durationMs: Date.now() - startTime,
        usage: inputTokens > 0 || outputTokens > 0 ? { inputTokens, outputTokens } : undefined,
        output: finalOutput,
        error: errorMessage,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check for abort (timeout)
      if (errorMessage.includes('aborted') || errorMessage.includes('abort')) {
        onEvent({ type: 'error', message: `Timeout after ${options.timeoutMs || 300000}ms` });
        return {
          success: false,
          durationMs: Date.now() - startTime,
          error: 'Timeout',
        };
      }

      onEvent({ type: 'error', message: errorMessage });
      return {
        success: false,
        durationMs: Date.now() - startTime,
        error: errorMessage,
      };
    }
  },
};
