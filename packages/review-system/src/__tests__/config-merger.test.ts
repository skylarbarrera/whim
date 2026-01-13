import { describe, it, expect } from 'bun:test';
import { ConfigMerger } from '../config/merger.js';
import type { ReviewWorkflowConfig } from '../types.js';

describe('ConfigMerger', () => {
  describe('merge', () => {
    it('should merge two configs with higher priority winning', () => {
      const lower: ReviewWorkflowConfig = {
        name: 'lower',
        enabled: true,
        steps: [
          { name: 'lint', type: 'lint', blocking: true },
        ],
      };

      const higher: ReviewWorkflowConfig = {
        name: 'higher',
        enabled: false,
        steps: [
          { name: 'test', type: 'test', blocking: true },
        ],
      };

      const merger = new ConfigMerger();
      const result = merger.merge(lower, higher);

      expect(result.name).toBe('higher');
      expect(result.enabled).toBe(false);
    });

    it('should merge multiple configs in priority order', () => {
      const config1: ReviewWorkflowConfig = {
        name: 'config1',
        enabled: true,
        steps: [],
      };

      const config2: ReviewWorkflowConfig = {
        name: 'config2',
        enabled: false,
        steps: [],
      };

      const config3: ReviewWorkflowConfig = {
        name: 'config3',
        enabled: true,
        steps: [],
      };

      const merger = new ConfigMerger();
      const result = merger.merge(config1, config2, config3);

      expect(result.name).toBe('config3');
      expect(result.enabled).toBe(true);
    });

    it('should return single config if only one provided', () => {
      const config: ReviewWorkflowConfig = {
        name: 'single',
        enabled: true,
        steps: [],
      };

      const merger = new ConfigMerger();
      const result = merger.merge(config);

      expect(result).toEqual(config);
    });

    it('should throw error if no configs provided', () => {
      const merger = new ConfigMerger();
      expect(() => merger.merge()).toThrow('At least one config is required');
    });
  });

  describe('mergeTriggers', () => {
    it('should merge triggers with higher priority', () => {
      const lower: ReviewWorkflowConfig = {
        name: 'lower',
        enabled: true,
        steps: [],
        triggers: {
          aiGeneratedOnly: false,
          targetBranches: ['main', 'develop'],
          requiredLabels: ['label1'],
        },
      };

      const higher: ReviewWorkflowConfig = {
        name: 'higher',
        enabled: true,
        steps: [],
        triggers: {
          aiGeneratedOnly: true,
          targetBranches: ['main'],
          excludedLabels: ['skip'],
        },
      };

      const merger = new ConfigMerger({ arrayStrategy: 'unique' });
      const result = merger.merge(lower, higher);

      expect(result.triggers?.aiGeneratedOnly).toBe(true);
      expect(result.triggers?.targetBranches).toEqual(['main', 'develop']);
      expect(result.triggers?.excludedLabels).toEqual(['skip']);
    });
  });

  describe('mergeSteps', () => {
    it('should merge steps by name', () => {
      const lower: ReviewWorkflowConfig = {
        name: 'lower',
        enabled: true,
        steps: [
          { name: 'lint', type: 'lint', blocking: true, timeout: 300000 },
          { name: 'test', type: 'test', blocking: true },
        ],
      };

      const higher: ReviewWorkflowConfig = {
        name: 'higher',
        enabled: true,
        steps: [
          { name: 'lint', type: 'lint', blocking: false }, // Override lint
          { name: 'security', type: 'security', blocking: true },
        ],
      };

      const merger = new ConfigMerger();
      const result = merger.merge(lower, higher);

      expect(result.steps).toHaveLength(3);

      const lintStep = result.steps.find(s => s.name === 'lint');
      expect(lintStep?.blocking).toBe(false);
      expect(lintStep?.timeout).toBe(300000); // Preserved from lower

      expect(result.steps.find(s => s.name === 'test')).toBeDefined();
      expect(result.steps.find(s => s.name === 'security')).toBeDefined();
    });

    it('should preserve step order from lower when option enabled', () => {
      const lower: ReviewWorkflowConfig = {
        name: 'lower',
        enabled: true,
        steps: [
          { name: 'lint', type: 'lint', blocking: true },
          { name: 'test', type: 'test', blocking: true },
        ],
      };

      const higher: ReviewWorkflowConfig = {
        name: 'higher',
        enabled: true,
        steps: [
          { name: 'security', type: 'security', blocking: true },
          { name: 'lint', type: 'lint', blocking: false },
        ],
      };

      const merger = new ConfigMerger({ preserveStepOrder: true });
      const result = merger.merge(lower, higher);

      expect(result.steps[0].name).toBe('lint');
      expect(result.steps[1].name).toBe('test');
      expect(result.steps[2].name).toBe('security');
    });

    it('should use order from higher when preserveStepOrder is false', () => {
      const lower: ReviewWorkflowConfig = {
        name: 'lower',
        enabled: true,
        steps: [
          { name: 'lint', type: 'lint', blocking: true },
          { name: 'test', type: 'test', blocking: true },
        ],
      };

      const higher: ReviewWorkflowConfig = {
        name: 'higher',
        enabled: true,
        steps: [
          { name: 'security', type: 'security', blocking: true },
          { name: 'lint', type: 'lint', blocking: false },
        ],
      };

      const merger = new ConfigMerger({ preserveStepOrder: false });
      const result = merger.merge(lower, higher);

      expect(result.steps[0].name).toBe('security');
      expect(result.steps[1].name).toBe('lint');
      expect(result.steps[2].name).toBe('test');
    });

    it('should deep merge step configs', () => {
      const lower: ReviewWorkflowConfig = {
        name: 'lower',
        enabled: true,
        steps: [
          {
            name: 'test',
            type: 'test',
            blocking: true,
            config: {
              runner: 'jest',
              coverage: true,
              coverageThresholds: {
                lines: 80,
                functions: 80,
              },
            },
          },
        ],
      };

      const higher: ReviewWorkflowConfig = {
        name: 'higher',
        enabled: true,
        steps: [
          {
            name: 'test',
            type: 'test',
            blocking: true,
            config: {
              coverageThresholds: {
                lines: 90,
              },
            },
          },
        ],
      };

      const merger = new ConfigMerger();
      const result = merger.merge(lower, higher);

      const testStep = result.steps.find(s => s.name === 'test');
      expect(testStep?.config).toEqual({
        runner: 'jest',
        coverage: true,
        coverageThresholds: {
          lines: 90,
          functions: 80,
        },
      });
    });
  });

  describe('mergeStepGroups', () => {
    it('should merge step groups', () => {
      const lower: ReviewWorkflowConfig = {
        name: 'lower',
        enabled: true,
        steps: [],
        stepGroups: {
          validation: ['lint', 'test'],
        },
      };

      const higher: ReviewWorkflowConfig = {
        name: 'higher',
        enabled: true,
        steps: [],
        stepGroups: {
          validation: ['security'],
          quality: ['coverage'],
        },
      };

      const merger = new ConfigMerger({ arrayStrategy: 'unique' });
      const result = merger.merge(lower, higher);

      expect(result.stepGroups?.validation).toEqual(['lint', 'test', 'security']);
      expect(result.stepGroups?.quality).toEqual(['coverage']);
    });
  });

  describe('arrayStrategy', () => {
    it('should replace arrays when strategy is replace', () => {
      const lower: ReviewWorkflowConfig = {
        name: 'lower',
        enabled: true,
        steps: [],
        triggers: {
          targetBranches: ['main', 'develop'],
        },
      };

      const higher: ReviewWorkflowConfig = {
        name: 'higher',
        enabled: true,
        steps: [],
        triggers: {
          targetBranches: ['main'],
        },
      };

      const merger = new ConfigMerger({ arrayStrategy: 'replace' });
      const result = merger.merge(lower, higher);

      expect(result.triggers?.targetBranches).toEqual(['main']);
    });

    it('should concatenate arrays when strategy is concat', () => {
      const lower: ReviewWorkflowConfig = {
        name: 'lower',
        enabled: true,
        steps: [],
        triggers: {
          requiredLabels: ['label1'],
        },
      };

      const higher: ReviewWorkflowConfig = {
        name: 'higher',
        enabled: true,
        steps: [],
        triggers: {
          requiredLabels: ['label2', 'label1'],
        },
      };

      const merger = new ConfigMerger({ arrayStrategy: 'concat' });
      const result = merger.merge(lower, higher);

      expect(result.triggers?.requiredLabels).toEqual(['label1', 'label2', 'label1']);
    });

    it('should deduplicate arrays when strategy is unique', () => {
      const lower: ReviewWorkflowConfig = {
        name: 'lower',
        enabled: true,
        steps: [],
        triggers: {
          requiredLabels: ['label1'],
        },
      };

      const higher: ReviewWorkflowConfig = {
        name: 'higher',
        enabled: true,
        steps: [],
        triggers: {
          requiredLabels: ['label2', 'label1'],
        },
      };

      const merger = new ConfigMerger({ arrayStrategy: 'unique' });
      const result = merger.merge(lower, higher);

      expect(result.triggers?.requiredLabels).toEqual(['label1', 'label2']);
    });
  });

  describe('mergeWithDefaults', () => {
    it('should merge config with defaults', () => {
      const defaults: ReviewWorkflowConfig = {
        name: 'default',
        enabled: true,
        steps: [
          { name: 'lint', type: 'lint', blocking: true },
        ],
      };

      const config: ReviewWorkflowConfig = {
        name: 'custom',
        enabled: true,
        steps: [
          { name: 'test', type: 'test', blocking: true },
        ],
      };

      const merger = new ConfigMerger();
      const result = merger.mergeWithDefaults(config, defaults);

      expect(result.name).toBe('custom');
      expect(result.steps).toHaveLength(2);
    });
  });

  describe('mergeHierarchy', () => {
    it('should merge org, repo, and env configs with correct priority', () => {
      const defaults: ReviewWorkflowConfig = {
        name: 'defaults',
        enabled: true,
        steps: [
          { name: 'lint', type: 'lint', blocking: true, timeout: 300000 },
        ],
      };

      const org: ReviewWorkflowConfig = {
        name: 'org',
        enabled: true,
        steps: [
          { name: 'lint', type: 'lint', blocking: true, timeout: 600000 },
          { name: 'security', type: 'security', blocking: true },
        ],
      };

      const repo: ReviewWorkflowConfig = {
        name: 'repo',
        enabled: true,
        steps: [
          { name: 'test', type: 'test', blocking: true },
        ],
      };

      const env: ReviewWorkflowConfig = {
        name: 'env',
        enabled: false,
        steps: [
          { name: 'lint', type: 'lint', blocking: false },
        ],
      };

      const merger = new ConfigMerger();
      const result = merger.mergeHierarchy(defaults, org, repo, env);

      expect(result.name).toBe('env');
      expect(result.enabled).toBe(false);

      const lintStep = result.steps.find(s => s.name === 'lint');
      expect(lintStep?.blocking).toBe(false); // From env
      expect(lintStep?.timeout).toBe(600000); // From org
    });

    it('should handle missing configs in hierarchy', () => {
      const defaults: ReviewWorkflowConfig = {
        name: 'defaults',
        enabled: true,
        steps: [],
      };

      const merger = new ConfigMerger();
      const result = merger.mergeHierarchy(defaults, undefined, undefined, undefined);

      expect(result.name).toBe('defaults');
    });
  });

  describe('deep merge', () => {
    it('should deep merge nested objects', () => {
      const lower: ReviewWorkflowConfig = {
        name: 'lower',
        enabled: true,
        steps: [
          {
            name: 'step',
            type: 'custom',
            blocking: true,
            config: {
              level1: {
                level2: {
                  value1: 'a',
                  value2: 'b',
                },
              },
            },
          },
        ],
      };

      const higher: ReviewWorkflowConfig = {
        name: 'higher',
        enabled: true,
        steps: [
          {
            name: 'step',
            type: 'custom',
            blocking: true,
            config: {
              level1: {
                level2: {
                  value1: 'x',
                },
              },
            },
          },
        ],
      };

      const merger = new ConfigMerger();
      const result = merger.merge(lower, higher);

      const step = result.steps[0];
      expect(step.config).toEqual({
        level1: {
          level2: {
            value1: 'x',
            value2: 'b',
          },
        },
      });
    });

    it('should handle null and undefined values', () => {
      const lower: ReviewWorkflowConfig = {
        name: 'lower',
        enabled: true,
        steps: [],
        triggers: {
          aiGeneratedOnly: true,
          targetBranches: ['main'],
        },
      };

      const higher: ReviewWorkflowConfig = {
        name: 'higher',
        enabled: true,
        steps: [],
        triggers: {
          aiGeneratedOnly: undefined,
          targetBranches: ['develop'],
        },
      };

      const merger = new ConfigMerger();
      const result = merger.merge(lower, higher);

      expect(result.triggers?.aiGeneratedOnly).toBe(true);
      expect(result.triggers?.targetBranches).toContain('develop');
    });
  });
});
