// @ts-ignore - Node.js and yaml types may not be available in all environments
import fs from "fs";
// @ts-ignore
import path from "path";
// @ts-ignore
import YAML from "yaml";
import type { CheckConfig } from "./checks/base-check.js";
import { validateConfig } from "./config-validator.js";

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
  /** File patterns to include */
  include?: string[];
  /** File patterns to exclude */
  exclude?: string[];
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
  /** Minimum code coverage percentage (0-100), if supported by test framework */
  minCoverage?: number;
}

/**
 * Configuration for PR detection
 */
export interface DetectionConfig {
  /** Minimum confidence score (0-1) to classify as AI-generated */
  minConfidence: number;
  /** Branch name patterns that indicate AI-generated PRs */
  branchPatterns: string[];
  /** Label patterns that indicate AI-generated PRs */
  labelPatterns: string[];
  /** Commit author patterns to detect AI */
  authorPatterns: string[];
  /** Whether to check for Claude co-author signature */
  checkCoAuthor: boolean;
}

/**
 * Configuration for merge blocking
 */
export interface MergeBlockingConfig {
  /** Whether to enforce merge blocking */
  enabled: boolean;
  /** Names of checks that must pass before merge (empty = all required checks) */
  requiredChecks: string[];
  /** Users who can perform emergency overrides */
  overrideUsers: string[];
  /** Whether to require override reason */
  requireOverrideReason: boolean;
}

/**
 * Configuration for branch protection
 */
export interface BranchProtectionConfig {
  /** Whether to automatically configure branch protection */
  enabled: boolean;
  /** Branch patterns to protect (e.g., ["main", "develop"]) */
  branches: string[];
  /** Whether to require pull request reviews */
  requirePullRequestReviews: boolean;
  /** Number of required approving reviews */
  requiredApprovingReviews: number;
  /** Whether to dismiss stale reviews on push */
  dismissStaleReviews: boolean;
}

/**
 * Configuration for GitHub integration
 */
export interface GitHubConfig {
  /** GitHub API token (can also be provided via GITHUB_TOKEN env var) */
  token?: string;
  /** Status context name to use */
  statusContext: string;
  /** Target URL for status checks (dashboard URL) */
  targetUrl?: string;
  /** Whether to sync branch protection rules */
  syncBranchProtection: boolean;
}

/**
 * Complete PR review configuration
 */
export interface PRReviewConfig {
  /** Detection configuration */
  detection?: DetectionConfig;
  /** Lint check configuration */
  lint?: LintConfig;
  /** Test check configuration */
  test?: TestConfig;
  /** Merge blocking configuration */
  mergeBlocking?: MergeBlockingConfig;
  /** Branch protection configuration */
  branchProtection?: BranchProtectionConfig;
  /** GitHub integration configuration */
  github?: GitHubConfig;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: PRReviewConfig = {
  detection: {
    minConfidence: 0.7,
    branchPatterns: ["ai/*", "ai/issue-*", "ai/task-*"],
    labelPatterns: ["ai-generated", "automated", "bot"],
    authorPatterns: ["claude", "ai-factory"],
    checkCoAuthor: true,
  },
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
  mergeBlocking: {
    enabled: true,
    requiredChecks: [], // Empty = all required checks must pass
    overrideUsers: [],
    requireOverrideReason: true,
  },
  branchProtection: {
    enabled: false,
    branches: ["main", "master", "develop"],
    requirePullRequestReviews: true,
    requiredApprovingReviews: 1,
    dismissStaleReviews: true,
  },
  github: {
    statusContext: "ai-factory/pr-review",
    syncBranchProtection: false,
  },
};

/**
 * Load PR review configuration from .ai/pr-review.yml
 *
 * @param repoPath - Path to the repository root
 * @returns Loaded configuration, merged with defaults
 * @throws Error if configuration is invalid
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

    // Validate user config
    const validation = validateConfig(userConfig);
    if (!validation.valid) {
      const errorMessages = validation.errors
        .map((e) => `  - ${e.field}: ${e.message}`)
        .join("\n");
      throw new Error(
        `Invalid configuration in ${configPath}:\n${errorMessages}`
      );
    }

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

  // Merge detection config
  if (user.detection) {
    result.detection = {
      ...defaults.detection!,
      ...user.detection,
    };
  }

  // Merge lint config
  if (user.lint) {
    result.lint = {
      ...defaults.lint!,
      ...user.lint,
      tools: user.lint.tools || defaults.lint!.tools,
    };
  }

  // Merge test config
  if (user.test) {
    result.test = {
      ...defaults.test!,
      ...user.test,
    };
  }

  // Merge merge blocking config
  if (user.mergeBlocking) {
    result.mergeBlocking = {
      ...defaults.mergeBlocking!,
      ...user.mergeBlocking,
    };
  }

  // Merge branch protection config
  if (user.branchProtection) {
    result.branchProtection = {
      ...defaults.branchProtection!,
      ...user.branchProtection,
    };
  }

  // Merge GitHub config
  if (user.github) {
    result.github = {
      ...defaults.github!,
      ...user.github,
    };
  }

  return result;
}

/**
 * Get detection configuration
 */
export function getDetectionConfig(repoPath: string): DetectionConfig {
  const config = loadConfig(repoPath);
  return config.detection || DEFAULT_CONFIG.detection!;
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

/**
 * Get merge blocking configuration
 */
export function getMergeBlockingConfig(repoPath: string): MergeBlockingConfig {
  const config = loadConfig(repoPath);
  return config.mergeBlocking || DEFAULT_CONFIG.mergeBlocking!;
}

/**
 * Get branch protection configuration
 */
export function getBranchProtectionConfig(
  repoPath: string
): BranchProtectionConfig {
  const config = loadConfig(repoPath);
  return config.branchProtection || DEFAULT_CONFIG.branchProtection!;
}

/**
 * Get GitHub configuration
 */
export function getGitHubConfig(repoPath: string): GitHubConfig {
  const config = loadConfig(repoPath);
  return config.github || DEFAULT_CONFIG.github!;
}
