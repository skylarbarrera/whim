/**
 * Harness Integration Tests
 *
 * These tests actually call the SDKs to verify they work correctly.
 * They require API keys to be set:
 * - ANTHROPIC_API_KEY for Claude harness
 * - OPENAI_API_KEY for Codex harness
 *
 * Run with: ANTHROPIC_API_KEY=... OPENAI_API_KEY=... bun test src/harness/integration.test.ts
 *
 * These tests are skipped by default in CI since they require API keys and cost money.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { claudeHarness, codexHarness } from './index.js';
import { opencodeHarness, getHarness } from '@whim/harness';
import type { HarnessEvent } from './types.js';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// Skip tests if no API keys
const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
const hasOpenAIKey = !!process.env.OPENAI_API_KEY;

// Only run these tests when explicitly requested via INTEGRATION_TEST=true
const runIntegration = process.env.INTEGRATION_TEST === 'true';

describe.skipIf(!runIntegration)('Harness Integration Tests', () => {
  let testDir: string;

  beforeAll(async () => {
    // Create a temporary test directory with a simple file
    testDir = await mkdtemp(join(tmpdir(), 'harness-test-'));
    await writeFile(join(testDir, 'test.txt'), 'Hello, World!\n');
    await writeFile(
      join(testDir, 'package.json'),
      JSON.stringify(
        {
          name: 'test-project',
          version: '1.0.0',
        },
        null,
        2
      )
    );
  });

  describe.skipIf(!hasAnthropicKey)('Claude Harness', () => {
    it('should run a simple file read task', async () => {
      const events: HarnessEvent[] = [];

      console.log('\n[Claude] Starting integration test...');
      console.log(`[Claude] Test directory: ${testDir}`);

      const result = await claudeHarness.run(
        'Read the contents of test.txt and tell me what it says. Be brief.',
        {
          cwd: testDir,
          timeoutMs: 60000, // 1 minute timeout
        },
        (event) => {
          events.push(event);
          // Log events for debugging
          if (event.type === 'message') {
            console.log(`[Claude] Message: ${event.text.substring(0, 100)}...`);
          } else if (event.type === 'tool_start') {
            console.log(`[Claude] Tool start: ${event.name}`);
          } else if (event.type === 'tool_end') {
            console.log(`[Claude] Tool end: ${event.name}`);
          } else if (event.type === 'error') {
            console.log(`[Claude] Error: ${event.message}`);
          }
        }
      );

      console.log(`[Claude] Result: success=${result.success}, duration=${result.durationMs}ms`);
      if (result.usage) {
        console.log(
          `[Claude] Tokens: in=${result.usage.inputTokens}, out=${result.usage.outputTokens}`
        );
      }
      if (result.costUsd) {
        console.log(`[Claude] Cost: $${result.costUsd.toFixed(4)}`);
      }
      if (result.error) {
        console.log(`[Claude] Error: ${result.error}`);
      }

      // Verify result
      expect(result.success).toBe(true);
      expect(result.durationMs).toBeGreaterThan(0);

      // Should have received some events
      expect(events.length).toBeGreaterThan(0);

      // Should mention the file contents somewhere
      const hasContentMention =
        events.some((e) => e.type === 'message' && e.text.toLowerCase().includes('hello')) ||
        result.output?.toLowerCase().includes('hello');

      expect(hasContentMention).toBe(true);
    }, 120000); // 2 minute test timeout

    it('should handle errors gracefully', async () => {
      const events: HarnessEvent[] = [];

      console.log('\n[Claude] Testing error handling...');

      const result = await claudeHarness.run(
        'Read a file that does not exist: /nonexistent/path/file.txt',
        {
          cwd: testDir,
          timeoutMs: 60000,
        },
        (event) => events.push(event)
      );

      console.log(`[Claude] Error test result: success=${result.success}`);

      // Should complete (even if the task "failed" in terms of reading the file)
      expect(result.durationMs).toBeGreaterThan(0);
      expect(events.length).toBeGreaterThan(0);
    }, 120000);
  });

  describe.skipIf(!runIntegration)('OpenCode Harness', () => {
    it('should run a simple file read task', async () => {
      const events: HarnessEvent[] = [];

      console.log('\n[OpenCode] Starting integration test...');
      console.log(`[OpenCode] Test directory: ${testDir}`);

      const result = await opencodeHarness.run(
        'Read the contents of test.txt and tell me what it says. Be brief.',
        {
          cwd: testDir,
          timeoutMs: 60000,
        },
        (event) => {
          events.push(event);
          // Log events for debugging
          if (event.type === 'message') {
            console.log(`[OpenCode] Message: ${event.text?.substring(0, 100)}...`);
          } else if (event.type === 'tool_start') {
            console.log(`[OpenCode] Tool start: ${event.name}`);
          } else if (event.type === 'tool_end') {
            console.log(`[OpenCode] Tool end: ${event.name}`);
          } else if (event.type === 'thinking') {
            console.log(`[OpenCode] Thinking: ${event.text?.substring(0, 100)}...`);
          } else if (event.type === 'error') {
            console.log(`[OpenCode] Error: ${event.message}`);
          }
        }
      );

      console.log(`[OpenCode] Result: success=${result.success}, duration=${result.durationMs}ms`);
      if (result.usage) {
        console.log(
          `[OpenCode] Tokens: in=${result.usage.inputTokens}, out=${result.usage.outputTokens}`
        );
      }
      if (result.error) {
        console.log(`[OpenCode] Error: ${result.error}`);
      }

      // Verify result
      expect(result.success).toBe(true);
      expect(result.durationMs).toBeGreaterThan(0);

      // Should have received some events
      expect(events.length).toBeGreaterThan(0);

      // Should mention the file contents somewhere
      const hasContentMention =
        events.some((e) => e.type === 'message' && e.text?.toLowerCase().includes('hello')) ||
        result.output?.toLowerCase().includes('hello');

      expect(hasContentMention).toBe(true);
    }, 120000); // 2 minute test timeout

    it('should handle errors gracefully', async () => {
      const events: HarnessEvent[] = [];

      console.log('\n[OpenCode] Testing error handling...');

      const result = await opencodeHarness.run(
        'Read a file that does not exist: /nonexistent/path/file.txt',
        {
          cwd: testDir,
          timeoutMs: 60000,
        },
        (event) => events.push(event)
      );

      console.log(`[OpenCode] Error test result: success=${result.success}`);

      // Should complete (even if the task "failed" in terms of reading the file)
      expect(result.durationMs).toBeGreaterThan(0);
      expect(events.length).toBeGreaterThan(0);
    }, 120000);
  });

  describe.skipIf(!runIntegration)('OpenCode Harness', () => {
    it('should run a simple file read task', async () => {
      const events: HarnessEvent[] = [];

      console.log('\n[OpenCode] Starting integration test...');
      console.log(`[OpenCode] Test directory: ${testDir}`);

      const result = await opencodeHarness.run(
        'Read the contents of test.txt and tell me what it says. Be brief.',
        {
          cwd: testDir,
          timeoutMs: 60000,
        },
        (event) => {
          events.push(event);
          // Log events for debugging
          if (event.type === 'message') {
            console.log(`[OpenCode] Message: ${event.text?.substring(0, 100)}...`);
          } else if (event.type === 'tool_start') {
            console.log(`[OpenCode] Tool start: ${event.name}`);
          } else if (event.type === 'tool_end') {
            console.log(`[OpenCode] Tool end: ${event.name}`);
          } else if (event.type === 'thinking') {
            console.log(`[OpenCode] Thinking: ${event.text?.substring(0, 100)}...`);
          } else if (event.type === 'error') {
            console.log(`[OpenCode] Error: ${event.message}`);
          }
        }
      );

      console.log(`[OpenCode] Result: success=${result.success}, duration=${result.durationMs}ms`);
      if (result.usage) {
        console.log(
          `[OpenCode] Tokens: in=${result.usage.inputTokens}, out=${result.usage.outputTokens}`
        );
      }
      if (result.error) {
        console.log(`[OpenCode] Error: ${result.error}`);
      }

      // Verify result
      expect(result.success).toBe(true);
      expect(result.durationMs).toBeGreaterThan(0);

      // Should have received some events
      expect(events.length).toBeGreaterThan(0);

      // Should mention the file contents somewhere
      const hasContentMention =
        events.some((e) => e.type === 'message' && e.text?.toLowerCase().includes('hello')) ||
        result.output?.toLowerCase().includes('hello');

      expect(hasContentMention).toBe(true);
    }, 120000); // 2 minute test timeout

    it('should handle errors gracefully', async () => {
      const events: HarnessEvent[] = [];

      console.log('\n[OpenCode] Testing error handling...');

      const result = await opencodeHarness.run(
        'Read a file that does not exist: /nonexistent/path/file.txt',
        {
          cwd: testDir,
          timeoutMs: 60000,
        },
        (event) => events.push(event)
      );

      console.log(`[OpenCode] Error test result: success=${result.success}`);

      // Should complete (even if the task "failed" in terms of reading the file)
      expect(result.durationMs).toBeGreaterThan(0);
      expect(events.length).toBeGreaterThan(0);
    }, 120000);
  });

describe.skipIf(!runIntegration)('OpenCode Harness', () => {
    let openCodeTestDir: string;

    beforeAll(async () => {
      // Create a temporary test directory with a simple file
      openCodeTestDir = await mkdtemp(join(tmpdir(), 'opencode-test-'));
      await writeFile(join(openCodeTestDir, 'test.txt'), 'Hello, World!\n');
      await writeFile(
        join(openCodeTestDir, 'package.json'),
        JSON.stringify(
          {
            name: 'test-project',
            version: '1.0.0',
          },
          null,
          2
        )
      );
    });

    afterAll(async () => {
      if (openCodeTestDir) {
        await rm(openCodeTestDir, { recursive: true, force: true });
      }
    });

    it('should run a simple file read task', async () => {
      const events: HarnessEvent[] = [];

      console.log('\n[OpenCode] Starting integration test...');
      console.log(`[OpenCode] Test directory: ${openCodeTestDir}`);

      const result = await opencodeHarness.run(
        'Read contents of test.txt and tell me what it says. Be brief.',
        {
          cwd: openCodeTestDir,
          timeoutMs: 60000,
        },
        (event) => {
          events.push(event);
          // Log events for debugging
          if (event.type === 'message') {
            console.log(`[OpenCode] Message: ${event.text?.substring(0, 100)}...`);
          } else if (event.type === 'tool_start') {
            console.log(`[OpenCode] Tool start: ${event.name}`);
          } else if (event.type === 'tool_end') {
            console.log(`[OpenCode] Tool end: ${event.name}`);
          } else if (event.type === 'thinking') {
            console.log(`[OpenCode] Thinking: ${event.text?.substring(0, 100)}...`);
          } else if (event.type === 'error') {
            console.log(`[OpenCode] Error: ${event.message}`);
          }
        }
      );

      console.log(`[OpenCode] Result: success=${result.success}, duration=${result.durationMs}ms`);
      if (result.usage) {
        console.log(
          `[OpenCode] Tokens: in=${result.usage.inputTokens}, out=${result.usage.outputTokens}`
        );
      }
      if (result.error) {
        console.log(`[OpenCode] Error: ${result.error}`);
      }

      // Verify result
      expect(result.success).toBe(true);
      expect(result.durationMs).toBeGreaterThan(0);

      // Should have received some events
      expect(events.length).toBeGreaterThan(0);

      // Should mention file contents somewhere
      const hasContentMention = events.some(e =>
        e.type === 'message' && e.text?.toLowerCase().includes('hello')
      ) || (result.output?.toLowerCase().includes('hello'));

      expect(hasContentMention).toBe(true);
    }, 120000); // 2 minute test timeout

    it('should handle errors gracefully', async () => {
      const events: HarnessEvent[] = [];

      console.log('\n[OpenCode] Testing error handling...');

      const result = await opencodeHarness.run(
        'Read a file that does not exist: /nonexistent/path/file.txt',
        {
          cwd: openCodeTestDir,
          timeoutMs: 60000,
        },
        (event) => events.push(event)
      );

      console.log(`[OpenCode] Error test result: success=${result.success}`);

      // Should complete (even if the task "failed" in terms of reading the file)
      expect(result.durationMs).toBeGreaterThan(0);
      expect(events.length).toBeGreaterThan(0);
    }, 120000);
  });
});

// Quick smoke test that just verifies SDK imports work
describe('SDK Import Verification', () => {
  it('should import Claude SDK without errors', async () => {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    expect(typeof query).toBe('function');
  });

  it('should import Codex SDK without errors', async () => {
    const { Codex } = await import('@openai/codex-sdk');
    expect(typeof Codex).toBe('function');
  });

  it('should import OpenCode SDK without errors', async () => {
    const { createOpencode, createOpencodeClient } = await import('@opencode-ai/sdk');
    expect(typeof createOpencode).toBe('function');
    expect(typeof createOpencodeClient).toBe('function');
  });
});
