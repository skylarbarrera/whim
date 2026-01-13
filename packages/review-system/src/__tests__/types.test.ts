import { describe, test, expect } from 'bun:test';
import {
  ReviewStatus,
  ReviewSeverity,
  type ReviewMessage,
  type ReviewStepResult,
  type ReviewWorkflowResult,
} from '../types/review-result.js';
import type { ReviewContext, PullRequestInfo, ChangedFile } from '../types/review-context.js';
import type { ReviewStepConfig } from '../types/review-step.js';
import type { ReviewWorkflowConfig, ExecutionMode } from '../types/config.js';

describe('Type Definitions', () => {
  describe('ReviewStatus enum', () => {
    test('should have all expected values', () => {
      expect(ReviewStatus.PASS as string).toBe('pass');
      expect(ReviewStatus.FAIL as string).toBe('fail');
      expect(ReviewStatus.ERROR as string).toBe('error');
      expect(ReviewStatus.SKIPPED as string).toBe('skipped');
      expect(ReviewStatus.PENDING as string).toBe('pending');
    });
  });

  describe('ReviewSeverity enum', () => {
    test('should have all expected values', () => {
      expect(ReviewSeverity.INFO as string).toBe('info');
      expect(ReviewSeverity.WARNING as string).toBe('warning');
      expect(ReviewSeverity.ERROR as string).toBe('error');
    });
  });

  describe('ReviewMessage', () => {
    test('should accept valid message with all fields', () => {
      const message: ReviewMessage = {
        severity: ReviewSeverity.ERROR,
        message: 'Missing semicolon',
        file: 'src/index.ts',
        line: 42,
        column: 15,
        suggestion: 'Add semicolon at end of line',
        ruleId: 'semi',
      };
      expect(message.severity).toBe(ReviewSeverity.ERROR);
      expect(message.file).toBe('src/index.ts');
    });

    test('should accept message with only required fields', () => {
      const message: ReviewMessage = {
        severity: ReviewSeverity.INFO,
        message: 'All checks passed',
      };
      expect(message.severity).toBe(ReviewSeverity.INFO);
    });
  });

  describe('ReviewStepResult', () => {
    test('should accept valid step result', () => {
      const now = new Date();
      const result: ReviewStepResult = {
        stepName: 'lint',
        status: ReviewStatus.PASS,
        messages: [],
        durationMs: 1500,
        startedAt: now,
        completedAt: new Date(now.getTime() + 1500),
      };
      expect(result.stepName).toBe('lint');
      expect(result.durationMs).toBe(1500);
    });

    test('should accept result with error details', () => {
      const result: ReviewStepResult = {
        stepName: 'test',
        status: ReviewStatus.ERROR,
        messages: [],
        durationMs: 500,
        startedAt: new Date(),
        completedAt: new Date(),
        error: {
          message: 'Test runner crashed',
          stack: 'Error: Test runner crashed\n  at ...',
          code: 'ENOENT',
        },
      };
      expect(result.error?.message).toBe('Test runner crashed');
    });
  });

  describe('ReviewWorkflowResult', () => {
    test('should accept valid workflow result', () => {
      const result: ReviewWorkflowResult = {
        status: ReviewStatus.PASS,
        stepResults: [],
        totalDurationMs: 5000,
        startedAt: new Date(),
        completedAt: new Date(),
        summary: {
          totalSteps: 3,
          passedSteps: 3,
          failedSteps: 0,
          errorSteps: 0,
          skippedSteps: 0,
        },
      };
      expect(result.summary.totalSteps).toBe(3);
    });
  });

  describe('ChangedFile', () => {
    test('should accept valid changed file', () => {
      const file: ChangedFile = {
        path: 'src/app.ts',
        changeType: 'modified',
        additions: 10,
        deletions: 5,
        content: 'export function hello() {}',
        patch: '@@ -1,5 +1,10 @@',
      };
      expect(file.changeType).toBe('modified');
    });

    test('should accept renamed file', () => {
      const file: ChangedFile = {
        path: 'src/new-name.ts',
        changeType: 'renamed',
        additions: 0,
        deletions: 0,
        previousPath: 'src/old-name.ts',
      };
      expect(file.previousPath).toBe('src/old-name.ts');
    });
  });

  describe('PullRequestInfo', () => {
    test('should accept PR info with AI context', () => {
      const pr: PullRequestInfo = {
        number: 123,
        title: 'Add new feature',
        body: 'This PR adds a new feature',
        owner: 'acme',
        repo: 'project',
        baseBranch: 'main',
        headBranch: 'feature/new',
        headSha: 'abc123',
        author: 'bot',
        labels: ['ai-generated', 'enhancement'],
        isAiGenerated: true,
        aiContext: {
          model: 'claude-sonnet-4.5',
          prompts: ['Create a new feature'],
          generatedAt: new Date(),
          generatorVersion: '1.0.0',
        },
      };
      expect(pr.isAiGenerated).toBe(true);
      expect(pr.aiContext?.model).toBe('claude-sonnet-4.5');
    });
  });

  describe('ReviewContext', () => {
    test('should accept valid review context', () => {
      const context: ReviewContext = {
        pr: {
          number: 123,
          title: 'Test PR',
          body: 'Test',
          owner: 'test',
          repo: 'test',
          baseBranch: 'main',
          headBranch: 'feature',
          headSha: 'abc',
          author: 'user',
          labels: [],
          isAiGenerated: false,
        },
        changedFiles: [],
        workingDirectory: '/tmp/review',
        githubToken: 'ghp_token',
        env: { NODE_ENV: 'test' },
        sharedData: {},
        logger: {
          info: (msg: string) => {},
          warn: (msg: string) => {},
          error: (msg: string) => {},
          debug: (msg: string) => {},
        },
      };
      expect(context.workingDirectory).toBe('/tmp/review');
    });
  });

  describe('ReviewStepConfig', () => {
    test('should accept valid step config', () => {
      const config: ReviewStepConfig = {
        id: 'lint-1',
        name: 'ESLint',
        blocking: true,
        enabled: true,
        timeoutMs: 30000,
        options: {
          configFile: '.eslintrc.json',
        },
      };
      expect(config.blocking).toBe(true);
    });

    test('should accept config with conditions', () => {
      const config: ReviewStepConfig = {
        id: 'test-1',
        name: 'Unit Tests',
        blocking: true,
        enabled: true,
        timeoutMs: 60000,
        options: {},
        condition: {
          requiredLabels: ['needs-tests'],
          filePatterns: ['**/*.test.ts'],
          aiGeneratedOnly: true,
        },
      };
      expect(config.condition?.aiGeneratedOnly).toBe(true);
    });
  });
});
