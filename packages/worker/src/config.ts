import { readFile } from 'fs/promises';
import { join } from 'path';
import yaml from 'js-yaml';
import type { RalphConfig, WhimConfig, HarnessType, ProjectType } from '@whim/shared';

/** Raw YAML config shape for .ralphie/config.yml */
interface RawRalphConfig {
  harness?: string;
}

/** Raw verification config shape */
interface RawVerificationConfig {
  enabled?: boolean;
  browser?: boolean;
  unit?: boolean;
  api?: boolean;
}

/** Raw package config shape */
interface RawPackageConfig {
  path?: string;
  type?: string;
  verification?: RawVerificationConfig;
}

/** Raw YAML config shape for .whim/config.yml */
interface RawWhimConfig {
  type?: string;
  verification?: RawVerificationConfig;
  packages?: RawPackageConfig[];
}

/**
 * Reads and parses .ralphie/config.yml from the target repository.
 * Returns null if file doesn't exist or is invalid.
 */
export async function readRalphConfig(repoPath: string): Promise<RalphConfig | null> {
  try {
    const configPath = join(repoPath, '.ralphie', 'config.yml');
    const content = await readFile(configPath, 'utf-8');
    const config = yaml.load(content) as RawRalphConfig | null;

    // Validate structure
    if (!config || typeof config !== 'object') {
      console.warn('[config] Invalid .ralphie/config.yml: not an object');
      return null;
    }

    if (!config.harness) {
      console.warn('[config] Invalid .ralphie/config.yml: missing harness field');
      return null;
    }

    const validHarnesses: HarnessType[] = ['claude-code', 'codex', 'opencode'];
    if (!validHarnesses.includes(config.harness as HarnessType)) {
      console.warn(
        `[config] Invalid harness: ${config.harness}. Expected one of: ${validHarnesses.join(', ')}`
      );
      return null;
    }

    return {
      harness: config.harness as HarnessType,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log('[config] No .ralphie/config.yml found, using defaults');
      return null;
    }
    console.error('[config] Error reading .ralphie/config.yml:', error);
    return null;
  }
}

/**
 * Reads and parses .whim/config.yml from the target repository.
 * Returns null if file doesn't exist or is invalid.
 */
export async function readWhimConfig(repoPath: string): Promise<WhimConfig | null> {
  try {
    const configPath = join(repoPath, '.whim', 'config.yml');
    const content = await readFile(configPath, 'utf-8');
    const config = yaml.load(content) as RawWhimConfig | null;

    // Validate structure
    if (!config || typeof config !== 'object') {
      console.warn('[config] Invalid .whim/config.yml: not an object');
      return null;
    }

    if (!config.type) {
      console.warn('[config] Invalid .whim/config.yml: missing type field');
      return null;
    }

    const validTypes: ProjectType[] = ['web', 'api', 'cli', 'library', 'monorepo'];
    if (!validTypes.includes(config.type as ProjectType)) {
      console.warn(
        `[config] Invalid type: ${config.type}. Expected one of: ${validTypes.join(', ')}`
      );
      return null;
    }

    if (!config.verification || typeof config.verification !== 'object') {
      console.warn('[config] Invalid .whim/config.yml: missing or invalid verification field');
      return null;
    }

    if (typeof config.verification.enabled !== 'boolean') {
      console.warn('[config] Invalid .whim/config.yml: verification.enabled must be a boolean');
      return null;
    }

    const whimConfig: WhimConfig = {
      type: config.type as ProjectType,
      verification: {
        enabled: config.verification.enabled,
        browser: config.verification.browser,
        unit: config.verification.unit,
        api: config.verification.api,
      },
    };

    // Handle monorepo packages
    if (config.type === 'monorepo' && Array.isArray(config.packages)) {
      whimConfig.packages = config.packages.map((pkg: RawPackageConfig) => ({
        path: pkg.path ?? '',
        type: (pkg.type ?? 'library') as ProjectType,
        verification: {
          enabled: pkg.verification?.enabled ?? true,
          browser: pkg.verification?.browser,
          unit: pkg.verification?.unit,
          api: pkg.verification?.api,
        },
      }));
    }

    return whimConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log('[config] No .whim/config.yml found, using defaults');
      return null;
    }
    console.error('[config] Error reading .whim/config.yml:', error);
    return null;
  }
}

/**
 * Returns default Ralph config (claude-code harness)
 */
export function getDefaultRalphConfig(): RalphConfig {
  return {
    harness: 'claude-code',
  };
}

/**
 * Returns default Whim config (verification enabled)
 */
export function getDefaultWhimConfig(): WhimConfig {
  return {
    type: 'library',
    verification: {
      enabled: true,
      unit: true,
    },
  };
}
