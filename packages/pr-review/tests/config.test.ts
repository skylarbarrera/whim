import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { loadConfig, getLintConfig, getTestConfig } from "../src/config.js";

describe("Config Loader", () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-review-test-"));
    fs.mkdirSync(path.join(tempDir, ".ai"), { recursive: true });
  });

  afterEach(() => {
    // Clean up temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should return default config when no config file exists", () => {
    const config = loadConfig(tempDir);

    expect(config.lint).toBeDefined();
    expect(config.lint?.enabled).toBe(true);
    expect(config.lint?.required).toBe(true);
    expect(config.lint?.timeout).toBe(60000);
    expect(config.lint?.tools).toHaveLength(2);
  });

  it("should load config from .ai/pr-review.yml", () => {
    const configContent = `
lint:
  enabled: false
  required: false
  timeout: 30000
  tools:
    - name: eslint
      command: "npx eslint . --format json"
      enabled: true
  failureThreshold: 5
`;

    fs.writeFileSync(path.join(tempDir, ".ai", "pr-review.yml"), configContent);

    const config = loadConfig(tempDir);

    expect(config.lint?.enabled).toBe(false);
    expect(config.lint?.required).toBe(false);
    expect(config.lint?.timeout).toBe(30000);
    expect(config.lint?.tools).toHaveLength(1);
    expect(config.lint?.failureThreshold).toBe(5);
  });

  it("should merge user config with defaults", () => {
    const configContent = `
lint:
  enabled: false
`;

    fs.writeFileSync(path.join(tempDir, ".ai", "pr-review.yml"), configContent);

    const config = loadConfig(tempDir);

    // User override
    expect(config.lint?.enabled).toBe(false);

    // Default values
    expect(config.lint?.required).toBe(true);
    expect(config.lint?.timeout).toBe(60000);
    expect(config.lint?.tools).toHaveLength(2);
  });

  it("should handle malformed YAML gracefully", () => {
    const configContent = "invalid: yaml: content: [";

    fs.writeFileSync(path.join(tempDir, ".ai", "pr-review.yml"), configContent);

    const config = loadConfig(tempDir);

    // Should fall back to defaults
    expect(config.lint).toBeDefined();
    expect(config.lint?.enabled).toBe(true);
  });

  it("should load test config", () => {
    const config = getTestConfig(tempDir);

    expect(config.enabled).toBe(true);
    expect(config.required).toBe(true);
    expect(config.timeout).toBe(300000);
    expect(config.command).toBe("npm test");
    expect(config.minPassPercentage).toBe(100);
  });

  it("should load lint config with custom tools", () => {
    const configContent = `
lint:
  tools:
    - name: custom-linter
      command: "custom lint --strict"
      enabled: true
`;

    fs.writeFileSync(path.join(tempDir, ".ai", "pr-review.yml"), configContent);

    const config = getLintConfig(tempDir);

    expect(config.tools).toHaveLength(1);
    expect(config.tools[0].name).toBe("custom-linter");
    expect(config.tools[0].command).toBe("custom lint --strict");
  });

  it("should load custom test config", () => {
    const configContent = `
test:
  enabled: false
  timeout: 600000
  command: "bun test"
  minPassPercentage: 90
`;

    fs.writeFileSync(path.join(tempDir, ".ai", "pr-review.yml"), configContent);

    const config = getTestConfig(tempDir);

    expect(config.enabled).toBe(false);
    expect(config.timeout).toBe(600000);
    expect(config.command).toBe("bun test");
    expect(config.minPassPercentage).toBe(90);
  });

  it("should merge custom test config with defaults", () => {
    const configContent = `
test:
  command: "npx vitest run"
`;

    fs.writeFileSync(path.join(tempDir, ".ai", "pr-review.yml"), configContent);

    const config = getTestConfig(tempDir);

    // User override
    expect(config.command).toBe("npx vitest run");

    // Default values
    expect(config.enabled).toBe(true);
    expect(config.required).toBe(true);
    expect(config.timeout).toBe(300000);
    expect(config.minPassPercentage).toBe(100);
  });

  it("should load both lint and test config simultaneously", () => {
    const configContent = `
lint:
  enabled: false
test:
  enabled: false
`;

    fs.writeFileSync(path.join(tempDir, ".ai", "pr-review.yml"), configContent);

    const config = loadConfig(tempDir);

    expect(config.lint?.enabled).toBe(false);
    expect(config.test?.enabled).toBe(false);
  });
});
