import { describe, it, expect, beforeEach } from 'bun:test';
import { StatusCheckConfig } from '../blocking/status-checks';
import { ReviewStatus, ReviewWorkflowResult, ReviewStepResult } from '../types/review-result';

describe('StatusCheckConfig', () => {
  let config: StatusCheckConfig;

  beforeEach(() => {
    config = new StatusCheckConfig();
  });

  describe('setRequirements and getRequirements', () => {
    it('should store and retrieve requirements', () => {
      const requirements = {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        strict: true,
        checks: [
          {
            context: 'review/lint',
            description: 'Linting',
            required: true,
            stepName: 'lint',
          },
        ],
      };

      config.setRequirements('test-owner/test-repo/main', requirements);

      const retrieved = config.getRequirements('test-owner', 'test-repo', 'main');
      expect(retrieved).toEqual(requirements);
    });

    it('should return undefined for non-existent requirements', () => {
      const retrieved = config.getRequirements('test-owner', 'test-repo', 'main');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('getRequiredContexts', () => {
    it('should return only required contexts', () => {
      const requirements = {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        strict: true,
        checks: [
          {
            context: 'review/lint',
            description: 'Linting',
            required: true,
          },
          {
            context: 'review/test',
            description: 'Testing',
            required: true,
          },
          {
            context: 'review/security',
            description: 'Security',
            required: false,
          },
        ],
      };

      config.setRequirements('test-owner/test-repo/main', requirements);

      const contexts = config.getRequiredContexts('test-owner', 'test-repo', 'main');
      expect(contexts).toEqual(['review/lint', 'review/test']);
    });

    it('should return empty array if no requirements', () => {
      const contexts = config.getRequiredContexts('test-owner', 'test-repo', 'main');
      expect(contexts).toEqual([]);
    });
  });

  describe('mapReviewResultsToStatusChecks', () => {
    it('should map passing results to success', () => {
      const workflowResult: ReviewWorkflowResult = {
        status: ReviewStatus.PASS,
        stepResults: [
          {
            stepName: 'lint',
            status: ReviewStatus.PASS,
            messages: [],
            durationMs: 1000,
            startedAt: new Date(),
            completedAt: new Date(),
          },
        ],
        totalDurationMs: 1000,
        startedAt: new Date(),
        completedAt: new Date(),
        summary: {
          totalSteps: 1,
          passedSteps: 1,
          failedSteps: 0,
          errorSteps: 0,
          skippedSteps: 0,
        },
      };

      const requirements = {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        strict: true,
        checks: [
          {
            context: 'review/lint',
            description: 'Linting',
            required: true,
            stepName: 'lint',
          },
        ],
      };

      const mapped = config.mapReviewResultsToStatusChecks(workflowResult, requirements);

      expect(mapped).toHaveLength(1);
      expect(mapped[0]).toMatchObject({
        context: 'review/lint',
        state: 'success',
      });
    });

    it('should map failing results to failure', () => {
      const workflowResult: ReviewWorkflowResult = {
        status: ReviewStatus.FAIL,
        stepResults: [
          {
            stepName: 'lint',
            status: ReviewStatus.FAIL,
            messages: [
              {
                severity: 'error' as any,
                message: 'Lint error',
              },
            ],
            durationMs: 1000,
            startedAt: new Date(),
            completedAt: new Date(),
          },
        ],
        totalDurationMs: 1000,
        startedAt: new Date(),
        completedAt: new Date(),
        summary: {
          totalSteps: 1,
          passedSteps: 0,
          failedSteps: 1,
          errorSteps: 0,
          skippedSteps: 0,
        },
      };

      const requirements = {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        strict: true,
        checks: [
          {
            context: 'review/lint',
            description: 'Linting',
            required: true,
            stepName: 'lint',
          },
        ],
      };

      const mapped = config.mapReviewResultsToStatusChecks(workflowResult, requirements);

      expect(mapped).toHaveLength(1);
      expect(mapped[0]).toMatchObject({
        context: 'review/lint',
        state: 'failure',
      });
    });

    it('should map error results to error', () => {
      const workflowResult: ReviewWorkflowResult = {
        status: ReviewStatus.ERROR,
        stepResults: [
          {
            stepName: 'lint',
            status: ReviewStatus.ERROR,
            messages: [],
            durationMs: 1000,
            startedAt: new Date(),
            completedAt: new Date(),
            error: {
              message: 'Execution error',
            },
          },
        ],
        totalDurationMs: 1000,
        startedAt: new Date(),
        completedAt: new Date(),
        summary: {
          totalSteps: 1,
          passedSteps: 0,
          failedSteps: 0,
          errorSteps: 1,
          skippedSteps: 0,
        },
      };

      const requirements = {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        strict: true,
        checks: [
          {
            context: 'review/lint',
            description: 'Linting',
            required: true,
            stepName: 'lint',
          },
        ],
      };

      const mapped = config.mapReviewResultsToStatusChecks(workflowResult, requirements);

      expect(mapped).toHaveLength(1);
      expect(mapped[0]).toMatchObject({
        context: 'review/lint',
        state: 'error',
      });
    });

    it('should map skipped results to success', () => {
      const workflowResult: ReviewWorkflowResult = {
        status: ReviewStatus.SKIPPED,
        stepResults: [
          {
            stepName: 'lint',
            status: ReviewStatus.SKIPPED,
            messages: [],
            durationMs: 0,
            startedAt: new Date(),
            completedAt: new Date(),
          },
        ],
        totalDurationMs: 0,
        startedAt: new Date(),
        completedAt: new Date(),
        summary: {
          totalSteps: 1,
          passedSteps: 0,
          failedSteps: 0,
          errorSteps: 0,
          skippedSteps: 1,
        },
      };

      const requirements = {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        strict: true,
        checks: [
          {
            context: 'review/lint',
            description: 'Linting',
            required: true,
            stepName: 'lint',
          },
        ],
      };

      const mapped = config.mapReviewResultsToStatusChecks(workflowResult, requirements);

      expect(mapped).toHaveLength(1);
      expect(mapped[0]).toMatchObject({
        context: 'review/lint',
        state: 'success',
      });
    });

    it('should map pending results to pending', () => {
      const workflowResult: ReviewWorkflowResult = {
        status: ReviewStatus.PENDING,
        stepResults: [
          {
            stepName: 'lint',
            status: ReviewStatus.PENDING,
            messages: [],
            durationMs: 0,
            startedAt: new Date(),
            completedAt: new Date(),
          },
        ],
        totalDurationMs: 0,
        startedAt: new Date(),
        completedAt: new Date(),
        summary: {
          totalSteps: 1,
          passedSteps: 0,
          failedSteps: 0,
          errorSteps: 0,
          skippedSteps: 0,
        },
      };

      const requirements = {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        strict: true,
        checks: [
          {
            context: 'review/lint',
            description: 'Linting',
            required: true,
            stepName: 'lint',
          },
        ],
      };

      const mapped = config.mapReviewResultsToStatusChecks(workflowResult, requirements);

      expect(mapped).toHaveLength(1);
      expect(mapped[0]).toMatchObject({
        context: 'review/lint',
        state: 'pending',
      });
    });

    it('should mark as pending if step not found', () => {
      const workflowResult: ReviewWorkflowResult = {
        status: ReviewStatus.PASS,
        stepResults: [],
        totalDurationMs: 0,
        startedAt: new Date(),
        completedAt: new Date(),
        summary: {
          totalSteps: 0,
          passedSteps: 0,
          failedSteps: 0,
          errorSteps: 0,
          skippedSteps: 0,
        },
      };

      const requirements = {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        strict: true,
        checks: [
          {
            context: 'review/lint',
            description: 'Linting',
            required: true,
            stepName: 'lint',
          },
        ],
      };

      const mapped = config.mapReviewResultsToStatusChecks(workflowResult, requirements);

      expect(mapped).toHaveLength(1);
      expect(mapped[0]).toMatchObject({
        context: 'review/lint',
        state: 'pending',
      });
    });
  });

  describe('areRequiredChecksPassing', () => {
    it('should return true if all required checks pass', () => {
      const mappedChecks = [
        {
          context: 'review/lint',
          description: 'Linting',
          state: 'success' as const,
        },
        {
          context: 'review/test',
          description: 'Testing',
          state: 'success' as const,
        },
      ];

      const requirements = {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        strict: true,
        checks: [
          {
            context: 'review/lint',
            description: 'Linting',
            required: true,
          },
          {
            context: 'review/test',
            description: 'Testing',
            required: true,
          },
        ],
      };

      const passing = config.areRequiredChecksPassing(mappedChecks, requirements);
      expect(passing).toBe(true);
    });

    it('should return false if any required check fails', () => {
      const mappedChecks = [
        {
          context: 'review/lint',
          description: 'Linting',
          state: 'success' as const,
        },
        {
          context: 'review/test',
          description: 'Testing',
          state: 'failure' as const,
        },
      ];

      const requirements = {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        strict: true,
        checks: [
          {
            context: 'review/lint',
            description: 'Linting',
            required: true,
          },
          {
            context: 'review/test',
            description: 'Testing',
            required: true,
          },
        ],
      };

      const passing = config.areRequiredChecksPassing(mappedChecks, requirements);
      expect(passing).toBe(false);
    });

    it('should ignore non-required checks', () => {
      const mappedChecks = [
        {
          context: 'review/lint',
          description: 'Linting',
          state: 'success' as const,
        },
        {
          context: 'review/security',
          description: 'Security',
          state: 'failure' as const,
        },
      ];

      const requirements = {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        strict: true,
        checks: [
          {
            context: 'review/lint',
            description: 'Linting',
            required: true,
          },
          {
            context: 'review/security',
            description: 'Security',
            required: false,
          },
        ],
      };

      const passing = config.areRequiredChecksPassing(mappedChecks, requirements);
      expect(passing).toBe(true);
    });
  });

  describe('getFailingRequiredChecks', () => {
    it('should return failing required checks', () => {
      const mappedChecks = [
        {
          context: 'review/lint',
          description: 'Linting',
          state: 'failure' as const,
        },
        {
          context: 'review/test',
          description: 'Testing',
          state: 'error' as const,
        },
        {
          context: 'review/security',
          description: 'Security',
          state: 'failure' as const,
        },
      ];

      const requirements = {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        strict: true,
        checks: [
          {
            context: 'review/lint',
            description: 'Linting',
            required: true,
          },
          {
            context: 'review/test',
            description: 'Testing',
            required: true,
          },
          {
            context: 'review/security',
            description: 'Security',
            required: false,
          },
        ],
      };

      const failing = config.getFailingRequiredChecks(mappedChecks, requirements);
      expect(failing).toEqual(['review/lint', 'review/test']);
    });

    it('should not include pending checks', () => {
      const mappedChecks = [
        {
          context: 'review/lint',
          description: 'Linting',
          state: 'pending' as const,
        },
      ];

      const requirements = {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        strict: true,
        checks: [
          {
            context: 'review/lint',
            description: 'Linting',
            required: true,
          },
        ],
      };

      const failing = config.getFailingRequiredChecks(mappedChecks, requirements);
      expect(failing).toEqual([]);
    });
  });

  describe('createDefaultRequirements', () => {
    it('should create default requirements with lint and test checks', () => {
      const requirements = StatusCheckConfig.createDefaultRequirements('test-owner', 'test-repo', 'main');

      expect(requirements.owner).toBe('test-owner');
      expect(requirements.repo).toBe('test-repo');
      expect(requirements.branch).toBe('main');
      expect(requirements.strict).toBe(true);
      expect(requirements.checks).toHaveLength(3);
      expect(requirements.checks[0].context).toBe('review/lint');
      expect(requirements.checks[1].context).toBe('review/test');
      expect(requirements.checks[2].context).toBe('review/security');
    });
  });

  describe('clear', () => {
    it('should clear all requirements', () => {
      const requirements = {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        strict: true,
        checks: [],
      };

      config.setRequirements('test-owner/test-repo/main', requirements);
      config.clear();

      const retrieved = config.getRequirements('test-owner', 'test-repo', 'main');
      expect(retrieved).toBeUndefined();
    });
  });
});
