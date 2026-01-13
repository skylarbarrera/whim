import { describe, test, expect, beforeEach } from 'bun:test';
import { ReviewExecutor } from '../orchestrator/executor.js';
import type { ReviewStep, ReviewStepConfig } from '../types/review-step.js';
import type { ReviewContext } from '../types/review-context.js';
import type { ReviewStepResult } from '../types/review-result.js';
import { ReviewStatus, ReviewSeverity } from '../types/review-result.js';
import { ExecutionMode, ReviewStepGroup } from '../types/config.js';

// Mock review step for testing
class MockReviewStep implements ReviewStep {
  readonly type: string;
  readonly name: string;
  readonly description: string;
  private delay: number;
  private shouldFail: boolean;
  private shouldError: boolean;

  constructor(
    type: string,
    name: string,
    delay = 0,
    shouldFail = false,
    shouldError = false
  ) {
    this.type = type;
    this.name = name;
    this.description = `Mock step: ${name}`;
    this.delay = delay;
    this.shouldFail = shouldFail;
    this.shouldError = shouldError;
  }

  async initialize(config: ReviewStepConfig): Promise<void> {
    // Mock initialization
  }

  async execute(context: ReviewContext): Promise<ReviewStepResult> {
    if (this.delay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.delay));
    }

    if (this.shouldError) {
      throw new Error(`Mock error from ${this.name}`);
    }

    return {
      stepName: this.name,
      status: this.shouldFail ? ReviewStatus.FAIL : ReviewStatus.PASS,
      messages: this.shouldFail
        ? [
            {
              severity: ReviewSeverity.ERROR,
              message: 'Mock failure message',
            },
          ]
        : [],
      durationMs: this.delay,
      startedAt: new Date(),
      completedAt: new Date(),
    };
  }

  async cleanup(): Promise<void> {
    // Mock cleanup
  }

  validateConfig(config: ReviewStepConfig): string[] {
    return [];
  }
}

// Create mock review context
function createMockContext(): ReviewContext {
  return {
    pr: {
      number: 123,
      title: 'Test PR',
      body: 'Test description',
      owner: 'testowner',
      repo: 'testrepo',
      baseBranch: 'main',
      headBranch: 'feature',
      headSha: 'abc123',
      author: 'testuser',
      labels: ['test', 'ai-generated'],
      isAiGenerated: true,
    },
    changedFiles: [
      {
        path: 'src/test.ts',
        changeType: 'modified',
        additions: 10,
        deletions: 5,
      },
      {
        path: 'src/other.js',
        changeType: 'added',
        additions: 20,
        deletions: 0,
      },
    ],
    workingDirectory: '/tmp/test',
    githubToken: 'mock-token',
    env: {},
    sharedData: {},
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  };
}

// Create mock step config
function createStepConfig(
  id: string,
  name: string,
  blocking = false,
  enabled = true,
  condition?: ReviewStepConfig['condition']
): ReviewStepConfig {
  return {
    id,
    name,
    blocking,
    enabled,
    timeoutMs: 5000,
    condition,
    options: { type: 'mock' },
  };
}

