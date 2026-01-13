import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import {
  loadConfig,
  getDetectionConfig,
  getLintConfig,
  getTestConfig,
  getMergeBlockingConfig,
  getBranchProtectionConfig,
  getGitHubConfig,
} from "../src/config.js";

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

  it("should load detection config", () => {
    const config = getDetectionConfig(tempDir);

    expect(config.minConfidence).toBe(0.7);
    expect(config.branchPatterns).toContain("ai/*");
    expect(config.checkCoAuthor).toBe(true);
  });

  it("should load custom detection config", () => {
    const configContent = `
detection:
  minConfidence: 0.9
  branchPatterns:
    - "bot/*"
    - "automated/*"
  labelPatterns:
    - "automated-pr"
  authorPatterns:
    - "bot-user"
  checkCoAuthor: false
`;

    fs.writeFileSync(path.join(tempDir, ".ai", "pr-review.yml"), configContent);

    const config = getDetectionConfig(tempDir);

    expect(config.minConfidence).toBe(0.9);
    expect(config.branchPatterns).toHaveLength(2);
    expect(config.branchPatterns).toContain("bot/*");
    expect(config.labelPatterns).toContain("automated-pr");
    expect(config.checkCoAuthor).toBe(false);
  });

  it("should load merge blocking config", () => {
    const config = getMergeBlockingConfig(tempDir);

    expect(config.enabled).toBe(true);
    expect(config.requiredChecks).toEqual([]);
    expect(config.requireOverrideReason).toBe(true);
  });

  it("should load custom merge blocking config", () => {
    const configContent = `
mergeBlocking:
  enabled: false
  requiredChecks:
    - "lint"
    - "test"
  overrideUsers:
    - "admin"
    - "lead-dev"
  requireOverrideReason: false
`;

    fs.writeFileSync(path.join(tempDir, ".ai", "pr-review.yml"), configContent);

    const config = getMergeBlockingConfig(tempDir);

    expect(config.enabled).toBe(false);
    expect(config.requiredChecks).toHaveLength(2);
    expect(config.requiredChecks).toContain("lint");
    expect(config.overrideUsers).toContain("admin");
    expect(config.requireOverrideReason).toBe(false);
  });

  it("should load branch protection config", () => {
    const config = getBranchProtectionConfig(tempDir);

    expect(config.enabled).toBe(false);
    expect(config.branches).toContain("main");
    expect(config.requirePullRequestReviews).toBe(true);
    expect(config.requiredApprovingReviews).toBe(1);
  });

  it("should load custom branch protection config", () => {
    const configContent = `
branchProtection:
  enabled: true
  branches:
    - "production"
    - "staging"
  requirePullRequestReviews: false
  requiredApprovingReviews: 2
  dismissStaleReviews: false
`;

    fs.writeFileSync(path.join(tempDir, ".ai", "pr-review.yml"), configContent);

    const config = getBranchProtectionConfig(tempDir);

    expect(config.enabled).toBe(true);
    expect(config.branches).toHaveLength(2);
    expect(config.branches).toContain("production");
    expect(config.requirePullRequestReviews).toBe(false);
    expect(config.requiredApprovingReviews).toBe(2);
    expect(config.dismissStaleReviews).toBe(false);
  });

  it("should load github config", () => {
    const config = getGitHubConfig(tempDir);

    expect(config.statusContext).toBe("ai-factory/pr-review");
    expect(config.syncBranchProtection).toBe(false);
  });

  it("should load custom github config", () => {
    const configContent = `
github:
  token: "ghp_test123"
  statusContext: "custom/pr-check"
  targetUrl: "https://factory.example.com"
  syncBranchProtection: true
`;

    fs.writeFileSync(path.join(tempDir, ".ai", "pr-review.yml"), configContent);

    const config = getGitHubConfig(tempDir);

    expect(config.token).toBe("ghp_test123");
    expect(config.statusContext).toBe("custom/pr-check");
    expect(config.targetUrl).toBe("https://factory.example.com");
    expect(config.syncBranchProtection).toBe(true);
  });

  it("should load complete custom config with all sections", () => {
    const configContent = `
detection:
  minConfidence: 0.85
lint:
  enabled: false
test:
  command: "bun test"
mergeBlocking:
  enabled: true
branchProtection:
  enabled: true
github:
  statusContext: "custom/check"
`;

    fs.writeFileSync(path.join(tempDir, ".ai", "pr-review.yml"), configContent);

    const config = loadConfig(tempDir);

    expect(config.detection?.minConfidence).toBe(0.85);
    expect(config.lint?.enabled).toBe(false);
    expect(config.test?.command).toBe("bun test");
    expect(config.mergeBlocking?.enabled).toBe(true);
    expect(config.branchProtection?.enabled).toBe(true);
    expect(config.github?.statusContext).toBe("custom/check");
  });
});
