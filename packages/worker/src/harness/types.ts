/**
 * Events emitted by harnesses during execution.
 *
 * Normalized events that work across different AI harnesses (Claude, Codex).
 */
export type HarnessEvent =
  | { type: 'tool_start'; name: string; input?: string }
  | { type: 'tool_end'; name: string; output?: string; error?: boolean }
  | { type: 'thinking'; text: string }
  | { type: 'message'; text: string }
  | { type: 'error'; message: string };

/**
 * Result from running with a harness.
 */
export interface HarnessResult {
  /** Whether the run completed successfully */
  success: boolean;
  /** Duration in milliseconds */
  durationMs: number;
  /** Cost in USD (if available) */
  costUsd?: number;
  /** Token usage */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Error message if failed */
  error?: string;
  /** Final text output */
  output?: string;
}

/**
 * Options for running a harness.
 */
export interface HarnessRunOptions {
  /** Working directory */
  cwd: string;
  /** Allowed tools (optional) */
  allowedTools?: string[];
  /** Model to use (optional) */
  model?: string;
  /** Additional system prompt (optional) */
  systemPrompt?: string;
}

/**
 * Harness interface for AI coding assistants.
 *
 * Each harness wraps an official SDK and emits normalized events.
 */
export interface Harness {
  /** Name of the harness */
  name: string;

  /**
   * Run with the given prompt.
   *
   * @param prompt - The prompt to send
   * @param options - Run options including cwd
   * @param onEvent - Callback for streaming events
   * @returns Result of the run
   */
  run(
    prompt: string,
    options: HarnessRunOptions,
    onEvent: (event: HarnessEvent) => void
  ): Promise<HarnessResult>;
}

export type HarnessName = 'claude' | 'codex';
