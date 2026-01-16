import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  readRalphConfig,
  readWhimConfig,
  getDefaultRalphConfig,
  getDefaultWhimConfig,
} from "./config";

describe("Config Reader", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "whim-config-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("readRalphConfig", () => {
    it("should read valid ralph config", async () => {
      await mkdir(join(testDir, ".ralph"), { recursive: true });
      await writeFile(
        join(testDir, ".ralph", "config.yml"),
        "harness: claude-code\n"
      );

      const config = await readRalphConfig(testDir);
      expect(config).toEqual({ harness: "claude-code" });
    });

    it("should accept all valid harness types", async () => {
      await mkdir(join(testDir, ".ralph"), { recursive: true });

      const harnesses: Array<"claude-code" | "codex" | "opencode"> = [
        "claude-code",
        "codex",
        "opencode",
      ];
      for (const harness of harnesses) {
        await writeFile(
          join(testDir, ".ralph", "config.yml"),
          `harness: ${harness}\n`
        );
        const config = await readRalphConfig(testDir);
        expect(config).toEqual({ harness });
      }
    });

    it("should return null if file doesn't exist", async () => {
      const config = await readRalphConfig(testDir);
      expect(config).toBeNull();
    });

    it("should return null for invalid YAML", async () => {
      await mkdir(join(testDir, ".ralph"), { recursive: true });
      await writeFile(
        join(testDir, ".ralph", "config.yml"),
        "invalid: yaml: content:\n  - broken"
      );

      const config = await readRalphConfig(testDir);
      expect(config).toBeNull();
    });

    it("should return null for missing harness field", async () => {
      await mkdir(join(testDir, ".ralph"), { recursive: true });
      await writeFile(join(testDir, ".ralph", "config.yml"), "other: value\n");

      const config = await readRalphConfig(testDir);
      expect(config).toBeNull();
    });

    it("should return null for invalid harness value", async () => {
      await mkdir(join(testDir, ".ralph"), { recursive: true });
      await writeFile(
        join(testDir, ".ralph", "config.yml"),
        "harness: invalid-harness\n"
      );

      const config = await readRalphConfig(testDir);
      expect(config).toBeNull();
    });
  });

  describe("readWhimConfig", () => {
    it("should read valid whim config", async () => {
      await mkdir(join(testDir, ".whim"), { recursive: true });
      await writeFile(
        join(testDir, ".whim", "config.yml"),
        `type: web
verification:
  enabled: true
  browser: true
  unit: true
`
      );

      const config = await readWhimConfig(testDir);
      expect(config).toEqual({
        type: "web",
        verification: {
          enabled: true,
          browser: true,
          unit: true,
        },
      });
    });

    it("should accept all valid project types", async () => {
      await mkdir(join(testDir, ".whim"), { recursive: true });

      const types: Array<"web" | "api" | "cli" | "library" | "monorepo"> = [
        "web",
        "api",
        "cli",
        "library",
        "monorepo",
      ];
      for (const type of types) {
        await writeFile(
          join(testDir, ".whim", "config.yml"),
          `type: ${type}
verification:
  enabled: true
`
        );
        const config = await readWhimConfig(testDir);
        expect(config?.type).toBe(type);
      }
    });

    it("should read monorepo config with packages", async () => {
      await mkdir(join(testDir, ".whim"), { recursive: true });
      await writeFile(
        join(testDir, ".whim", "config.yml"),
        `type: monorepo
verification:
  enabled: true
packages:
  - path: apps/web
    type: web
    verification:
      enabled: true
      browser: true
      unit: true
  - path: apps/api
    type: api
    verification:
      enabled: true
      api: true
      unit: true
`
      );

      const config = await readWhimConfig(testDir);
      expect(config).toEqual({
        type: "monorepo",
        verification: {
          enabled: true,
        },
        packages: [
          {
            path: "apps/web",
            type: "web",
            verification: {
              enabled: true,
              browser: true,
              unit: true,
            },
          },
          {
            path: "apps/api",
            type: "api",
            verification: {
              enabled: true,
              api: true,
              unit: true,
            },
          },
        ],
      });
    });

    it("should return null if file doesn't exist", async () => {
      const config = await readWhimConfig(testDir);
      expect(config).toBeNull();
    });

    it("should return null for invalid YAML", async () => {
      await mkdir(join(testDir, ".whim"), { recursive: true });
      await writeFile(
        join(testDir, ".whim", "config.yml"),
        "invalid: yaml: content:\n  - broken"
      );

      const config = await readWhimConfig(testDir);
      expect(config).toBeNull();
    });

    it("should return null for missing type field", async () => {
      await mkdir(join(testDir, ".whim"), { recursive: true });
      await writeFile(
        join(testDir, ".whim", "config.yml"),
        `verification:
  enabled: true
`
      );

      const config = await readWhimConfig(testDir);
      expect(config).toBeNull();
    });

    it("should return null for invalid type value", async () => {
      await mkdir(join(testDir, ".whim"), { recursive: true });
      await writeFile(
        join(testDir, ".whim", "config.yml"),
        `type: invalid-type
verification:
  enabled: true
`
      );

      const config = await readWhimConfig(testDir);
      expect(config).toBeNull();
    });

    it("should return null for missing verification field", async () => {
      await mkdir(join(testDir, ".whim"), { recursive: true });
      await writeFile(join(testDir, ".whim", "config.yml"), `type: web\n`);

      const config = await readWhimConfig(testDir);
      expect(config).toBeNull();
    });

    it("should return null for non-boolean enabled field", async () => {
      await mkdir(join(testDir, ".whim"), { recursive: true });
      await writeFile(
        join(testDir, ".whim", "config.yml"),
        `type: web
verification:
  enabled: "yes"
`
      );

      const config = await readWhimConfig(testDir);
      expect(config).toBeNull();
    });

    it("should handle optional verification fields", async () => {
      await mkdir(join(testDir, ".whim"), { recursive: true });
      await writeFile(
        join(testDir, ".whim", "config.yml"),
        `type: api
verification:
  enabled: false
`
      );

      const config = await readWhimConfig(testDir);
      expect(config).toEqual({
        type: "api",
        verification: {
          enabled: false,
          browser: undefined,
          unit: undefined,
          api: undefined,
        },
      });
    });
  });

  describe("Default configs", () => {
    it("should return default ralph config", () => {
      const config = getDefaultRalphConfig();
      expect(config).toEqual({ harness: "claude-code" });
    });

    it("should return default whim config", () => {
      const config = getDefaultWhimConfig();
      expect(config).toEqual({
        type: "library",
        verification: {
          enabled: true,
          unit: true,
        },
      });
    });
  });
});
