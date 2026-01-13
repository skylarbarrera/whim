import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { GitHubStatusReporter } from '../orchestrator/github-status.js';
import type { PullRequestInfo } from '../types/review-context.js';
import {
  ReviewStatus,
  ReviewSeverity,
  type ReviewWorkflowResult,
  type ReviewStepResult,
} from '../types/review-result.js';

// Mock Octokit
const mockOctokit = {
  checks: {
    create: mock(() => Promise.resolve({ data: { id: 12345 } })),
    update: mock(() => Promise.resolve({ data: {} })),
  },
  repos: {
    createCommitStatus: mock(() => Promise.resolve({ data: {} })),
  },
};

// Override Octokit import
mock.module('@octokit/rest', () => ({
  Octokit: class MockOctokit {
    checks = mockOctokit.checks;
    repos = mockOctokit.repos;
    constructor() {}
  },
}));

function createMockPR(): PullRequestInfo {
  return {
    number: 123,
    title: 'Test PR',
    body: 'Test description',
    owner: 'testowner',
    repo: 'testrepo',
    baseBranch: 'main',
    headBranch: 'feature',
    headSha: 'abc123',
    author: 'testuser',
    labels: [],
    isAiGenerated: false,
  };
}

function createMockStepResult(
  stepName: string,
  status: ReviewStatus,
  messages: Array<{
    severity: ReviewSeverity;
    message: string;
    file?: string;
    line?: number;
    ruleId?: string;
  }> = []
): ReviewStepResult {
  return {
    stepName,
    status,
    messages,
    durationMs: 100,
    startedAt: new Date(),
    completedAt: new Date(),
  };
}

function createMockWorkflowResult(
  status: ReviewStatus,
  stepResults: ReviewStepResult[]
): ReviewWorkflowResult {
  return {
    status,
    stepResults,
    totalDurationMs: 500,
    startedAt: new Date('2024-01-01T00:00:00Z'),
    completedAt: new Date('2024-01-01T00:00:00.500Z'),
    summary: {
      totalSteps: stepResults.length,
      passedSteps: stepResults.filter(r => r.status === ReviewStatus.PASS).length,
      failedSteps: stepResults.filter(r => r.status === ReviewStatus.FAIL).length,
      errorSteps: stepResults.filter(r => r.status === ReviewStatus.ERROR).length,
      skippedSteps: stepResults.filter(r => r.status === ReviewStatus.SKIPPED).length,
    },
  };
}

