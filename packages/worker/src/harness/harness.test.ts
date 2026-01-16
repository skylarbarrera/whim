import { describe, it, expect } from 'bun:test';
import { getHarness, claudeHarness, codexHarness } from './index.js';
import type { HarnessName, HarnessEvent, HarnessResult } from './types.js';

describe('Harness', () => {
  describe('getHarness', () => {
    it('should return claude harness by default', () => {
      const harness = getHarness();
      expect(harness.name).toBe('claude');
    });

    it('should return claude harness when specified', () => {
      const harness = getHarness('claude');
      expect(harness.name).toBe('claude');
    });

    it('should return codex harness when specified', () => {
      const harness = getHarness('codex');
      expect(harness.name).toBe('codex');
    });
  });

  describe('claudeHarness', () => {
    it('should have correct name', () => {
      expect(claudeHarness.name).toBe('claude');
    });

    it('should have run method', () => {
      expect(typeof claudeHarness.run).toBe('function');
    });

    it('should fail without ANTHROPIC_API_KEY', async () => {
      const originalKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      const events: HarnessEvent[] = [];
      const result = await claudeHarness.run(
        'test prompt',
        { cwd: '/tmp' },
        (event) => events.push(event)
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('ANTHROPIC_API_KEY');
      expect(events.some(e => e.type === 'error')).toBe(true);

      // Restore
      if (originalKey) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      }
    });
  });

  describe('codexHarness', () => {
    it('should have correct name', () => {
      expect(codexHarness.name).toBe('codex');
    });

    it('should have run method', () => {
      expect(typeof codexHarness.run).toBe('function');
    });

    it('should fail without OPENAI_API_KEY', async () => {
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      const events: HarnessEvent[] = [];
      const result = await codexHarness.run(
        'test prompt',
        { cwd: '/tmp' },
        (event) => events.push(event)
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('OPENAI_API_KEY');
      expect(events.some(e => e.type === 'error')).toBe(true);

      // Restore
      if (originalKey) {
        process.env.OPENAI_API_KEY = originalKey;
      }
    });
  });

  describe('HarnessResult', () => {
    it('should have required fields', () => {
      const result: HarnessResult = {
        success: true,
        durationMs: 1000,
      };
      expect(result.success).toBe(true);
      expect(result.durationMs).toBe(1000);
    });

    it('should support optional fields', () => {
      const result: HarnessResult = {
        success: true,
        durationMs: 1000,
        costUsd: 0.05,
        usage: { inputTokens: 100, outputTokens: 50 },
        output: 'test output',
      };
      expect(result.costUsd).toBe(0.05);
      expect(result.usage?.inputTokens).toBe(100);
      expect(result.output).toBe('test output');
    });
  });

  describe('HarnessEvent types', () => {
    it('should support tool_start event', () => {
      const event: HarnessEvent = { type: 'tool_start', name: 'Bash', input: 'ls' };
      expect(event.type).toBe('tool_start');
    });

    it('should support tool_end event', () => {
      const event: HarnessEvent = { type: 'tool_end', name: 'Bash', output: 'file.txt', error: false };
      expect(event.type).toBe('tool_end');
    });

    it('should support message event', () => {
      const event: HarnessEvent = { type: 'message', text: 'Hello' };
      expect(event.type).toBe('message');
    });

    it('should support thinking event', () => {
      const event: HarnessEvent = { type: 'thinking', text: 'Let me think...' };
      expect(event.type).toBe('thinking');
    });

    it('should support error event', () => {
      const event: HarnessEvent = { type: 'error', message: 'Something went wrong' };
      expect(event.type).toBe('error');
    });
  });
});
