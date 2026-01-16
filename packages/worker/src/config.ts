import { readFile } from "fs/promises";
import { join } from "path";
import yaml from "js-yaml";
import type { RalphConfig, WhimConfig } from "@whim/shared";

/**
 * Reads and parses .ralph/config.yml from the target repository.
 * Returns null if file doesn't exist or is invalid.
 */
export async function readRalphConfig(
  repoPath: string
): Promise<RalphConfig | null> {
  try {
    const configPath = join(repoPath, ".ralph", "config.yml");
    const content = await readFile(configPath, "utf-8");
    const config = yaml.load(content) as any;

    // Validate structure
    if (!config || typeof config !== "object") {
      console.warn("[config] Invalid .ralph/config.yml: not an object");
      return null;
    }

    if (!config.harness) {
      console.warn(
        "[config] Invalid .ralph/config.yml: missing harness field"
      );
      return null;
    }

    const validHarnesses = ["claude-code", "codex", "opencode"];
    if (!validHarnesses.includes(config.harness)) {
      console.warn(
        `[config] Invalid harness: ${config.harness}. Expected one of: ${validHarnesses.join(", ")}`
      );
      return null;
    }

    return {
      harness: config.harness,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.log("[config] No .ralph/config.yml found, using defaults");
      return null;
    }
    console.error("[config] Error reading .ralph/config.yml:", error);
    return null;
  }
}

/**
 * Reads and parses .whim/config.yml from the target repository.
 * Returns null if file doesn't exist or is invalid.
 */
export async function readWhimConfig(
  repoPath: string
): Promise<WhimConfig | null> {
  try {
    const configPath = join(repoPath, ".whim", "config.yml");
    const content = await readFile(configPath, "utf-8");
    const config = yaml.load(content) as any;

    // Validate structure
    if (!config || typeof config !== "object") {
      console.warn("[config] Invalid .whim/config.yml: not an object");
      return null;
    }

    if (!config.type) {
      console.warn("[config] Invalid .whim/config.yml: missing type field");
      return null;
    }

    const validTypes = ["web", "api", "cli", "library", "monorepo"];
    if (!validTypes.includes(config.type)) {
      console.warn(
        `[config] Invalid type: ${config.type}. Expected one of: ${validTypes.join(", ")}`
      );
      return null;
    }

    if (!config.verification || typeof config.verification !== "object") {
      console.warn(
        "[config] Invalid .whim/config.yml: missing or invalid verification field"
      );
      return null;
    }

    if (typeof config.verification.enabled !== "boolean") {
      console.warn(
        "[config] Invalid .whim/config.yml: verification.enabled must be a boolean"
      );
      return null;
    }

    const whimConfig: WhimConfig = {
      type: config.type,
      verification: {
        enabled: config.verification.enabled,
        browser: config.verification.browser,
        unit: config.verification.unit,
        api: config.verification.api,
      },
    };

    // Handle monorepo packages
    if (config.type === "monorepo" && Array.isArray(config.packages)) {
      whimConfig.packages = config.packages.map((pkg: any) => ({
        path: pkg.path,
        type: pkg.type,
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
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.log("[config] No .whim/config.yml found, using defaults");
      return null;
    }
    console.error("[config] Error reading .whim/config.yml:", error);
    return null;
  }
}

/**
 * Returns default Ralph config (claude-code harness)
 */
export function getDefaultRalphConfig(): RalphConfig {
  return {
    harness: "claude-code",
  };
}

/**
 * Returns default Whim config (verification enabled)
 */
export function getDefaultWhimConfig(): WhimConfig {
  return {
    type: "library",
    verification: {
      enabled: true,
      unit: true,
    },
  };
}
