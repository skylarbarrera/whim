// @ts-ignore - Node.js and yaml types may not be available in all environments
import fs from "fs";
// @ts-ignore
import path from "path";
// @ts-ignore
import YAML from "yaml";
import type { CheckConfig } from "./checks/base-check.js";

/**
 * Configuration for a lint tool
 */
export interface LintToolConfig {
  /** Tool name (e.g., "eslint", "prettier") */
  name: string;
  /** Command to run the tool */
  command: string;
  /** Whether this tool is enabled */
  enabled: boolean;
}

/**
 * Configuration for lint checks
 */
export interface LintConfig extends CheckConfig {
  /** List of lint tools to run */
  tools: LintToolConfig[];
  /** Number of violations required to fail (0 = any violation fails) */
  failureThreshold: number;
}

/**
 * Configuration for test checks
 */
export interface TestConfig extends CheckConfig {
  /** Test command to run */
  command: string;
  /** Minimum required pass percentage (0-100) */
  minPassPercentage: number;
}

/**
 * Complete PR review configuration
 */
export interface PRReviewConfig {
  lint?: LintConfig;
  test?: TestConfig;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: PRReviewConfig = {
  lint: {
    enabled: true,
    required: true,
    timeout: 60000, // 60 seconds
    tools: [
      {
        name: "eslint",
        command: "npx eslint . --format json",
        enabled: true,
      },
      {
        name: "prettier",
        command: "npx prettier --check .",
        enabled: true,
      },
    ],
    failureThreshold: 0, // Any violation fails
  },
  test: {
    enabled: true,
    required: true,
    timeout: 300000, // 5 minutes
    command: "npm test",
    minPassPercentage: 100,
  },
};

/**
 * Load PR review configuration from .ai/pr-review.yml
 *
 * @param repoPath - Path to the repository root
 * @returns Loaded configuration, merged with defaults
 */
export function loadConfig(repoPath: string): PRReviewConfig {
  const configPath = path.join(repoPath, ".ai", "pr-review.yml");

  try {
    // Check if config file exists
    if (!fs.existsSync(configPath)) {
      return DEFAULT_CONFIG;
    }

    // Read and parse YAML file
    const fileContent = fs.readFileSync(configPath, "utf8");
    const userConfig = YAML.parse(fileContent) as Partial<PRReviewConfig>;

    // Merge with defaults (deep merge)
    return mergeConfig(DEFAULT_CONFIG, userConfig);
  } catch (error) {
    console.warn(
      `Failed to load config from ${configPath}:`,
      error instanceof Error ? error.message : String(error)
    );
    return DEFAULT_CONFIG;
  }
}

/**
 * Deep merge user config with default config
 */
function mergeConfig(
  defaults: PRReviewConfig,
  user: Partial<PRReviewConfig>
): PRReviewConfig {
  const result: PRReviewConfig = { ...defaults };

  // Merge lint config
  if (user.lint) {
    result.lint = {
      ...defaults.lint!,
      ...user.lint,
      tools:
        user.lint.tools || defaults.lint!.tools,
    };
  }

  // Merge test config
  if (user.test) {
    result.test = {
      ...defaults.test!,
      ...user.test,
    };
  }

  return result;
}

/**
 * Get lint configuration
 */
export function getLintConfig(repoPath: string): LintConfig {
  const config = loadConfig(repoPath);
  return config.lint || DEFAULT_CONFIG.lint!;
}

/**
 * Get test configuration
 */
export function getTestConfig(repoPath: string): TestConfig {
  const config = loadConfig(repoPath);
  return config.test || DEFAULT_CONFIG.test!;
}
