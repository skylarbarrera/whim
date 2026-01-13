import { describe, it, expect } from "bun:test";
import { validateConfig } from "./config-validator.js";

describe("validateConfig", () => {
  describe("root validation", () => {
    it("should reject non-object config", () => {
      const result = validateConfig(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe("root");
    });

    it("should accept empty object", () => {
      const result = validateConfig({});
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("detection validation", () => {
    it("should reject non-object detection", () => {
      const result = validateConfig({ detection: "invalid" });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "detection")).toBe(true);
    });

    it("should reject invalid minConfidence", () => {
      const result = validateConfig({
        detection: { minConfidence: 1.5 },
      });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === "detection.minConfidence")
      ).toBe(true);
    });

    it("should accept valid minConfidence", () => {
      const result = validateConfig({
        detection: { minConfidence: 0.8 },
      });
      expect(result.valid).toBe(true);
    });

    it("should reject non-array branchPatterns", () => {
      const result = validateConfig({
        detection: { branchPatterns: "ai/*" },
      });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === "detection.branchPatterns")
      ).toBe(true);
    });

    it("should reject non-string in branchPatterns", () => {
      const result = validateConfig({
        detection: { branchPatterns: ["ai/*", 123] },
      });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === "detection.branchPatterns[1]")
      ).toBe(true);
    });

    it("should accept valid branchPatterns", () => {
      const result = validateConfig({
        detection: { branchPatterns: ["ai/*", "bot/*"] },
      });
      expect(result.valid).toBe(true);
    });

    it("should reject non-boolean checkCoAuthor", () => {
      const result = validateConfig({
        detection: { checkCoAuthor: "yes" },
      });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === "detection.checkCoAuthor")
      ).toBe(true);
    });
  });

  describe("lint validation", () => {
    it("should reject non-object lint", () => {
      const result = validateConfig({ lint: "invalid" });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "lint")).toBe(true);
    });

    it("should reject non-boolean enabled", () => {
      const result = validateConfig({
        lint: { enabled: "yes" },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "lint.enabled")).toBe(true);
    });

    it("should reject invalid timeout", () => {
      const result = validateConfig({
        lint: { timeout: 500 },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "lint.timeout")).toBe(true);
    });

    it("should reject negative failureThreshold", () => {
      const result = validateConfig({
        lint: { failureThreshold: -1 },
      });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === "lint.failureThreshold")
      ).toBe(true);
    });

    it("should reject non-array tools", () => {
      const result = validateConfig({
        lint: { tools: "eslint" },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "lint.tools")).toBe(true);
    });

    it("should reject tool without name", () => {
      const result = validateConfig({
        lint: {
          tools: [{ command: "npx eslint", enabled: true }],
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "lint.tools[0].name")).toBe(
        true
      );
    });

    it("should reject tool without command", () => {
      const result = validateConfig({
        lint: {
          tools: [{ name: "eslint", enabled: true }],
        },
      });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === "lint.tools[0].command")
      ).toBe(true);
    });

    it("should accept valid lint config", () => {
      const result = validateConfig({
        lint: {
          enabled: true,
          required: true,
          timeout: 60000,
          failureThreshold: 0,
          tools: [
            {
              name: "eslint",
              command: "npx eslint .",
              enabled: true,
            },
          ],
        },
      });
      expect(result.valid).toBe(true);
    });

    it("should accept tool with include/exclude arrays", () => {
      const result = validateConfig({
        lint: {
          tools: [
            {
              name: "eslint",
              command: "npx eslint .",
              enabled: true,
              include: ["src/**/*.ts"],
              exclude: ["**/*.test.ts"],
            },
          ],
        },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("test validation", () => {
    it("should reject non-object test", () => {
      const result = validateConfig({ test: "invalid" });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "test")).toBe(true);
    });

    it("should reject invalid minPassPercentage", () => {
      const result = validateConfig({
        test: { minPassPercentage: 150 },
      });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === "test.minPassPercentage")
      ).toBe(true);
    });

    it("should reject invalid minCoverage", () => {
      const result = validateConfig({
        test: { minCoverage: -10 },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "test.minCoverage")).toBe(
        true
      );
    });

    it("should accept valid test config", () => {
      const result = validateConfig({
        test: {
          enabled: true,
          required: true,
          timeout: 300000,
          command: "npm test",
          minPassPercentage: 100,
          minCoverage: 80,
        },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("mergeBlocking validation", () => {
    it("should reject non-object mergeBlocking", () => {
      const result = validateConfig({ mergeBlocking: "invalid" });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "mergeBlocking")).toBe(
        true
      );
    });

    it("should reject non-array requiredChecks", () => {
      const result = validateConfig({
        mergeBlocking: { requiredChecks: "lint" },
      });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === "mergeBlocking.requiredChecks")
      ).toBe(true);
    });

    it("should reject non-string in requiredChecks", () => {
      const result = validateConfig({
        mergeBlocking: { requiredChecks: ["lint", 123] },
      });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === "mergeBlocking.requiredChecks[1]")
      ).toBe(true);
    });

    it("should accept valid mergeBlocking config", () => {
      const result = validateConfig({
        mergeBlocking: {
          enabled: true,
          requiredChecks: ["lint", "test"],
          overrideUsers: ["admin"],
          requireOverrideReason: true,
        },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("branchProtection validation", () => {
    it("should reject non-object branchProtection", () => {
      const result = validateConfig({ branchProtection: "invalid" });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "branchProtection")).toBe(
        true
      );
    });

    it("should reject non-array branches", () => {
      const result = validateConfig({
        branchProtection: { branches: "main" },
      });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === "branchProtection.branches")
      ).toBe(true);
    });

    it("should reject invalid requiredApprovingReviews", () => {
      const result = validateConfig({
        branchProtection: { requiredApprovingReviews: 10 },
      });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.field === "branchProtection.requiredApprovingReviews"
        )
      ).toBe(true);
    });

    it("should accept valid branchProtection config", () => {
      const result = validateConfig({
        branchProtection: {
          enabled: true,
          branches: ["main", "develop"],
          requirePullRequestReviews: true,
          requiredApprovingReviews: 2,
          dismissStaleReviews: true,
        },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("github validation", () => {
    it("should reject non-object github", () => {
      const result = validateConfig({ github: "invalid" });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "github")).toBe(true);
    });

    it("should reject non-string token", () => {
      const result = validateConfig({
        github: { token: 12345 },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "github.token")).toBe(true);
    });

    it("should reject non-string statusContext", () => {
      const result = validateConfig({
        github: { statusContext: true },
      });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === "github.statusContext")
      ).toBe(true);
    });

    it("should accept valid github config", () => {
      const result = validateConfig({
        github: {
          token: "ghp_xxx",
          statusContext: "my-factory/pr-review",
          targetUrl: "https://factory.example.com",
          syncBranchProtection: true,
        },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("complete config validation", () => {
    it("should validate complete valid config", () => {
      const result = validateConfig({
        detection: {
          minConfidence: 0.8,
          branchPatterns: ["ai/*"],
          labelPatterns: ["automated"],
          authorPatterns: ["bot"],
          checkCoAuthor: true,
        },
        lint: {
          enabled: true,
          required: true,
          timeout: 60000,
          failureThreshold: 0,
          tools: [
            {
              name: "eslint",
              command: "npx eslint .",
              enabled: true,
            },
          ],
        },
        test: {
          enabled: true,
          required: true,
          timeout: 300000,
          command: "npm test",
          minPassPercentage: 100,
        },
        mergeBlocking: {
          enabled: true,
          requiredChecks: [],
          overrideUsers: ["admin"],
          requireOverrideReason: true,
        },
        branchProtection: {
          enabled: false,
          branches: ["main"],
          requirePullRequestReviews: true,
          requiredApprovingReviews: 1,
          dismissStaleReviews: true,
        },
        github: {
          statusContext: "ai-factory/pr-review",
          syncBranchProtection: false,
        },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should collect multiple errors", () => {
      const result = validateConfig({
        detection: {
          minConfidence: 2.0, // Invalid
        },
        lint: {
          timeout: 100, // Invalid
        },
        test: {
          minPassPercentage: 150, // Invalid
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });
});
