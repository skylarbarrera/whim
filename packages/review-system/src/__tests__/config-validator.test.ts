import { describe, it, expect } from 'bun:test';
import { ConfigValidator } from '../config/validator.js';
import type { ReviewWorkflowConfig, ReviewStepConfig, WorkflowTriggers } from '../types.js';

describe('ConfigValidator', () => {
  const validator = new ConfigValidator();

  describe('validateWorkflow', () => {
    it('should validate a valid workflow', () => {
      const config: ReviewWorkflowConfig = {
        name: 'test-workflow',
        enabled: true,
        steps: [
          {
            name: 'lint',
            type: 'lint',
            blocking: true,
            timeout: 300000,
          },
        ],
      };

      const result = validator.validateWorkflow(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail for missing name', () => {
      const config = {
        enabled: true,
        steps: [],
      } as ReviewWorkflowConfig;

      const result = validator.validateWorkflow(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'name',
        message: 'Workflow name is required',
      });
    });

    it('should fail for missing steps', () => {
      const config = {
        name: 'test',
        enabled: true,
      } as ReviewWorkflowConfig;

      const result = validator.validateWorkflow(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'steps',
        message: 'Steps array is required',
      });
    });

    it('should validate step errors', () => {
      const config: ReviewWorkflowConfig = {
        name: 'test',
        enabled: true,
        steps: [
          {
            name: 'step1',
            type: 'lint',
            blocking: true,
          },
          {
            type: 'test',
            blocking: true,
          } as ReviewStepConfig,
        ],
      };

      const result = validator.validateWorkflow(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'steps[1].name')).toBe(true);
    });

    it('should validate triggers if present', () => {
      const config: ReviewWorkflowConfig = {
        name: 'test',
        enabled: true,
        steps: [],
        triggers: {
          repositories: 'not-array' as any,
        },
      };

      const result = validator.validateWorkflow(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'triggers.repositories')).toBe(true);
    });

    it('should validate step groups if present', () => {
      const config: ReviewWorkflowConfig = {
        name: 'test',
        enabled: true,
        steps: [{ name: 'lint', type: 'lint', blocking: true }],
        stepGroups: {
          group1: ['nonexistent-step'],
        },
      };

      const result = validator.validateWorkflow(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field.startsWith('stepGroups'))).toBe(true);
    });
  });

  describe('validateStep', () => {
    it('should validate a valid step', () => {
      const step: ReviewStepConfig = {
        name: 'lint',
        type: 'lint',
        blocking: true,
        timeout: 300000,
        config: { linters: [] },
      };

      const result = validator.validateStep(step);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail for missing name', () => {
      const step = {
        type: 'lint',
        blocking: true,
      } as ReviewStepConfig;

      const result = validator.validateStep(step);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'name',
        message: 'Step name is required',
      });
    });

    it('should fail for missing type', () => {
      const step = {
        name: 'step1',
        blocking: true,
      } as ReviewStepConfig;

      const result = validator.validateStep(step);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'type',
        message: 'Step type is required',
      });
    });

    it('should fail for invalid timeout', () => {
      const step: ReviewStepConfig = {
        name: 'step1',
        type: 'lint',
        blocking: true,
        timeout: -100,
      };

      const result = validator.validateStep(step);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'timeout',
        message: 'Timeout must be a positive number',
      });
    });

    it('should fail for invalid blocking type', () => {
      const step = {
        name: 'step1',
        type: 'lint',
        blocking: 'yes',
      } as any;

      const result = validator.validateStep(step);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'blocking',
        message: 'Blocking must be a boolean',
      });
    });

    it('should fail for invalid condition type', () => {
      const step = {
        name: 'step1',
        type: 'lint',
        blocking: true,
        condition: 123,
      } as any;

      const result = validator.validateStep(step);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'condition',
        message: 'Condition must be a string',
      });
    });

    it('should fail for invalid config type', () => {
      const step = {
        name: 'step1',
        type: 'lint',
        blocking: true,
        config: 'not-an-object',
      } as any;

      const result = validator.validateStep(step);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'config',
        message: 'Config must be an object',
      });
    });
  });

  describe('validateTriggers', () => {
    it('should validate valid triggers', () => {
      const triggers: WorkflowTriggers = {
        repositories: ['owner/repo'],
        requiredLabels: ['label1'],
        excludedLabels: ['label2'],
        targetBranches: ['main'],
        aiGeneratedOnly: true,
      };

      const result = validator.validateTriggers(triggers);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail for invalid repositories type', () => {
      const triggers = {
        repositories: 'not-array',
      } as any;

      const result = validator.validateTriggers(triggers);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'repositories',
        message: 'Repositories must be an array',
      });
    });

    it('should fail for invalid repository item', () => {
      const triggers = {
        repositories: ['valid', 123],
      } as any;

      const result = validator.validateTriggers(triggers);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'repositories[1]',
        message: 'Repository must be a string',
      });
    });

    it('should fail for invalid requiredLabels type', () => {
      const triggers = {
        requiredLabels: 'not-array',
      } as any;

      const result = validator.validateTriggers(triggers);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'requiredLabels',
        message: 'Required labels must be an array',
      });
    });

    it('should fail for invalid excludedLabels type', () => {
      const triggers = {
        excludedLabels: {},
      } as any;

      const result = validator.validateTriggers(triggers);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'excludedLabels',
        message: 'Excluded labels must be an array',
      });
    });

    it('should fail for invalid targetBranches type', () => {
      const triggers = {
        targetBranches: 'main',
      } as any;

      const result = validator.validateTriggers(triggers);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'targetBranches',
        message: 'Target branches must be an array',
      });
    });

    it('should fail for invalid aiGeneratedOnly type', () => {
      const triggers = {
        aiGeneratedOnly: 'yes',
      } as any;

      const result = validator.validateTriggers(triggers);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'aiGeneratedOnly',
        message: 'AI generated only must be a boolean',
      });
    });
  });

  describe('validateStepGroups', () => {
    it('should validate valid step groups', () => {
      const config: ReviewWorkflowConfig = {
        name: 'test',
        enabled: true,
        steps: [
          { name: 'lint', type: 'lint', blocking: true },
          { name: 'test', type: 'test', blocking: true },
        ],
        stepGroups: {
          validation: ['lint', 'test'],
        },
      };

      const errors = validator.validateStepGroups(config);
      expect(errors).toHaveLength(0);
    });

    it('should fail for non-array step group', () => {
      const config = {
        name: 'test',
        enabled: true,
        steps: [],
        stepGroups: {
          group1: 'not-array',
        },
      } as any;

      const errors = validator.validateStepGroups(config);
      expect(errors).toContainEqual({
        field: 'stepGroups.group1',
        message: 'Step group must be an array of step names',
      });
    });

    it('should fail for non-existent step in group', () => {
      const config: ReviewWorkflowConfig = {
        name: 'test',
        enabled: true,
        steps: [{ name: 'lint', type: 'lint', blocking: true }],
        stepGroups: {
          group1: ['lint', 'nonexistent'],
        },
      };

      const errors = validator.validateStepGroups(config);
      expect(errors).toContainEqual({
        field: 'stepGroups.group1[1]',
        message: 'Step "nonexistent" does not exist in workflow',
      });
    });
  });

  describe('validateRequiredSteps', () => {
    it('should pass when all required steps exist', () => {
      const config: ReviewWorkflowConfig = {
        name: 'test',
        enabled: true,
        steps: [
          { name: 'lint', type: 'lint', blocking: true },
          { name: 'test', type: 'test', blocking: true },
        ],
      };

      const result = validator.validateRequiredSteps(config, ['lint', 'test']);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when required step is missing', () => {
      const config: ReviewWorkflowConfig = {
        name: 'test',
        enabled: true,
        steps: [{ name: 'lint', type: 'lint', blocking: true }],
      };

      const result = validator.validateRequiredSteps(config, ['lint', 'test', 'security']);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors).toContainEqual({
        field: 'steps',
        message: 'Required step "test" not found in workflow',
      });
      expect(result.errors).toContainEqual({
        field: 'steps',
        message: 'Required step "security" not found in workflow',
      });
    });
  });

  describe('validateCustomRules', () => {
    it('should pass when all rules pass', () => {
      const config: ReviewWorkflowConfig = {
        name: 'test',
        enabled: true,
        steps: [{ name: 'lint', type: 'lint', blocking: true }],
      };

      const rules = [
        (cfg: ReviewWorkflowConfig) => (cfg.steps.length > 0 ? null : { field: 'steps', message: 'Must have steps' }),
        (cfg: ReviewWorkflowConfig) => (cfg.enabled ? null : { field: 'enabled', message: 'Must be enabled' }),
      ];

      const result = validator.validateCustomRules(config, rules);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when rules fail', () => {
      const config: ReviewWorkflowConfig = {
        name: 'test',
        enabled: false,
        steps: [],
      };

      const rules = [
        (cfg: ReviewWorkflowConfig) => (cfg.steps.length > 0 ? null : { field: 'steps', message: 'Must have steps' }),
        (cfg: ReviewWorkflowConfig) => (cfg.enabled ? null : { field: 'enabled', message: 'Must be enabled' }),
      ];

      const result = validator.validateCustomRules(config, rules);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });
  });
});
