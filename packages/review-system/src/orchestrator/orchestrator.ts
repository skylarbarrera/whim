import { ReviewStepRegistry } from '../plugin/registry.js';
import { ReviewExecutor } from './executor.js';
import { ResultAggregator } from './aggregator.js';
import { GitHubStatusReporter } from './github-status.js';
import { ConfigLoader, ConfigMerger, createDefaultConfig } from '../config/index.js';
import {
  ReviewWorkflowConfig,
  ReviewStepGroup,
  ReviewSystemConfig,
  RepositoryConfig,
} from '../types/config.js';
import {
  ReviewContext,
  PullRequestInfo,
  ChangedFile,
} from '../types/review-context.js';
import { ReviewWorkflowResult, ReviewStatus } from '../types/review-result.js';
import { ReviewStep } from '../types/review-step.js';
import { Octokit } from '@octokit/rest';

/**
 * Logger interface for the orchestrator
 */
export interface OrchestratorLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

/**
 * Main orchestrator for executing review workflows
 */
export class ReviewOrchestrator {
  private registry: ReviewStepRegistry;
  private executor: ReviewExecutor;
  private githubToken: string;
  private logger: OrchestratorLogger;
  private workingDirectory: string;

  constructor(
    registry: ReviewStepRegistry,
    githubToken: string,
    workingDirectory: string,
    logger?: OrchestratorLogger
  ) {
    this.registry = registry;
    this.executor = new ReviewExecutor();
    this.githubToken = githubToken;
    this.workingDirectory = workingDirectory;
    this.logger = logger || this.createDefaultLogger();
  }

  /**
   * Load and parse a review workflow configuration from a file
   * Returns SimpleWorkflowConfig from YAML/JSON files
   *
   * @param configPath Path to configuration file (JSON or YAML)
   * @param options Additional options
   * @returns Parsed configuration
   */
  async loadSimpleConfig(
    configPath: string,
    options?: {
      org?: string;
      environment?: string;
      mergeWithDefaults?: boolean;
    }
  ) {
    const loader = new ConfigLoader();
    const merger = new ConfigMerger();

    // Determine if URL or file path
    const isUrl = configPath.startsWith('http://') || configPath.startsWith('https://');

    // Load the main config
    let config;
    if (isUrl) {
      config = await loader.loadFromUrl(configPath);
    } else {
      const path = await import('path');
      const ext = path.extname(configPath);

      if (ext === '.json') {
        const fs = await import('fs/promises');
        const content = await fs.readFile(configPath, 'utf-8');
        config = JSON.parse(content);
      } else if (ext === '.yaml' || ext === '.yml') {
        config = await loader.loadFromFile(configPath);
      } else {
        throw new Error(`Unsupported configuration format: ${ext}`);
      }
    }

    // Merge with defaults if requested
    if (options?.mergeWithDefaults) {
      const defaults = createDefaultConfig(options.environment);
      config = merger.mergeWithDefaults(config, defaults);
    }

    return config;
  }

  /**
   * Load configuration with hierarchy (org > repo > env)
   * Returns SimpleWorkflowConfig from YAML files
   *
   * @param repoPath Repository path
   * @param org Organization name
   * @param environment Environment name
   * @returns Merged configuration
   */
  async loadConfigWithHierarchy(
    repoPath: string,
    org?: string,
    environment?: string
  ) {
    const loader = new ConfigLoader();
    const merger = new ConfigMerger();

    // Load default config
    const defaults = createDefaultConfig(environment);

    // Load org config
    const orgConfig = org ? await loader.loadOrgConfig(org) : null;

    // Load repo config
    const repoConfig = await loader.loadRepoConfig(repoPath);

    // Load env config
    const envConfig = environment ? await loader.loadEnvConfig(repoPath, environment) : null;

    // Merge with priority
    return merger.mergeHierarchy(defaults, orgConfig || undefined, repoConfig || undefined, envConfig || undefined);
  }

  /**
   * Legacy method for backward compatibility
   * Load configuration (JSON format with groups structure)
   */
  async loadConfig(configPath: string): Promise<ReviewSystemConfig> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const content = await fs.readFile(configPath, 'utf-8');

