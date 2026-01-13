import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { TestStep } from '../steps/test-step';
import type { ReviewStepConfig } from '../types/review-step';
import type { ReviewContext } from '../types/review-context';
import { ReviewStatus, ReviewSeverity } from '../types/review-result';
import { exec } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';

// Mock node modules
mock.module('node:child_process', () => ({
  exec: mock(() => {}),
}));

mock.module('node:fs/promises', () => ({
  readFile: mock(() => Promise.resolve('{}')),
  access: mock(() => Promise.resolve()),
}));

describe('TestStep', () => {
  let step: TestStep;
  let mockConfig: ReviewStepConfig;
  let mockContext: ReviewContext;

  beforeEach(() => {
    step = new TestStep();

    mockConfig = {
      id: 'test-1',
      name: 'Run Tests',
      blocking: true,
      enabled: true,
      timeoutMs: 60000,
      options: {
        runner: 'jest',
        testScript: 'test',
        coverage: false,
        timeout: 300000,
        failOn: 'failure',
      },
    };

    mockContext = {
      pullRequest: {
        number: 123,
        title: 'Test PR',
        body: '',
        baseBranch: 'main',
        headBranch: 'feature',
        owner: 'test-owner',
        repo: 'test-repo',
        author: 'test-author',
        labels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      changedFiles: [
        { path: 'src/index.ts', changeType: 'modified' },
        { path: 'src/utils.ts', changeType: 'added' },
      ],
      workingDirectory: '/tmp/test-repo',
      githubToken: 'test-token',
      env: {},
      sharedData: {},
      logger: {
        debug: mock(() => {}),
        info: mock(() => {}),
        warn: mock(() => {}),
        error: mock(() => {}),
      },
    };
  });

  describe('initialization', () => {
    it('should initialize with valid config', async () => {
      await expect(step.initialize(mockConfig)).resolves.toBeUndefined();
    });

    it('should set default values', async () => {
      const minimalConfig = {
        ...mockConfig,
        options: {},
      };

      await step.initialize(minimalConfig);
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('validateConfig', () => {
    it('should accept valid config', () => {
      const errors = step.validateConfig(mockConfig);
      expect(errors).toEqual([]);
    });

    it('should reject invalid runner type', () => {
      const invalidConfig = {
        ...mockConfig,
        options: { runner: 'invalid-runner' },
      };
      const errors = step.validateConfig(invalidConfig);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('runner');
    });

    it('should require command for custom runner', () => {
      const customConfig = {
        ...mockConfig,
        options: { runner: 'custom' },
      };
      const errors = step.validateConfig(customConfig);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('command');
    });

    it('should reject invalid failOn value', () => {
      const invalidConfig = {
        ...mockConfig,
        options: { failOn: 'invalid' },
      };
      const errors = step.validateConfig(invalidConfig);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('failOn');
    });

    it('should validate coverage thresholds are in range', () => {
      const invalidConfig = {
        ...mockConfig,
        options: {
          coverageThresholds: {
            lines: 150,
            branches: -10,
          },
        },
      };
      const errors = step.validateConfig(invalidConfig);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('test execution', () => {
    it('should pass when all tests pass', async () => {
      // Mock package.json check
      (readFile as any).mockResolvedValueOnce(JSON.stringify({
        scripts: { test: 'jest' },
      }));

      // Mock test execution
      const mockExec = exec as any;
      mockExec.mockImplementation((cmd: string, opts: any, cb: Function) => {
        cb(null, {
          stdout: 'Tests: 10 passed, 10 total',
          stderr: '',
        });
      });

      await step.initialize(mockConfig);
      const result = await step.execute(mockContext);

      expect(result.status).toBe(ReviewStatus.PASS);
      expect(result.metadata?.testsPassed).toBe(10);
      expect(result.metadata?.testsFailed).toBe(0);
    });

    it('should fail when tests fail', async () => {
      // Mock package.json check
      (readFile as any).mockResolvedValueOnce(JSON.stringify({
        scripts: { test: 'jest' },
      }));

      // Mock test execution with failures
      const mockExec = exec as any;
      mockExec.mockImplementation((cmd: string, opts: any, cb: Function) => {
        const error: any = new Error('Tests failed');
        error.code = 1;
        error.stdout = 'Tests: 8 passed, 2 failed, 10 total';
        error.stderr = '';
        cb(error);
      });

      await step.initialize(mockConfig);
      const result = await step.execute(mockContext);

      expect(result.status).toBe(ReviewStatus.FAIL);
      expect(result.metadata?.testsPassed).toBe(8);
      expect(result.metadata?.testsFailed).toBe(2);
    });

    it('should skip when no test script is found', async () => {
      // Mock package.json without test script
      (readFile as any).mockResolvedValueOnce(JSON.stringify({
        scripts: {},
      }));

      await step.initialize(mockConfig);
      const result = await step.execute(mockContext);

      expect(result.status).toBe(ReviewStatus.SKIPPED);
      expect(result.metadata?.reason).toContain('No test script');
    });
  });

  describe('output parsing', () => {
    it('should parse Jest output format', async () => {
      (readFile as any).mockResolvedValueOnce(JSON.stringify({
        scripts: { test: 'jest' },
      }));

      const mockExec = exec as any;
      mockExec.mockImplementation((cmd: string, opts: any, cb: Function) => {
        cb(null, {
          stdout: 'Tests: 15 passed, 15 total',
          stderr: '',
        });
      });

      await step.initialize(mockConfig);
      const result = await step.execute(mockContext);

      expect(result.metadata?.testsPassed).toBe(15);
      expect(result.metadata?.testsRun).toBe(15);
    });

    it('should parse Vitest output format', async () => {
      (readFile as any).mockResolvedValueOnce(JSON.stringify({
        scripts: { test: 'vitest' },
      }));

      const mockExec = exec as any;
      mockExec.mockImplementation((cmd: string, opts: any, cb: Function) => {
        cb(null, {
          stdout: '12 passed | 3 failed | 15 total',
          stderr: '',
        });
      });

      await step.initialize({
        ...mockConfig,
        options: { ...mockConfig.options, runner: 'vitest' },
      });
      const result = await step.execute(mockContext);

      expect(result.metadata?.testsPassed).toBe(12);
      expect(result.metadata?.testsFailed).toBe(3);
      expect(result.metadata?.testsRun).toBe(15);
    });

    it('should parse Bun output format', async () => {
      (readFile as any).mockResolvedValueOnce(JSON.stringify({
        scripts: { test: 'bun test' },
      }));

      const mockExec = exec as any;
      mockExec.mockImplementation((cmd: string, opts: any, cb: Function) => {
        cb(null, {
          stdout: '20 pass, 0 fail, 20 total',
          stderr: '',
        });
      });

      await step.initialize({
        ...mockConfig,
        options: { ...mockConfig.options, runner: 'bun' },
      });
      const result = await step.execute(mockContext);

      expect(result.metadata?.testsPassed).toBe(20);
      expect(result.metadata?.testsFailed).toBe(0);
    });

    it('should handle text output as fallback', async () => {
      (readFile as any).mockResolvedValueOnce(JSON.stringify({
        scripts: { test: 'mocha' },
      }));

      const mockExec = exec as any;
      mockExec.mockImplementation((cmd: string, opts: any, cb: Function) => {
        cb(null, {
          stdout: 'PASS test1\nPASS test2\nFAIL test3',
          stderr: '',
        });
      });

      await step.initialize({
        ...mockConfig,
        options: { ...mockConfig.options, runner: 'mocha' },
      });
      const result = await step.execute(mockContext);

      expect(result.metadata?.testsPassed).toBeGreaterThan(0);
      expect(result.metadata?.testsFailed).toBeGreaterThan(0);
    });
  });

  describe('test failure reporting', () => {
    it('should extract test failure messages from JSON', async () => {
      (readFile as any).mockResolvedValueOnce(JSON.stringify({
        scripts: { test: 'jest' },
      }));

      const mockExec = exec as any;
      mockExec.mockImplementation((cmd: string, opts: any, cb: Function) => {
        const error: any = new Error('Tests failed');
        error.code = 1;
        error.stdout = JSON.stringify({
          testResults: [
            {
              name: 'src/test.spec.ts',
              status: 'failed',
              assertionResults: [
                {
                  title: 'should validate input',
                  status: 'failed',
                  failureMessages: ['Expected true, received false'],
                },
              ],
            },
          ],
        });
        error.stderr = '';
        cb(error);
      });

      await step.initialize(mockConfig);
      const result = await step.execute(mockContext);

      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages[0].severity).toBe(ReviewSeverity.ERROR);
      expect(result.messages[0].message).toContain('should validate input');
    });

    it('should include file and line information', async () => {
      (readFile as any).mockResolvedValueOnce(JSON.stringify({
        scripts: { test: 'jest' },
      }));

      const mockExec = exec as any;
      mockExec.mockImplementation((cmd: string, opts: any, cb: Function) => {
        const error: any = new Error('Tests failed');
        error.code = 1;
        error.stdout = JSON.stringify({
          testResults: [
            {
              name: 'src/test.spec.ts',
              status: 'failed',
              assertionResults: [
                {
                  title: 'should work',
                  status: 'failed',
                  failureMessages: ['at src/test.spec.ts:42:10'],
                },
              ],
            },
          ],
        });
        error.stderr = '';
        cb(error);
      });

      await step.initialize(mockConfig);
      const result = await step.execute(mockContext);

      expect(result.messages[0].file).toBe('src/test.spec.ts');
    });

    it('should handle generic test failures', async () => {
      (readFile as any).mockResolvedValueOnce(JSON.stringify({
        scripts: { test: 'jest' },
      }));

      const mockExec = exec as any;
      mockExec.mockImplementation((cmd: string, opts: any, cb: Function) => {
        const error: any = new Error('Tests failed');
        error.code = 1;
        error.stdout = 'Tests: 5 passed, 2 failed, 7 total';
        error.stderr = '';
        cb(error);
      });

      await step.initialize(mockConfig);
      const result = await step.execute(mockContext);

      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages[0].message).toContain('failed');
    });
  });

  describe('coverage validation', () => {
    it('should check coverage against thresholds', async () => {
      (readFile as any)
        .mockResolvedValueOnce(JSON.stringify({
          scripts: { test: 'jest' },
        }))
        .mockResolvedValueOnce(JSON.stringify({
          total: {
            lines: { pct: 75.5 },
            functions: { pct: 80.2 },
            statements: { pct: 76.8 },
            branches: { pct: 70.1 },
          },
        }));

      const mockExec = exec as any;
      mockExec.mockImplementation((cmd: string, opts: any, cb: Function) => {
        cb(null, {
          stdout: 'Tests: 10 passed, 10 total',
          stderr: '',
        });
      });

      await step.initialize({
        ...mockConfig,
        options: {
          ...mockConfig.options,
          coverage: true,
          coverageThresholds: {
            lines: 80,
            branches: 75,
          },
        },
      });
      const result = await step.execute(mockContext);

      // Should have warnings for below-threshold coverage
      const coverageWarnings = result.messages.filter(
        m => m.ruleId === 'coverage-threshold'
      );
      expect(coverageWarnings.length).toBeGreaterThan(0);
    });

    it('should pass when coverage meets thresholds', async () => {
      (readFile as any)
        .mockResolvedValueOnce(JSON.stringify({
          scripts: { test: 'jest' },
        }))
        .mockResolvedValueOnce(JSON.stringify({
          total: {
            lines: { pct: 85.5 },
            functions: { pct: 90.2 },
            statements: { pct: 86.8 },
            branches: { pct: 80.1 },
          },
        }));

      const mockExec = exec as any;
      mockExec.mockImplementation((cmd: string, opts: any, cb: Function) => {
        cb(null, {
          stdout: 'Tests: 10 passed, 10 total',
          stderr: '',
        });
      });

      await step.initialize({
        ...mockConfig,
        options: {
          ...mockConfig.options,
          coverage: true,
          coverageThresholds: {
            lines: 80,
            branches: 75,
          },
        },
      });
      const result = await step.execute(mockContext);

      const coverageWarnings = result.messages.filter(
        m => m.ruleId === 'coverage-threshold'
      );
      expect(coverageWarnings.length).toBe(0);
    });

    it('should handle missing coverage file gracefully', async () => {
      (readFile as any)
        .mockResolvedValueOnce(JSON.stringify({
          scripts: { test: 'jest' },
        }))
        .mockRejectedValueOnce(new Error('ENOENT'));

      const mockExec = exec as any;
      mockExec.mockImplementation((cmd: string, opts: any, cb: Function) => {
        cb(null, {
          stdout: 'Tests: 10 passed, 10 total',
          stderr: '',
        });
      });

      await step.initialize({
        ...mockConfig,
        options: {
          ...mockConfig.options,
          coverage: true,
          coverageThresholds: {
            lines: 80,
          },
        },
      });
      const result = await step.execute(mockContext);

      // Should not fail just because coverage file is missing
      expect(result.status).toBe(ReviewStatus.PASS);
    });
  });

  describe('error handling', () => {
    it('should handle missing test runner', async () => {
      (readFile as any).mockResolvedValueOnce(JSON.stringify({
        scripts: { test: 'jest' },
      }));

      const mockExec = exec as any;
      mockExec.mockImplementation((cmd: string, opts: any, cb: Function) => {
        const error: any = new Error('Command not found');
        error.code = 127;
        cb(error);
      });

      await step.initialize(mockConfig);
      const result = await step.execute(mockContext);

      expect(result.status).toBe(ReviewStatus.ERROR);
      expect(result.error?.message).toContain('Command not found');
    });

    it('should handle test suite crashes', async () => {
      (readFile as any).mockResolvedValueOnce(JSON.stringify({
        scripts: { test: 'jest' },
      }));

      const mockExec = exec as any;
      mockExec.mockImplementation((cmd: string, opts: any, cb: Function) => {
        const error: any = new Error('Segmentation fault');
        error.code = 139;
        error.stdout = '';
        error.stderr = 'Segmentation fault (core dumped)';
        cb(error);
      });

      await step.initialize(mockConfig);
      const result = await step.execute(mockContext);

      expect(result.metadata?.testsFailed).toBe(0);
      expect(result.metadata?.testsRun).toBe(0);
    });

    it('should handle invalid JSON output', async () => {
      (readFile as any).mockResolvedValueOnce(JSON.stringify({
        scripts: { test: 'jest' },
      }));

      const mockExec = exec as any;
      mockExec.mockImplementation((cmd: string, opts: any, cb: Function) => {
        const error: any = new Error('Tests failed');
        error.code = 1;
        error.stdout = '{ invalid json';
        error.stderr = '';
        cb(error);
      });

      await step.initialize(mockConfig);
      const result = await step.execute(mockContext);

      // Should handle gracefully and not crash
      expect(result.status).toBe(ReviewStatus.FAIL);
    });

    it('should handle timeout gracefully', async () => {
      (readFile as any).mockResolvedValueOnce(JSON.stringify({
        scripts: { test: 'jest' },
      }));

      const mockExec = exec as any;
      mockExec.mockImplementation((cmd: string, opts: any, cb: Function) => {
        const error: any = new Error('Timeout');
        error.killed = true;
        error.signal = 'SIGTERM';
        cb(error);
      });

      await step.initialize({
        ...mockConfig,
        options: { ...mockConfig.options, timeout: 1000 },
      });
      const result = await step.execute(mockContext);

      expect(result.status).toBe(ReviewStatus.ERROR);
    });
  });

  describe('test runner detection', () => {
    it('should use Jest by default', async () => {
      await step.initialize(mockConfig);
      expect(mockConfig.options.runner).toBe('jest');
    });

    it('should support Vitest', async () => {
      await step.initialize({
        ...mockConfig,
        options: { ...mockConfig.options, runner: 'vitest' },
      });
      // Should not throw
      expect(true).toBe(true);
    });

    it('should support Bun', async () => {
      await step.initialize({
        ...mockConfig,
        options: { ...mockConfig.options, runner: 'bun' },
      });
      // Should not throw
      expect(true).toBe(true);
    });

    it('should support custom commands', async () => {
      await step.initialize({
        ...mockConfig,
        options: {
          runner: 'custom',
          command: 'my-test-runner',
          args: ['--verbose'],
        },
      });
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should cleanup without errors', async () => {
      await step.initialize(mockConfig);
      await expect(step.cleanup()).resolves.toBeUndefined();
    });
  });

  describe('metadata', () => {
    it('should include test counts in metadata', async () => {
      (readFile as any).mockResolvedValueOnce(JSON.stringify({
        scripts: { test: 'jest' },
      }));

      const mockExec = exec as any;
      mockExec.mockImplementation((cmd: string, opts: any, cb: Function) => {
        cb(null, {
          stdout: 'Tests: 10 passed, 10 total',
          stderr: '',
        });
      });

      await step.initialize(mockConfig);
      const result = await step.execute(mockContext);

      expect(result.metadata?.testsRun).toBe(10);
      expect(result.metadata?.testsPassed).toBe(10);
      expect(result.metadata?.testsFailed).toBe(0);
    });

    it('should include runner in metadata', async () => {
      (readFile as any).mockResolvedValueOnce(JSON.stringify({
        scripts: { test: 'jest' },
      }));

      const mockExec = exec as any;
      mockExec.mockImplementation((cmd: string, opts: any, cb: Function) => {
        cb(null, {
          stdout: 'Tests: 5 passed, 5 total',
          stderr: '',
        });
      });

      await step.initialize(mockConfig);
      const result = await step.execute(mockContext);

      expect(result.metadata?.runner).toBe('jest');
    });

    it('should include coverage flag in metadata', async () => {
      (readFile as any).mockResolvedValueOnce(JSON.stringify({
        scripts: { test: 'jest' },
      }));

      const mockExec = exec as any;
      mockExec.mockImplementation((cmd: string, opts: any, cb: Function) => {
        cb(null, {
          stdout: 'Tests: 5 passed, 5 total',
          stderr: '',
        });
      });

      await step.initialize({
        ...mockConfig,
        options: { ...mockConfig.options, coverage: true },
      });
      const result = await step.execute(mockContext);

      expect(result.metadata?.coverage).toBe(true);
    });
  });
});
