import type { SimpleWorkflowConfig } from '../types/config.js';
import type { SimpleStepConfig } from '../types/config.js';

export interface MergeOptions {
  /**
   * Strategy for merging arrays
   * - 'replace': Higher priority array replaces lower priority
   * - 'concat': Arrays are concatenated
   * - 'unique': Arrays are concatenated and deduplicated
   */
  arrayStrategy?: 'replace' | 'concat' | 'unique';

  /**
   * Whether to preserve step order from lower priority configs
   */
  preserveStepOrder?: boolean;
}

/**
 * Configuration merger for combining multiple config sources
 * Priority order: environment > repo > org > defaults
 */
export class ConfigMerger {
  private options: Required<MergeOptions>;

  constructor(options: MergeOptions = {}) {
    this.options = {
      arrayStrategy: options.arrayStrategy ?? 'unique',
      preserveStepOrder: options.preserveStepOrder ?? false,
    };
  }

  /**
   * Merge multiple configs with priority
   * Configs are passed in priority order (lowest to highest)
   */
  merge(...configs: SimpleWorkflowConfig[]): SimpleWorkflowConfig {
    if (configs.length === 0) {
      throw new Error('At least one config is required');
    }

    if (configs.length === 1) {
      return configs[0];
    }

    let result: SimpleWorkflowConfig = configs[0];
    for (let i = 1; i < configs.length; i++) {
      result = this.mergeTwoConfigs(result, configs[i]);
    }

    return result;
  }

  /**
   * Merge two configs (higher priority wins)
   */
  private mergeTwoConfigs(
    lower: SimpleWorkflowConfig,
    higher: SimpleWorkflowConfig
  ): SimpleWorkflowConfig {
    return {
      name: higher.name ?? lower.name,
      enabled: higher.enabled ?? lower.enabled,
      triggers: this.mergeTriggers(lower.triggers, higher.triggers),
      steps: this.mergeSteps(lower.steps, higher.steps),
      stepGroups: this.mergeStepGroups(lower.stepGroups, higher.stepGroups),
    };
  }

  /**
   * Merge triggers (higher priority overrides)
   */
  private mergeTriggers(
    lower: SimpleWorkflowConfig['triggers'],
    higher: SimpleWorkflowConfig['triggers']
  ): SimpleWorkflowConfig['triggers'] {
    if (!lower && !higher) return undefined;
    if (!lower) return higher;
    if (!higher) return lower;

    return {
      repositories: this.mergeArray(lower.repositories, higher.repositories),
      requiredLabels: this.mergeArray(lower.requiredLabels, higher.requiredLabels),
      excludedLabels: this.mergeArray(lower.excludedLabels, higher.excludedLabels),
      targetBranches: this.mergeArray(lower.targetBranches, higher.targetBranches),
      aiGeneratedOnly: higher.aiGeneratedOnly ?? lower.aiGeneratedOnly,
    };
  }

  /**
   * Merge step arrays
   */
  private mergeSteps(lower: SimpleStepConfig[], higher: SimpleStepConfig[]): SimpleStepConfig[] {
    const lowerMap = new Map(lower.map((step) => [step.name, step]));
    const higherMap = new Map(higher.map((step) => [step.name, step]));

    // Start with lower priority steps
    const result: SimpleStepConfig[] = [];
    const processed = new Set<string>();

    if (this.options.preserveStepOrder) {
      // Preserve order from lower, update with higher
      for (const step of lower) {
        const higherStep = higherMap.get(step.name);
        result.push(higherStep ? this.mergeStepConfig(step, higherStep) : step);
        processed.add(step.name);
      }

      // Add new steps from higher
      for (const step of higher) {
        if (!processed.has(step.name)) {
          result.push(step);
        }
      }
    } else {
      // Use order from higher, backfill from lower
      for (const step of higher) {
        const lowerStep = lowerMap.get(step.name);
        result.push(lowerStep ? this.mergeStepConfig(lowerStep, step) : step);
        processed.add(step.name);
      }

      // Add remaining steps from lower
      for (const step of lower) {
        if (!processed.has(step.name)) {
          result.push(step);
        }
      }
    }

    return result;
  }

  /**
   * Merge individual step configs
   */
  private mergeStepConfig(lower: SimpleStepConfig, higher: SimpleStepConfig): SimpleStepConfig {
    return {
      name: higher.name ?? lower.name,
      type: higher.type ?? lower.type,
      blocking: higher.blocking ?? lower.blocking,
      timeout: higher.timeout ?? lower.timeout,
      condition: higher.condition ?? lower.condition,
      config: this.mergeDeep(lower.config, higher.config),
    };
  }

  /**
   * Merge step groups
   */
  private mergeStepGroups(
    lower: SimpleWorkflowConfig['stepGroups'],
    higher: SimpleWorkflowConfig['stepGroups']
  ): SimpleWorkflowConfig['stepGroups'] {
    if (!lower && !higher) return undefined;
    if (!lower) return higher;
    if (!higher) return lower;

    const result: Record<string, string[]> = { ...lower };

    for (const [groupName, steps] of Object.entries(higher)) {
      if (result[groupName]) {
        result[groupName] = this.mergeArray(result[groupName], steps) as string[];
      } else {
        result[groupName] = steps;
      }
    }

    return result;
  }

  /**
   * Merge arrays based on strategy
   */
  private mergeArray<T>(lower: T[] | undefined, higher: T[] | undefined): T[] | undefined {
    if (!lower && !higher) return undefined;
    if (!lower) return higher;
    if (!higher) return lower;

    switch (this.options.arrayStrategy) {
      case 'replace':
        return higher;
      case 'concat':
        return [...lower, ...higher];
      case 'unique':
        return Array.from(new Set([...lower, ...higher]));
    }
  }

  /**
   * Deep merge objects
   */
  private mergeDeep<T extends Record<string, any>>(lower: T | undefined, higher: T | undefined): T | undefined {
    if (!lower && !higher) return undefined;
    if (!lower) return higher;
    if (!higher) return lower;

    const result: any = { ...lower };

    for (const [key, value] of Object.entries(higher)) {
      if (value === null || value === undefined) {
        continue;
      }

      if (Array.isArray(value)) {
        result[key] = this.mergeArray(result[key] as any, value);
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.mergeDeep(result[key], value);
      } else {
        result[key] = value;
      }
    }

    return result as T;
  }

  /**
   * Merge with defaults
   */
  mergeWithDefaults(config: SimpleWorkflowConfig, defaults: SimpleWorkflowConfig): SimpleWorkflowConfig {
    return this.merge(defaults, config);
  }

  /**
   * Merge org, repo, and env configs
   */
  mergeHierarchy(
    defaults: SimpleWorkflowConfig,
    org?: SimpleWorkflowConfig,
    repo?: SimpleWorkflowConfig,
    env?: SimpleWorkflowConfig
  ): SimpleWorkflowConfig {
    const configs = [defaults, org, repo, env].filter((c): c is SimpleWorkflowConfig => c !== undefined);
    return this.merge(...configs);
  }
}
