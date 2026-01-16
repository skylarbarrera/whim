/**
 * Verifier Configuration
 *
 * Parses .whim/verifier.yml for per-repo configuration.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

/**
 * Code review category configuration.
 */
export interface CategoryConfig {
  security: boolean;
  bugs: boolean;
  performance: boolean;
  quality: boolean;
  api_contract: boolean;
}

/**
 * Custom review rule.
 */
export interface CustomRule {
  pattern: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  category: keyof CategoryConfig;
}

/**
 * Code review settings.
 */
export interface CodeReviewConfig {
  categories: CategoryConfig;
  minSeverity: 'error' | 'warning' | 'info';
  customRules: CustomRule[];
}

/**
 * Required checks configuration.
 */
export interface RequiredChecksConfig {
  specCheck: boolean;
  codeReview: boolean;
  testRun: boolean;
  typeCheck: boolean;
}

/**
 * Optional checks configuration.
 */
export interface OptionalChecksConfig {
  browserCheck: boolean;
  temporaryTests: boolean;
  integrationCheck: boolean;
}

/**
 * Build configuration.
 */
export interface BuildConfig {
  command: string;
  devCommand: string;
  port: number;
  startupTimeout: number;
}

/**
 * Browser check configuration.
 */
export interface BrowserConfig {
  pages: string[];
  viewport: [number, number];
  captureScreenshots: boolean;
}

/**
 * Test configuration.
 */
export interface TestConfig {
  command: string;
  timeout: number;
}

/**
 * Type check configuration.
 */
export interface TypeCheckConfig {
  command: string;
}

/**
 * Integration check configuration.
 */
export interface IntegrationConfig {
  timeout: number;
}

/**
 * Threshold configuration.
 */
export interface ThresholdsConfig {
  maxCodeIssues: number;
  minTestCoverage: number;
  failOnScopeCreep: boolean;
}

/**
 * Budget configuration for cost control.
 */
export interface BudgetConfig {
  maxCostUsd: number;
  maxDurationMin: number;
  maxLlmCalls: number;
}

/**
 * Full verifier configuration.
 */
export interface VerifierConfig {
  enabled: boolean;
  harness: 'claude' | 'codex';

  required: RequiredChecksConfig;
  optional: OptionalChecksConfig;

  codeReview: CodeReviewConfig;
  build: BuildConfig;
  browser: BrowserConfig;
  tests: TestConfig;
  typeCheck: TypeCheckConfig;
  integration: IntegrationConfig;
  thresholds: ThresholdsConfig;
  budget: BudgetConfig;
}

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: VerifierConfig = {
  enabled: true,
  harness: 'claude',

  required: {
    specCheck: true,
    codeReview: true,
    testRun: true,
    typeCheck: true,
  },

  optional: {
    browserCheck: true,
    temporaryTests: true,
    integrationCheck: true,
  },

  codeReview: {
    categories: {
      security: true,
      bugs: true,
      performance: true,
      quality: true,
      api_contract: true,
    },
    minSeverity: 'warning',
    customRules: [],
  },

  build: {
    command: 'npm run build',
    devCommand: 'npm run dev',
    port: 3000,
    startupTimeout: 60000,
  },

  browser: {
    pages: ['/'],
    viewport: [1280, 720],
    captureScreenshots: false,
  },

  tests: {
    command: 'npm test',
    timeout: 300000, // 5 min
  },

  typeCheck: {
    command: 'npm run typecheck',
  },

  integration: {
    timeout: 180000, // 3 min
  },

  thresholds: {
    maxCodeIssues: 10,
    minTestCoverage: 0,
    failOnScopeCreep: false,
  },

  budget: {
    maxCostUsd: 0.50,
    maxDurationMin: 10,
    maxLlmCalls: 20,
  },
};

/**
 * Deep merge two objects.
 */
function deepMerge(
  target: VerifierConfig,
  source: Partial<VerifierConfig>
): VerifierConfig {
  return {
    enabled: source.enabled ?? target.enabled,
    harness: source.harness ?? target.harness,
    required: { ...target.required, ...source.required },
    optional: { ...target.optional, ...source.optional },
    codeReview: {
      ...target.codeReview,
      ...source.codeReview,
      categories: { ...target.codeReview.categories, ...source.codeReview?.categories },
      customRules: source.codeReview?.customRules ?? target.codeReview.customRules,
    },
    build: { ...target.build, ...source.build },
    browser: {
      ...target.browser,
      ...source.browser,
      viewport: source.browser?.viewport ?? target.browser.viewport,
    },
    tests: { ...target.tests, ...source.tests },
    typeCheck: { ...target.typeCheck, ...source.typeCheck },
    integration: { ...target.integration, ...source.integration },
    thresholds: { ...target.thresholds, ...source.thresholds },
    budget: { ...target.budget, ...source.budget },
  };
}

/**
 * Load verifier configuration from a directory.
 *
 * Looks for .whim/verifier.yml in the given directory.
 * Returns default config if file not found.
 *
 * @param repoDir - The repository directory
 * @returns The merged configuration
 */
export function loadConfig(repoDir: string): VerifierConfig {
  const configPath = path.join(repoDir, '.whim', 'verifier.yml');

  if (!fs.existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = yaml.load(content) as { verifier?: Partial<VerifierConfig> };

    if (!parsed || !parsed.verifier) {
      return DEFAULT_CONFIG;
    }

    return deepMerge(DEFAULT_CONFIG, parsed.verifier);
  } catch (error) {
    console.warn(`Failed to parse verifier config at ${configPath}:`, error);
    return DEFAULT_CONFIG;
  }
}

/**
 * Validate configuration.
 *
 * @param config - The configuration to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateConfig(config: VerifierConfig): string[] {
  const errors: string[] = [];

  if (config.build.port < 1 || config.build.port > 65535) {
    errors.push('build.port must be between 1 and 65535');
  }

  if (config.build.startupTimeout < 1000) {
    errors.push('build.startupTimeout must be at least 1000ms');
  }

  if (config.tests.timeout < 1000) {
    errors.push('tests.timeout must be at least 1000ms');
  }

  if (config.budget.maxCostUsd <= 0) {
    errors.push('budget.maxCostUsd must be positive');
  }

  if (config.budget.maxDurationMin <= 0) {
    errors.push('budget.maxDurationMin must be positive');
  }

  if (config.thresholds.minTestCoverage < 0 || config.thresholds.minTestCoverage > 100) {
    errors.push('thresholds.minTestCoverage must be between 0 and 100');
  }

  return errors;
}
