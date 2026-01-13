import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { ReviewOrchestrator } from '../orchestrator/orchestrator.js';
import { ReviewStepRegistry } from '../plugin/registry.js';
import type { ReviewStep, ReviewStepConfig } from '../types/review-step.js';
import type { ReviewContext } from '../types/review-context.js';
import type { ReviewStepResult } from '../types/review-result.js';
import { ReviewStatus } from '../types/review-result.js';
import type {
  ReviewWorkflowConfig,
  ReviewSystemConfig,
} from '../types/config.js';
import { ExecutionMode } from '../types/config.js';

// Mock review step
class MockReviewStep implements ReviewStep {
  readonly type = 'mock';
  readonly name = 'Mock Step';
  readonly description = 'Mock step for testing';

  async initialize(config: ReviewStepConfig): Promise<void> {}

  async execute(context: ReviewContext): Promise<ReviewStepResult> {
    return {
      stepName: this.name,
      status: ReviewStatus.PASS,
      messages: [],
      durationMs: 50,
      startedAt: new Date(),
      completedAt: new Date(),
    };
  }

  async cleanup(): Promise<void> {}

  validateConfig(config: ReviewStepConfig): string[] {
    return [];
  }
}

// Mock Octokit
const mockOctokit = {
  checks: {
    create: mock(() => Promise.resolve({ data: { id: 12345 } })),
    update: mock(() => Promise.resolve({ data: {} })),
  },
  repos: {
    createCommitStatus: mock(() => Promise.resolve({ data: {} })),
  },
  pulls: {
    listFiles: mock(() =>
      Promise.resolve({
        data: [
          {
            filename: 'src/test.ts',
            status: 'modified',
            additions: 10,
            deletions: 5,
            patch: '...',
          },
        ],
      })
    ),
  },
};

mock.module('@octokit/rest', () => ({
  Octokit: class MockOctokit {
    checks = mockOctokit.checks;
    repos = mockOctokit.repos;
    pulls = mockOctokit.pulls;
    constructor() {}
  },
}));

function createMockWorkflowConfig(): ReviewWorkflowConfig {
  return {
    name: 'Test Workflow',
    description: 'Test workflow description',
    enabled: true,
    triggers: {
      repositories: ['testowner/testrepo'],
      aiGeneratedOnly: false,
    },
    groups: [
      {
        name: 'Lint Group',
        mode: ExecutionMode.SEQUENTIAL,
        steps: [
          {
            id: 'lint-1',
            name: 'ESLint',
            blocking: true,
            enabled: true,
            timeoutMs: 5000,
            options: { type: 'mock' },
          },
        ],
        continueOnFailure: false,
      },
    ],
    timeoutMs: 300000,
    postComment: true,
    updateStatus: true,
    statusContext: 'review/test',
  };
}

