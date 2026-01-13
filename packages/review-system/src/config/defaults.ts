import type { SimpleWorkflowConfig } from '../types/config.js';
import type { SimpleStepConfig } from '../types/config.js';

/**
 * Default configuration templates for common use cases
 */

/**
 * Create default lint step configuration
 */
export function defaultLintStep(): SimpleStepConfig {
  return {
    name: 'lint',
    type: 'lint',
    blocking: true,
    timeout: 300000, // 5 minutes
    config: {
      linters: [
        {
          type: 'eslint',
          filePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
        },
        {
          type: 'prettier',
          filePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.json', '**/*.md'],
        },
      ],
      failOn: 'error',
    },
  };
}

/**
 * Create default test step configuration
 */
export function defaultTestStep(): SimpleStepConfig {
  return {
    name: 'test',
    type: 'test',
    blocking: true,
    timeout: 600000, // 10 minutes
    config: {
      runner: 'detect', // Auto-detect test runner
      coverage: true,
      coverageThresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
      failOn: 'failure',
    },
  };
}

/**
 * Create default security scan step configuration
 */
export function defaultSecurityStep(): SimpleStepConfig {
  return {
    name: 'security',
    type: 'security',
    blocking: true,
    timeout: 300000, // 5 minutes
    config: {
      scanners: ['npm-audit', 'snyk'],
      severityThreshold: 'high',
    },
  };
}

/**
 * Create minimal workflow (lint only)
 */
export function createMinimalConfig(): SimpleWorkflowConfig {
  return {
    name: 'minimal-review',
    enabled: true,
    triggers: {
      aiGeneratedOnly: false,
      targetBranches: ['main', 'master', 'develop'],
    },
    steps: [defaultLintStep()],
  };
}

/**
 * Create standard workflow (lint + test)
 */
export function createStandardConfig(): SimpleWorkflowConfig {
  return {
    name: 'standard-review',
    enabled: true,
    triggers: {
      aiGeneratedOnly: false,
      targetBranches: ['main', 'master', 'develop'],
    },
    steps: [defaultLintStep(), defaultTestStep()],
    stepGroups: {
      validation: ['lint', 'test'],
    },
  };
}

/**
 * Create full workflow (lint + test + security + coverage)
 */
export function createFullConfig(): SimpleWorkflowConfig {
  return {
    name: 'full-review',
    enabled: true,
    triggers: {
      aiGeneratedOnly: false,
      targetBranches: ['main', 'master', 'develop'],
    },
    steps: [defaultLintStep(), defaultTestStep(), defaultSecurityStep()],
    stepGroups: {
      validation: ['lint', 'test'],
      security: ['security'],
    },
  };
}

/**
 * Create AI-specific workflow
 */
export function createAIConfig(): SimpleWorkflowConfig {
  return {
    name: 'ai-review',
    enabled: true,
    triggers: {
      aiGeneratedOnly: true,
      targetBranches: ['main', 'master', 'develop'],
      requiredLabels: ['ai-generated'],
    },
    steps: [
      defaultLintStep(),
      defaultTestStep(),
      {
        name: 'ai-quality-check',
        type: 'custom',
        blocking: true,
        timeout: 300000,
        config: {
          checks: [
            'code-complexity',
            'documentation-quality',
            'test-coverage',
            'security-patterns',
          ],
        },
      },
    ],
    stepGroups: {
      validation: ['lint', 'test'],
      quality: ['ai-quality-check'],
    },
  };
}

/**
 * Create development environment config
 */
export function createDevConfig(): SimpleWorkflowConfig {
  return {
    name: 'dev-review',
    enabled: true,
    triggers: {
      aiGeneratedOnly: false,
      targetBranches: ['develop', 'dev', 'feature/*'],
    },
    steps: [
      {
        ...defaultLintStep(),
        blocking: false, // Non-blocking in dev
      },
      {
        ...defaultTestStep(),
        blocking: false,
        config: {
          runner: 'detect',
          coverage: false, // Skip coverage in dev
        },
      },
    ],
  };
}

/**
 * Create production environment config
 */
export function createProdConfig(): SimpleWorkflowConfig {
  return {
    name: 'prod-review',
    enabled: true,
    triggers: {
      aiGeneratedOnly: false,
      targetBranches: ['main', 'master', 'release/*'],
    },
    steps: [
      defaultLintStep(),
      {
        ...defaultTestStep(),
        config: {
          runner: 'detect',
          coverage: true,
          coverageThresholds: {
            lines: 90,
            functions: 90,
            branches: 85,
            statements: 90,
          },
        },
      },
      defaultSecurityStep(),
    ],
    stepGroups: {
      validation: ['lint', 'test'],
      security: ['security'],
    },
  };
}

/**
 * Get default config by name
 */
export function getDefaultConfig(name: string): SimpleWorkflowConfig | null {
  const configs: Record<string, () => SimpleWorkflowConfig> = {
    minimal: createMinimalConfig,
    standard: createStandardConfig,
    full: createFullConfig,
    ai: createAIConfig,
    dev: createDevConfig,
    prod: createProdConfig,
  };

  const factory = configs[name];
  return factory ? factory() : null;
}

/**
 * Create default config based on environment
 */
export function createDefaultConfig(environment?: string): SimpleWorkflowConfig {
  switch (environment?.toLowerCase()) {
    case 'dev':
    case 'development':
      return createDevConfig();
    case 'prod':
    case 'production':
      return createProdConfig();
    default:
      return createStandardConfig();
  }
}
