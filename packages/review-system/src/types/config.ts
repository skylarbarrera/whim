import { ReviewStepConfig } from './review-step.js';

/**
 * Execution mode for review steps
 */
export enum ExecutionMode {
  /** Execute steps one at a time in order */
  SEQUENTIAL = 'sequential',
  /** Execute all steps in parallel */
  PARALLEL = 'parallel',
}

/**
 * Configuration for a group of review steps that run together
 */
export interface ReviewStepGroup {
  /** Group name for logging/display */
  name: string;
  /** Execution mode for steps in this group */
  mode: ExecutionMode;
  /** Review steps in this group */
  steps: ReviewStepConfig[];
  /** Whether to continue if a step in this group fails */
  continueOnFailure: boolean;
}

/**
 * Configuration for a complete review workflow
 */
export interface ReviewWorkflowConfig {
  /** Workflow name/identifier */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Whether this workflow is enabled */
  enabled: boolean;
  /** Conditions for when this workflow should run */
  triggers: {
    /** Only run for these repositories (owner/repo format) */
    repositories?: string[];
    /** Only run for PRs with these labels */
    requiredLabels?: string[];
    /** Skip PRs with these labels */
    excludedLabels?: string[];
    /** Only run for AI-generated PRs */
    aiGeneratedOnly?: boolean;
    /** Only run for PRs targeting these branches */
    targetBranches?: string[];
  };
  /** Groups of review steps to execute */
  groups: ReviewStepGroup[];
  /** Global timeout for entire workflow in milliseconds */
  timeoutMs: number;
  /** Whether to post results as PR comment */
  postComment: boolean;
  /** Whether to update GitHub commit status */
  updateStatus: boolean;
  /** Status check context name */
  statusContext: string;
}

/**
 * Repository-specific workflow overrides
 */
export interface RepositoryConfig {
  /** Repository identifier (owner/repo) */
  repository: string;
  /** Workflow configurations for this repository */
  workflows: ReviewWorkflowConfig[];
  /** Override global settings */
  overrides?: {
    /** Custom environment variables */
    env?: Record<string, string>;
    /** Custom timeout multiplier */
    timeoutMultiplier?: number;
  };
}

/**
 * Organization-level configuration
 */
export interface OrganizationConfig {
  /** Organization name */
  organization: string;
  /** Default workflows for all repos in this org */
  defaultWorkflows: ReviewWorkflowConfig[];
  /** Repository-specific overrides */
  repositories: RepositoryConfig[];
  /** Global settings */
  settings: {
    /** Maximum number of concurrent review workflows */
    maxConcurrentReviews: number;
    /** Rate limit for GitHub API calls (calls per hour) */
    githubApiRateLimit: number;
    /** Whether to cache review results */
    enableCaching: boolean;
    /** Cache TTL in seconds */
    cacheTtlSeconds: number;
  };
}

/**
 * Root configuration structure
 */
export interface ReviewSystemConfig {
  /** Configuration format version */
  version: string;
  /** Organization configurations */
  organizations: OrganizationConfig[];
  /** Global defaults */
  defaults: {
    /** Default timeout for steps (ms) */
    stepTimeoutMs: number;
    /** Default timeout for workflows (ms) */
    workflowTimeoutMs: number;
    /** Default execution mode */
    executionMode: ExecutionMode;
  };
}

/**
 * Environment-specific configuration overrides
 */
export interface EnvironmentConfig {
  /** Environment name (e.g., 'production', 'staging', 'development') */
  environment: string;
  /** Whether to enforce strict mode (all checks must pass) */
  strictMode: boolean;
  /** Override specific workflow settings */
  workflowOverrides: Record<string, Partial<ReviewWorkflowConfig>>;
  /** Feature flags */
  features: {
    /** Enable AI-powered review suggestions */
    aiSuggestions?: boolean;
    /** Enable automatic fix generation */
    autoFix?: boolean;
    /** Enable review metrics collection */
    metricsCollection?: boolean;
  };
}

/**
 * Workflow triggers - conditions for when a workflow should run
 */
export interface WorkflowTriggers {
  /** Only run for these repositories (owner/repo format) */
  repositories?: string[];
  /** Only run for PRs with these labels */
  requiredLabels?: string[];
  /** Skip PRs with these labels */
  excludedLabels?: string[];
  /** Only run for AI-generated PRs */
  aiGeneratedOnly?: boolean;
  /** Only run for PRs targeting these branches */
  targetBranches?: string[];
}

/**
 * Simple step configuration (for YAML files)
 * User-friendly format for defining review steps
 */
export interface SimpleStepConfig {
  /** Step name/identifier */
  name: string;
  /** Step type (lint, test, security, custom) */
  type: string;
  /** Whether this step blocks PR merge on failure */
  blocking?: boolean;
  /** Timeout for this step in milliseconds */
  timeout?: number;
  /** Condition expression for conditional execution */
  condition?: string;
  /** Step-specific configuration */
  config?: Record<string, any>;
}

/**
 * Simplified workflow config format (for YAML files)
 * This is the user-facing format that gets converted to ReviewWorkflowConfig
 */
export interface SimpleWorkflowConfig {
  /** Workflow name/identifier */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Whether this workflow is enabled */
  enabled?: boolean;
  /** Conditions for when this workflow should run */
  triggers?: WorkflowTriggers;
  /** Flat array of review steps */
  steps: SimpleStepConfig[];
  /** Optional grouping of steps for parallel/sequential execution */
  stepGroups?: Record<string, string[]>;
  /** Global timeout for entire workflow in milliseconds */
  timeoutMs?: number;
  /** Whether to post results as PR comment */
  postComment?: boolean;
  /** Whether to update GitHub commit status */
  updateStatus?: boolean;
  /** Status check context name */
  statusContext?: string;
}