function createMockPR() {
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

describe('ReviewOrchestrator', () => {
  let orchestrator: ReviewOrchestrator;
  let registry: ReviewStepRegistry;

  beforeEach(() => {
    registry = new ReviewStepRegistry();
    registry.register({
      type: 'mock',
      name: 'Mock Step',
      description: 'Mock step for testing',
      factory: async (config: ReviewStepConfig) => new MockReviewStep(),
      defaults: {
        blocking: false,
        enabled: true,
        timeoutMs: 5000,
        options: {},
      },
    });

    orchestrator = new ReviewOrchestrator(
      registry,
      'mock-token',
      '/tmp/test',
      {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      }
    );

    // Clear mock call history
    mockOctokit.checks.create.mockClear();
    mockOctokit.checks.update.mockClear();
    mockOctokit.repos.createCommitStatus.mockClear();
    mockOctokit.pulls.listFiles.mockClear();
  });

  describe('runReview', () => {
    test('runs a simple workflow', async () => {
      const pr = createMockPR();
      const workflow = createMockWorkflowConfig();

      const result = await orchestrator.runReview(pr, workflow);

      expect(result.status).toBe(ReviewStatus.PASS);
      expect(result.stepResults).toHaveLength(1);
      expect(result.summary.totalSteps).toBe(1);
      expect(result.summary.passedSteps).toBe(1);
    });

    test('skips disabled workflow', async () => {
      const pr = createMockPR();
      const workflow = createMockWorkflowConfig();
      workflow.enabled = false;

      const result = await orchestrator.runReview(pr, workflow);

      expect(result.status).toBe(ReviewStatus.SKIPPED);
      expect(result.stepResults).toHaveLength(0);
    });

    test('skips workflow when triggers not met', async () => {
      const pr = createMockPR();
      const workflow = createMockWorkflowConfig();
      workflow.triggers.aiGeneratedOnly = true;
      pr.isAiGenerated = false;

      const result = await orchestrator.runReview(pr, workflow);

      expect(result.status).toBe(ReviewStatus.SKIPPED);
    });

    test('creates GitHub check run when updateStatus is true', async () => {
      const pr = createMockPR();
      const workflow = createMockWorkflowConfig();

      await orchestrator.runReview(pr, workflow);

      expect(mockOctokit.checks.create).toHaveBeenCalledTimes(1);
      expect(mockOctokit.checks.update).toHaveBeenCalledTimes(1);
    });

    test('posts commit status when statusContext is set', async () => {
      const pr = createMockPR();
      const workflow = createMockWorkflowConfig();

      await orchestrator.runReview(pr, workflow);

      expect(mockOctokit.repos.createCommitStatus).toHaveBeenCalledTimes(1);
    });

    test('fetches changed files from GitHub', async () => {
      const pr = createMockPR();
      const workflow = createMockWorkflowConfig();

      await orchestrator.runReview(pr, workflow);

      expect(mockOctokit.pulls.listFiles).toHaveBeenCalledTimes(1);
      const call = mockOctokit.pulls.listFiles.mock.calls[0][0];
      expect(call.owner).toBe('testowner');
      expect(call.repo).toBe('testrepo');
      expect(call.pull_number).toBe(123);
    });
  });

  describe('findRepositoryConfig', () => {
    test('finds repository config by name', () => {
      const config: ReviewSystemConfig = {
        version: '1.0',
        organizations: [
          {
            organization: 'testorg',
            defaultWorkflows: [],
            repositories: [
              {
                repository: 'testowner/testrepo',
                workflows: [],
              },
            ],
            settings: {
              maxConcurrentReviews: 10,
              githubApiRateLimit: 5000,
              enableCaching: false,
              cacheTtlSeconds: 3600,
            },
          },
        ],
        defaults: {
          stepTimeoutMs: 5000,
          workflowTimeoutMs: 300000,
          executionMode: ExecutionMode.SEQUENTIAL,
        },
      };

      const pr = createMockPR();
      const repoConfig = orchestrator.findRepositoryConfig(config, pr);

      expect(repoConfig).not.toBeNull();
      expect(repoConfig?.repository).toBe('testowner/testrepo');
    });

    test('returns null when repository not found', () => {
      const config: ReviewSystemConfig = {
        version: '1.0',
        organizations: [
          {
            organization: 'testorg',
            defaultWorkflows: [],
            repositories: [],
            settings: {
              maxConcurrentReviews: 10,
              githubApiRateLimit: 5000,
              enableCaching: false,
              cacheTtlSeconds: 3600,
            },
          },
        ],
        defaults: {
          stepTimeoutMs: 5000,
          workflowTimeoutMs: 300000,
          executionMode: ExecutionMode.SEQUENTIAL,
        },
      };

      const pr = createMockPR();
      const repoConfig = orchestrator.findRepositoryConfig(config, pr);

      expect(repoConfig).toBeNull();
    });
  });

  describe('workflow triggers', () => {
    test('runs workflow when repository matches', async () => {
      const pr = createMockPR();
      const workflow = createMockWorkflowConfig();
      workflow.triggers.repositories = ['testowner/testrepo'];

      const result = await orchestrator.runReview(pr, workflow);

      expect(result.status).not.toBe(ReviewStatus.SKIPPED);
    });

    test('skips workflow when repository does not match', async () => {
      const pr = createMockPR();
      const workflow = createMockWorkflowConfig();
      workflow.triggers.repositories = ['other/repo'];

      const result = await orchestrator.runReview(pr, workflow);

      expect(result.status).toBe(ReviewStatus.SKIPPED);
    });

    test('runs workflow when required labels present', async () => {
      const pr = createMockPR();
      pr.labels = ['test', 'review'];
      const workflow = createMockWorkflowConfig();
      workflow.triggers.requiredLabels = ['test'];

      const result = await orchestrator.runReview(pr, workflow);

      expect(result.status).not.toBe(ReviewStatus.SKIPPED);
    });

    test('skips workflow when required labels missing', async () => {
      const pr = createMockPR();
      pr.labels = ['other'];
      const workflow = createMockWorkflowConfig();
      workflow.triggers.requiredLabels = ['test'];

      const result = await orchestrator.runReview(pr, workflow);

      expect(result.status).toBe(ReviewStatus.SKIPPED);
    });

    test('skips workflow when excluded label present', async () => {
      const pr = createMockPR();
      pr.labels = ['wip'];
      const workflow = createMockWorkflowConfig();
      workflow.triggers.excludedLabels = ['wip'];

      const result = await orchestrator.runReview(pr, workflow);

      expect(result.status).toBe(ReviewStatus.SKIPPED);
    });

    test('runs workflow for AI-generated PRs when aiGeneratedOnly is true', async () => {
      const pr = createMockPR();
      pr.isAiGenerated = true;
      const workflow = createMockWorkflowConfig();
      workflow.triggers.aiGeneratedOnly = true;

      const result = await orchestrator.runReview(pr, workflow);

      expect(result.status).not.toBe(ReviewStatus.SKIPPED);
    });

    test('skips workflow for non-AI PRs when aiGeneratedOnly is true', async () => {
      const pr = createMockPR();
      pr.isAiGenerated = false;
      const workflow = createMockWorkflowConfig();
      workflow.triggers.aiGeneratedOnly = true;

      const result = await orchestrator.runReview(pr, workflow);

      expect(result.status).toBe(ReviewStatus.SKIPPED);
    });

    test('runs workflow when target branch matches', async () => {
      const pr = createMockPR();
      pr.baseBranch = 'main';
      const workflow = createMockWorkflowConfig();
      workflow.triggers.targetBranches = ['main', 'develop'];

      const result = await orchestrator.runReview(pr, workflow);

      expect(result.status).not.toBe(ReviewStatus.SKIPPED);
    });

    test('skips workflow when target branch does not match', async () => {
      const pr = createMockPR();
      pr.baseBranch = 'feature';
      const workflow = createMockWorkflowConfig();
      workflow.triggers.targetBranches = ['main'];

      const result = await orchestrator.runReview(pr, workflow);

      expect(result.status).toBe(ReviewStatus.SKIPPED);
    });
  });
});