    const ext = path.extname(configPath);
    if (ext === '.json') {
      return JSON.parse(content);
    } else {
      throw new Error('Legacy loadConfig only supports JSON format');
    }
  }

  /**
   * Run a complete review workflow for a pull request
   *
   * @param pr Pull request information
   * @param workflow Workflow configuration
   * @param env Environment variables
   * @returns Review workflow result
   */
  async runReview(
    pr: PullRequestInfo,
    workflow: ReviewWorkflowConfig,
    env: Record<string, string> = {}
  ): Promise<ReviewWorkflowResult> {
    this.logger.info(`Starting review workflow: ${workflow.name} for PR #${pr.number}`);

    // Check if workflow is enabled
    if (!workflow.enabled) {
      this.logger.warn(`Workflow ${workflow.name} is disabled, skipping`);
      return this.createSkippedResult(workflow.name);
    }

    // Check workflow triggers
    if (!this.shouldRunWorkflow(workflow, pr)) {
      this.logger.info(`Workflow ${workflow.name} triggers not met, skipping`);
      return this.createSkippedResult(workflow.name);
    }

    const startedAt = new Date();
    const aggregator = new ResultAggregator();

    // Fetch changed files
    const changedFiles = await this.fetchChangedFiles(pr);

    // Build review context
    const context = this.buildContext(pr, changedFiles, env);

    // Initialize GitHub status reporter
    const statusReporter = new GitHubStatusReporter(this.githubToken);
    let checkRunId: number | undefined;

    try {
      // Create GitHub check run
      if (workflow.updateStatus) {
        checkRunId = await statusReporter.createCheckRun(pr, workflow.name);
      }

      // Execute workflow groups
      const result = await this.executeWorkflow(workflow, context, aggregator);

      // Update GitHub check run with results
      if (workflow.updateStatus && checkRunId) {
        await statusReporter.updateCheckRun(pr, checkRunId, result);
      }

      // Post commit status (legacy API)
      if (workflow.updateStatus && workflow.statusContext) {
        await statusReporter.postCommitStatus(pr, result, workflow.statusContext);
      }

      this.logger.info(
        `Review workflow ${workflow.name} completed with status: ${result.status}`
      );

      return result;
    } catch (error) {
      this.logger.error(`Review workflow ${workflow.name} failed: ${error}`);

      // Create error result
      const completedAt = new Date();
      const errorResult: ReviewWorkflowResult = {
        status: ReviewStatus.ERROR,
        stepResults: aggregator.getSummary(startedAt).stepResults,
        totalDurationMs: completedAt.getTime() - startedAt.getTime(),
        startedAt,
        completedAt,
        summary: {
          totalSteps: 0,
          passedSteps: 0,
          failedSteps: 0,
          errorSteps: 1,
          skippedSteps: 0,
        },
      };

      // Update GitHub check run with error
      if (workflow.updateStatus && checkRunId) {
        await statusReporter.updateCheckRun(pr, checkRunId, errorResult);
      }

      throw error;
    }
  }

  /**
   * Find the appropriate workflow for a repository
   *
   * @param config System configuration
   * @param pr Pull request information
   * @returns Repository configuration or null
   */
  findRepositoryConfig(
    config: ReviewSystemConfig,
    pr: PullRequestInfo
  ): RepositoryConfig | null {
    const repoFullName = `${pr.owner}/${pr.repo}`;

    for (const org of config.organizations) {
      for (const repoConfig of org.repositories) {
        if (repoConfig.repository === repoFullName) {
          return repoConfig;
        }
      }
    }

    return null;
  }

  /**
   * Build review context from PR information
   *
   * @param pr Pull request information
   * @param changedFiles Changed files in PR
   * @param env Environment variables
   * @returns Review context
   */
  private buildContext(
    pr: PullRequestInfo,
    changedFiles: ChangedFile[],
    env: Record<string, string>
  ): ReviewContext {
    return {
      pr,
      changedFiles,
      workingDirectory: this.workingDirectory,
      githubToken: this.githubToken,
      env: { ...process.env, ...env } as Record<string, string>,
      sharedData: {},
      logger: this.logger,
    };
  }

  /**
   * Execute all groups in a workflow
   *
   * @param workflow Workflow configuration
   * @param context Review context
   * @param aggregator Result aggregator
   * @returns Workflow result
   */
  private async executeWorkflow(
    workflow: ReviewWorkflowConfig,
    context: ReviewContext,
    aggregator: ResultAggregator
  ): Promise<ReviewWorkflowResult> {
    const startedAt = new Date();

    // Initialize all steps from workflow configuration
    const stepInstances = await this.initializeSteps(workflow);

    // Execute each group in sequence
    for (const group of workflow.groups) {
      try {
        const results = await this.executor.executeGroup(
          group,
          stepInstances,
          context
        );
        aggregator.addResults(results);

        // Check if we should stop due to blocking failures
        const blockingFailures = results.filter(
          r =>
            r.status === ReviewStatus.FAIL &&
            workflow.groups
              .find(g => g.name === group.name)
              ?.steps.find(s => s.name === r.stepName)?.blocking
        );

        if (blockingFailures.length > 0 && !group.continueOnFailure) {
          this.logger.warn(
            `Stopping workflow due to ${blockingFailures.length} blocking failure(s)`
          );
          break;
        }
      } catch (error) {
        this.logger.error(`Group ${group.name} failed: ${error}`);
        // Continue to next group unless this is a critical error
      }
    }

    return aggregator.getSummary(startedAt);
  }

  /**
   * Initialize all review step instances for a workflow
   *
   * @param workflow Workflow configuration
   * @returns Map of step ID to step instance
   */
  private async initializeSteps(
    workflow: ReviewWorkflowConfig
  ): Promise<Map<string, ReviewStep>> {
    const stepInstances = new Map<string, ReviewStep>();

    for (const group of workflow.groups) {
      for (const stepConfig of group.steps) {
        if (!stepConfig.enabled) {
          continue;
        }

        // Get step type from config options
        const stepType = (stepConfig.options.type as string) || 'unknown';

        // Create step instance from registry
        const step = await this.registry.create(stepType, stepConfig);
        stepInstances.set(stepConfig.id, step);
      }
    }

    return stepInstances;
  }

  /**
   * Check if workflow should run based on triggers
   *
   * @param workflow Workflow configuration
   * @param pr Pull request information
   * @returns True if workflow should run
   */
  private shouldRunWorkflow(
    workflow: ReviewWorkflowConfig,
    pr: PullRequestInfo
  ): boolean {
    const { triggers } = workflow;

    // Check repository filter
    if (triggers.repositories && triggers.repositories.length > 0) {
      const repoFullName = `${pr.owner}/${pr.repo}`;
      if (!triggers.repositories.includes(repoFullName)) {
        return false;
      }
    }

    // Check AI-generated only
    if (triggers.aiGeneratedOnly && !pr.isAiGenerated) {
      return false;
    }

    // Check required labels
    if (triggers.requiredLabels && triggers.requiredLabels.length > 0) {
      const hasAllLabels = triggers.requiredLabels.every(label =>
        pr.labels.includes(label)
      );
      if (!hasAllLabels) {
        return false;
      }
    }

    // Check excluded labels
    if (triggers.excludedLabels && triggers.excludedLabels.length > 0) {
      const hasExcludedLabel = triggers.excludedLabels.some(label =>
        pr.labels.includes(label)
      );
      if (hasExcludedLabel) {
        return false;
      }
    }

    // Check target branches
    if (triggers.targetBranches && triggers.targetBranches.length > 0) {
      if (!triggers.targetBranches.includes(pr.baseBranch)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Fetch changed files from GitHub
   *
   * @param pr Pull request information
   * @returns Array of changed files
   */
  private async fetchChangedFiles(pr: PullRequestInfo): Promise<ChangedFile[]> {
    const octokit = new Octokit({ auth: this.githubToken });

    const { data: files } = await octokit.pulls.listFiles({
      owner: pr.owner,
      repo: pr.repo,
      pull_number: pr.number,
    });

    return files.map(file => ({
      path: file.filename,
      changeType: file.status as 'added' | 'modified' | 'deleted' | 'renamed',
      additions: file.additions,
      deletions: file.deletions,
      previousPath: file.previous_filename,
      patch: file.patch,
    }));
  }

  /**
   * Create a skipped workflow result
   *
   * @param workflowName Name of the workflow
   * @returns Skipped workflow result
   */
  private createSkippedResult(workflowName: string): ReviewWorkflowResult {
    const now = new Date();
    return {
      status: ReviewStatus.SKIPPED,
      stepResults: [],
      totalDurationMs: 0,
      startedAt: now,
      completedAt: now,
      summary: {
        totalSteps: 0,
        passedSteps: 0,
        failedSteps: 0,
        errorSteps: 0,
        skippedSteps: 0,
      },
    };
  }

  /**
   * Create a default console logger
   */
  private createDefaultLogger(): OrchestratorLogger {
    return {
      info: (msg: string) => console.log(`[INFO] ${msg}`),
      warn: (msg: string) => console.warn(`[WARN] ${msg}`),
      error: (msg: string) => console.error(`[ERROR] ${msg}`),
      debug: (msg: string) => console.debug(`[DEBUG] ${msg}`),
    };
  }
}
