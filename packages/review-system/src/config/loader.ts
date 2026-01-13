import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import type { SimpleWorkflowConfig } from '../types/config.js';

export interface ConfigSource {
  type: 'file' | 'string' | 'url';
  source: string;
}

export interface LoadConfigOptions {
  fallbackToDefaults?: boolean;
  validateSchema?: boolean;
}

/**
 * Configuration loader for YAML-based review workflows
 * Supports loading from files, strings, and URLs
 */
export class ConfigLoader {
  /**
   * Load configuration from a file path
   */
  async loadFromFile(filePath: string, options?: LoadConfigOptions): Promise<SimpleWorkflowConfig> {
    try {
      const content = await readFile(filePath, 'utf-8');
      return this.loadFromString(content, options);
    } catch (error) {
      if (options?.fallbackToDefaults) {
        throw new Error(`Failed to load config from file: ${filePath}`, { cause: error });
      }
      throw error;
    }
  }

  /**
   * Load configuration from a YAML string
   */
  loadFromString(yamlString: string, options?: LoadConfigOptions): SimpleWorkflowConfig {
    try {
      const config = parse(yamlString);
      if (!config || typeof config !== 'object') {
        throw new Error('Invalid YAML: parsed result is not an object');
      }
      return config as SimpleWorkflowConfig;
    } catch (error) {
      throw new Error('Failed to parse YAML config', { cause: error });
    }
  }

  /**
   * Load configuration from a URL
   */
  async loadFromUrl(url: string, options?: LoadConfigOptions): Promise<SimpleWorkflowConfig> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const content = await response.text();
      return this.loadFromString(content, options);
    } catch (error) {
      throw new Error(`Failed to load config from URL: ${url}`, { cause: error });
    }
  }

  /**
   * Load organization-level configuration
   * Looks for .github/.review.yml in the organization's .github repository
   */
  async loadOrgConfig(org: string, options?: LoadConfigOptions): Promise<SimpleWorkflowConfig | null> {
    const patterns = [
      `.github/.review.yml`,
      `.github/.review.yaml`,
      `.review-org.yml`,
      `.review-org.yaml`,
    ];

    for (const pattern of patterns) {
      try {
        return await this.loadFromFile(pattern, options);
      } catch {
        // Try next pattern
        continue;
      }
    }

    return null;
  }

  /**
   * Load repository-specific configuration
   * Looks for .review.yml or .github/.review.yml in the repository root
   */
  async loadRepoConfig(repoPath: string, options?: LoadConfigOptions): Promise<SimpleWorkflowConfig | null> {
    const patterns = [
      `${repoPath}/.github/.review.yml`,
      `${repoPath}/.github/.review.yaml`,
      `${repoPath}/.review.yml`,
      `${repoPath}/.review.yaml`,
    ];

    for (const pattern of patterns) {
      try {
        return await this.loadFromFile(pattern, options);
      } catch {
        // Try next pattern
        continue;
      }
    }

    return null;
  }

  /**
   * Load environment-specific configuration
   * Looks for .review-{env}.yml files
   */
  async loadEnvConfig(
    repoPath: string,
    environment: string,
    options?: LoadConfigOptions
  ): Promise<SimpleWorkflowConfig | null> {
    const patterns = [
      `${repoPath}/.review-${environment}.yml`,
      `${repoPath}/.review-${environment}.yaml`,
      `${repoPath}/.github/.review-${environment}.yml`,
      `${repoPath}/.github/.review-${environment}.yaml`,
    ];

    for (const pattern of patterns) {
      try {
        return await this.loadFromFile(pattern, options);
      } catch {
        // Try next pattern
        continue;
      }
    }

    return null;
  }

  /**
   * Auto-detect and load configuration with environment support
   * Priority: environment > repo > org > defaults
   */
  async loadConfig(
    repoPath: string,
    org?: string,
    environment?: string,
    options?: LoadConfigOptions
  ): Promise<SimpleWorkflowConfig> {
    const configs: SimpleWorkflowConfig[] = [];

    // Load org config
    if (org) {
      const orgConfig = await this.loadOrgConfig(org, options);
      if (orgConfig) configs.push(orgConfig);
    }

    // Load repo config
    const repoConfig = await this.loadRepoConfig(repoPath, options);
    if (repoConfig) configs.push(repoConfig);

    // Load env config
    if (environment) {
      const envConfig = await this.loadEnvConfig(repoPath, environment, options);
      if (envConfig) configs.push(envConfig);
    }

    if (configs.length === 0) {
      throw new Error('No configuration found');
    }

    // If only one config, return it
    if (configs.length === 1) {
      return configs[0]!;
    }

    // Merge multiple configs (will be handled by ConfigMerger)
    return configs[configs.length - 1]!; // Return highest priority for now
  }
}
