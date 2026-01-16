export * from './types.js';

import type { Harness, HarnessName } from './types.js';
import { claudeHarness } from './claude.js';
import { codexHarness } from './codex.js';

/**
 * Get a harness by name.
 *
 * @param name - The harness name ('claude' or 'codex')
 * @returns The harness implementation
 */
export function getHarness(name: HarnessName = 'claude'): Harness {
  switch (name) {
    case 'claude':
      return claudeHarness;
    case 'codex':
      return codexHarness;
  }
}

export { claudeHarness } from './claude.js';
export { codexHarness } from './codex.js';
