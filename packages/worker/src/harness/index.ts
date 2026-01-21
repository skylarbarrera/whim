/**
 * Re-export harness from @whim/harness package.
 *
 * This maintains backward compatibility for existing imports.
 */
export * from '@whim/harness';

// Also export opencodeHarness for direct import in tests
import { opencodeHarness } from '@whim/harness';
export { opencodeHarness };
