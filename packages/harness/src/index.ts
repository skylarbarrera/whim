/**
 * @whim/harness - AI Harness Abstraction
 *
 * Provides a unified interface for running AI agents (Claude, Codex, OpenCode).
 * Each harness wraps an official SDK and emits normalized events.
 *
 * @example
 * ```typescript
 * import { getHarness } from '@whim/harness';
 *
 * const harness = getHarness('claude');
 * const result = await harness.run(
 *   'Write a hello world function',
 *   { cwd: '/workspace' },
 *   (event) => console.log(event)
 * );
 * ```
 */

export * from './types.js';

import type { Harness, HarnessName } from './types.js';
import { claudeHarness } from './claude.js';
import { codexHarness } from './codex.js';
import { opencodeHarness } from './opencode.js';

/**
 * Get a harness by name.
 *
 * @param name - The harness name ('claude', 'codex', or 'opencode')
 * @returns The harness implementation
 */
export function getHarness(name: HarnessName = 'claude'): Harness {
  switch (name) {
    case 'claude':
      return claudeHarness;
    case 'codex':
      return codexHarness;
    case 'opencode':
      return opencodeHarness;
    default:
      // Should never happen with TypeScript, but provide fallback
      return claudeHarness;
  }
}

export { claudeHarness } from './claude.js';
export { codexHarness } from './codex.js';
export { opencodeHarness } from './opencode.js';