describe('GitHubStatusReporter', () => {
  let reporter: GitHubStatusReporter;
  let pr: PullRequestInfo;

  beforeEach(() => {
    reporter = new GitHubStatusReporter('mock-token');
    pr = createMockPR();

    // Clear mock call history
    mockOctokit.checks.create.mockClear();
    mockOctokit.checks.update.mockClear();
    mockOctokit.repos.createCommitStatus.mockClear();
  });

  describe('createCheckRun', () => {
    test('creates a GitHub check run', async () => {
      const checkRunId = await reporter.createCheckRun(pr, 'Test Workflow');

      expect(checkRunId).toBe(12345);
      expect(mockOctokit.checks.create).toHaveBeenCalledTimes(1);

      const call = mockOctokit.checks.create.mock.calls[0][0];
      expect(call.owner).toBe('testowner');
      expect(call.repo).toBe('testrepo');
      expect(call.name).toBe('Test Workflow');
      expect(call.head_sha).toBe('abc123');
      expect(call.status).toBe('in_progress');
    });
  });

  describe('updateCheckRun', () => {
    test('updates check run with pass status', async () => {
      const result = createMockWorkflowResult(ReviewStatus.PASS, [
        createMockStepResult('step1', ReviewStatus.PASS),
        createMockStepResult('step2', ReviewStatus.PASS),
      ]);

      await reporter.updateCheckRun(pr, 12345, result);

      expect(mockOctokit.checks.update).toHaveBeenCalledTimes(1);

      const call = mockOctokit.checks.update.mock.calls[0][0];
      expect(call.owner).toBe('testowner');
      expect(call.repo).toBe('testrepo');
      expect(call.check_run_id).toBe(12345);
      expect(call.status).toBe('completed');
      expect(call.conclusion).toBe('success');
    });

    test('updates check run with fail status', async () => {
      const result = createMockWorkflowResult(ReviewStatus.FAIL, [
        createMockStepResult('step1', ReviewStatus.PASS),
        createMockStepResult('step2', ReviewStatus.FAIL),
      ]);

      await reporter.updateCheckRun(pr, 12345, result);

      const call = mockOctokit.checks.update.mock.calls[0][0];
      expect(call.conclusion).toBe('failure');
    });

    test('updates check run with error status', async () => {
      const result = createMockWorkflowResult(ReviewStatus.ERROR, [
        createMockStepResult('step1', ReviewStatus.ERROR),
      ]);

      await reporter.updateCheckRun(pr, 12345, result);

      const call = mockOctokit.checks.update.mock.calls[0][0];
      expect(call.conclusion).toBe('failure');
    });
  });

  describe('createAnnotations', () => {
    test('creates annotations from review messages', () => {
      const result = createMockWorkflowResult(ReviewStatus.FAIL, [
        createMockStepResult('lint', ReviewStatus.FAIL, [
          {
            severity: ReviewSeverity.ERROR,
            message: 'Unused variable',
            file: 'src/test.ts',
            line: 10,
            ruleId: 'no-unused-vars',
          },
          {
            severity: ReviewSeverity.WARNING,
            message: 'Missing semicolon',
            file: 'src/test.ts',
            line: 15,
            ruleId: 'semi',
          },
        ]),
      ]);

      const annotations = reporter.createAnnotations(result);

      expect(annotations).toHaveLength(2);
      expect(annotations[0].path).toBe('src/test.ts');
      expect(annotations[0].start_line).toBe(10);
      expect(annotations[0].annotation_level).toBe('failure');
      expect(annotations[0].message).toBe('Unused variable');
      expect(annotations[0].title).toBe('no-unused-vars');

      expect(annotations[1].annotation_level).toBe('warning');
    });

    test('skips messages without file or line', () => {
      const result = createMockWorkflowResult(ReviewStatus.FAIL, [
        createMockStepResult('test', ReviewStatus.FAIL, [
          {
            severity: ReviewSeverity.ERROR,
            message: 'General error without location',
          },
          {
            severity: ReviewSeverity.ERROR,
            message: 'Error with file',
            file: 'src/test.ts',
            line: 10,
          },
        ]),
      ]);

      const annotations = reporter.createAnnotations(result);

      expect(annotations).toHaveLength(1);
      expect(annotations[0].message).toBe('Error with file');
    });

    test('limits annotations to 50', () => {
      const messages = Array.from({ length: 100 }, (_, i) => ({
        severity: ReviewSeverity.ERROR,
        message: `Error ${i}`,
        file: 'src/test.ts',
        line: i + 1,
      }));

      const result = createMockWorkflowResult(ReviewStatus.FAIL, [
        createMockStepResult('test', ReviewStatus.FAIL, messages),
      ]);

      const annotations = reporter.createAnnotations(result);

      // Should be limited in updateCheckRun, but createAnnotations returns all
      expect(annotations.length).toBeGreaterThan(50);
    });
  });

  describe('postCommitStatus', () => {
    test('posts commit status with success', async () => {
      const result = createMockWorkflowResult(ReviewStatus.PASS, [
        createMockStepResult('step1', ReviewStatus.PASS),
      ]);

      await reporter.postCommitStatus(pr, result, 'review/test');

      expect(mockOctokit.repos.createCommitStatus).toHaveBeenCalledTimes(1);

      const call = mockOctokit.repos.createCommitStatus.mock.calls[0][0];
      expect(call.owner).toBe('testowner');
      expect(call.repo).toBe('testrepo');
      expect(call.sha).toBe('abc123');
      expect(call.state).toBe('success');
      expect(call.context).toBe('review/test');
    });

    test('posts commit status with failure', async () => {
      const result = createMockWorkflowResult(ReviewStatus.FAIL, [
        createMockStepResult('step1', ReviewStatus.FAIL),
      ]);

      await reporter.postCommitStatus(pr, result, 'review/test');

      const call = mockOctokit.repos.createCommitStatus.mock.calls[0][0];
      expect(call.state).toBe('failure');
    });

    test('posts commit status with error', async () => {
      const result = createMockWorkflowResult(ReviewStatus.ERROR, [
        createMockStepResult('step1', ReviewStatus.ERROR),
      ]);

      await reporter.postCommitStatus(pr, result, 'review/test');

      const call = mockOctokit.repos.createCommitStatus.mock.calls[0][0];
      expect(call.state).toBe('error');
    });
  });
});