describe('ReviewExecutor', () => {
  let executor: ReviewExecutor;
  let context: ReviewContext;

  beforeEach(() => {
    executor = new ReviewExecutor();
    context = createMockContext();
  });

  describe('executeSequential', () => {
    test('executes steps in order', async () => {
      const executionOrder: string[] = [];

      const step1 = new MockReviewStep('mock', 'step1', 50);
      const step2 = new MockReviewStep('mock', 'step2', 30);
      const step3 = new MockReviewStep('mock', 'step3', 10);

      // Override execute to track order
      const originalExecute1 = step1.execute.bind(step1);
      const originalExecute2 = step2.execute.bind(step2);
      const originalExecute3 = step3.execute.bind(step3);

      step1.execute = async (ctx: ReviewContext) => {
        executionOrder.push('step1-start');
        const result = await originalExecute1(ctx);
        executionOrder.push('step1-end');
        return result;
      };

      step2.execute = async (ctx: ReviewContext) => {
        executionOrder.push('step2-start');
        const result = await originalExecute2(ctx);
        executionOrder.push('step2-end');
        return result;
      };

      step3.execute = async (ctx: ReviewContext) => {
        executionOrder.push('step3-start');
        const result = await originalExecute3(ctx);
        executionOrder.push('step3-end');
        return result;
      };

      const steps = [
        { config: createStepConfig('1', 'step1'), step: step1 },
        { config: createStepConfig('2', 'step2'), step: step2 },
        { config: createStepConfig('3', 'step3'), step: step3 },
      ];

      const results = await executor.executeSequential(steps, context, false);

      expect(results).toHaveLength(3);
      expect(executionOrder).toEqual([
        'step1-start',
        'step1-end',
        'step2-start',
        'step2-end',
        'step3-start',
        'step3-end',
      ]);
    });

    test('stops on blocking failure when continueOnFailure is false', async () => {
      const step1 = new MockReviewStep('mock', 'step1', 0, false);
      const step2 = new MockReviewStep('mock', 'step2', 0, true); // Fails
      const step3 = new MockReviewStep('mock', 'step3', 0, false);

      const steps = [
        { config: createStepConfig('1', 'step1', false), step: step1 },
        { config: createStepConfig('2', 'step2', true), step: step2 }, // Blocking
        { config: createStepConfig('3', 'step3', false), step: step3 },
      ];

      const results = await executor.executeSequential(steps, context, false);

      expect(results).toHaveLength(2); // Only step1 and step2
      expect(results[1].status).toBe(ReviewStatus.FAIL);
    });

    test('continues after blocking failure when continueOnFailure is true', async () => {
      const step1 = new MockReviewStep('mock', 'step1', 0, false);
      const step2 = new MockReviewStep('mock', 'step2', 0, true); // Fails
      const step3 = new MockReviewStep('mock', 'step3', 0, false);

      const steps = [
        { config: createStepConfig('1', 'step1', false), step: step1 },
        { config: createStepConfig('2', 'step2', true), step: step2 }, // Blocking
        { config: createStepConfig('3', 'step3', false), step: step3 },
      ];

      const results = await executor.executeSequential(steps, context, true);

      expect(results).toHaveLength(3); // All steps executed
      expect(results[1].status).toBe(ReviewStatus.FAIL);
      expect(results[2].status).toBe(ReviewStatus.PASS);
    });

    test('stops on error when continueOnFailure is false', async () => {
      const step1 = new MockReviewStep('mock', 'step1', 0, false);
      const step2 = new MockReviewStep('mock', 'step2', 0, false, true); // Errors
      const step3 = new MockReviewStep('mock', 'step3', 0, false);

      const steps = [
        { config: createStepConfig('1', 'step1', false), step: step1 },
        { config: createStepConfig('2', 'step2', false), step: step2 },
        { config: createStepConfig('3', 'step3', false), step: step3 },
      ];

      const results = await executor.executeSequential(steps, context, false);

      expect(results).toHaveLength(2); // Only step1 and step2
      expect(results[1].status).toBe(ReviewStatus.ERROR);
    });
  });

  describe('executeParallel', () => {
    test('executes steps concurrently', async () => {
      const step1 = new MockReviewStep('mock', 'step1', 100);
      const step2 = new MockReviewStep('mock', 'step2', 100);
      const step3 = new MockReviewStep('mock', 'step3', 100);

      const steps = [
        { config: createStepConfig('1', 'step1'), step: step1 },
        { config: createStepConfig('2', 'step2'), step: step2 },
        { config: createStepConfig('3', 'step3'), step: step3 },
      ];

      const startTime = Date.now();
      const results = await executor.executeParallel(steps, context);
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(3);
      // Should take ~100ms for parallel, not 300ms for sequential
      expect(duration).toBeLessThan(200);
      expect(results.every(r => r.status === ReviewStatus.PASS)).toBe(true);
    });

    test('returns all results even if some fail', async () => {
      const step1 = new MockReviewStep('mock', 'step1', 0, false);
      const step2 = new MockReviewStep('mock', 'step2', 0, true); // Fails
      const step3 = new MockReviewStep('mock', 'step3', 0, false);

      const steps = [
        { config: createStepConfig('1', 'step1'), step: step1 },
        { config: createStepConfig('2', 'step2'), step: step2 },
        { config: createStepConfig('3', 'step3'), step: step3 },
      ];

      const results = await executor.executeParallel(steps, context);

      expect(results).toHaveLength(3);
      expect(results[0].status).toBe(ReviewStatus.PASS);
      expect(results[1].status).toBe(ReviewStatus.FAIL);
      expect(results[2].status).toBe(ReviewStatus.PASS);
    });

    test('converts rejected promises to error results', async () => {
      const step1 = new MockReviewStep('mock', 'step1', 0, false);
      const step2 = new MockReviewStep('mock', 'step2', 0, false, true); // Errors
      const step3 = new MockReviewStep('mock', 'step3', 0, false);

      const steps = [
        { config: createStepConfig('1', 'step1'), step: step1 },
        { config: createStepConfig('2', 'step2'), step: step2 },
        { config: createStepConfig('3', 'step3'), step: step3 },
      ];

      const results = await executor.executeParallel(steps, context);

      expect(results).toHaveLength(3);
      expect(results[0].status).toBe(ReviewStatus.PASS);
      expect(results[1].status).toBe(ReviewStatus.ERROR);
      expect(results[1].error?.message).toContain('Mock error');
      expect(results[2].status).toBe(ReviewStatus.PASS);
    });
  });

  describe('executeGroup', () => {
    test('executes sequential group', async () => {
      const step1 = new MockReviewStep('mock', 'step1');
      const step2 = new MockReviewStep('mock', 'step2');

      const steps = new Map<string, ReviewStep>([
        ['1', step1],
        ['2', step2],
      ]);

      const group: ReviewStepGroup = {
        name: 'Test Group',
        mode: ExecutionMode.SEQUENTIAL,
        steps: [
          createStepConfig('1', 'step1'),
          createStepConfig('2', 'step2'),
        ],
        continueOnFailure: false,
      };

      const results = await executor.executeGroup(group, steps, context);

      expect(results).toHaveLength(2);
      expect(results.every(r => r.status === ReviewStatus.PASS)).toBe(true);
    });

    test('executes parallel group', async () => {
      const step1 = new MockReviewStep('mock', 'step1', 50);
      const step2 = new MockReviewStep('mock', 'step2', 50);

      const steps = new Map<string, ReviewStep>([
        ['1', step1],
        ['2', step2],
      ]);

      const group: ReviewStepGroup = {
        name: 'Test Group',
        mode: ExecutionMode.PARALLEL,
        steps: [
          createStepConfig('1', 'step1'),
          createStepConfig('2', 'step2'),
        ],
        continueOnFailure: false,
      };

      const startTime = Date.now();
      const results = await executor.executeGroup(group, steps, context);
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(2);
      expect(duration).toBeLessThan(100); // Parallel execution
    });

    test('skips disabled steps', async () => {
      const step1 = new MockReviewStep('mock', 'step1');
      const step2 = new MockReviewStep('mock', 'step2');

      const steps = new Map<string, ReviewStep>([
        ['1', step1],
        ['2', step2],
      ]);

      const group: ReviewStepGroup = {
        name: 'Test Group',
        mode: ExecutionMode.SEQUENTIAL,
        steps: [
          createStepConfig('1', 'step1', false, true),
          createStepConfig('2', 'step2', false, false), // Disabled
        ],
        continueOnFailure: false,
      };

      const results = await executor.executeGroup(group, steps, context);

      expect(results).toHaveLength(1);
      expect(results[0].stepName).toBe('step1');
    });
  });

  describe('evaluateCondition', () => {
    test('returns true when no condition is specified', async () => {
      const config = createStepConfig('1', 'step1');
      const result = await executor.evaluateCondition(config, context);
      expect(result).toBe(true);
    });

    test('checks AI-generated only condition', async () => {
      const config = createStepConfig('1', 'step1', false, true, {
        aiGeneratedOnly: true,
      });

      const result = await executor.evaluateCondition(config, context);
      expect(result).toBe(true);

      context.pr.isAiGenerated = false;
      const result2 = await executor.evaluateCondition(config, context);
      expect(result2).toBe(false);
    });

    test('checks required labels', async () => {
      const config = createStepConfig('1', 'step1', false, true, {
        requiredLabels: ['test', 'ai-generated'],
      });

      const result = await executor.evaluateCondition(config, context);
      expect(result).toBe(true);

      const config2 = createStepConfig('1', 'step1', false, true, {
        requiredLabels: ['missing-label'],
      });

      const result2 = await executor.evaluateCondition(config2, context);
      expect(result2).toBe(false);
    });

    test('checks excluded labels', async () => {
      const config = createStepConfig('1', 'step1', false, true, {
        excludedLabels: ['wip'],
      });

      const result = await executor.evaluateCondition(config, context);
      expect(result).toBe(true);

      context.pr.labels.push('wip');
      const result2 = await executor.evaluateCondition(config, context);
      expect(result2).toBe(false);
    });

    test('checks file patterns', async () => {
      const config = createStepConfig('1', 'step1', false, true, {
        filePatterns: ['src/*.ts'],
      });

      const result = await executor.evaluateCondition(config, context);
      expect(result).toBe(true);

      const config2 = createStepConfig('1', 'step1', false, true, {
        filePatterns: ['docs/*.md'],
      });

      const result2 = await executor.evaluateCondition(config2, context);
      expect(result2).toBe(false);
    });

    test('handles wildcard patterns', async () => {
      const config = createStepConfig('1', 'step1', false, true, {
        filePatterns: ['**/*.ts'],
      });

      const result = await executor.evaluateCondition(config, context);
      expect(result).toBe(true);
    });
  });
});
