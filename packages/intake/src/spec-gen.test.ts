/**
 * SpecGenerator Tests
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { SpecGenerator } from "./spec-gen.js";
import type { GitHubIssue } from "./github.js";

// Mock Anthropic client
const mockCreate = mock(() =>
  Promise.resolve({
    content: [
      {
        type: "text",
        text: `# Test Feature

## Goal
Implement test feature.

## Tasks
- [ ] Task 1
- [ ] Task 2

## Acceptance Criteria
- [ ] Criterion 1

## Notes
Test notes.`,
      },
    ],
  })
);

// Mock the Anthropic module
mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mockCreate,
    };
  },
}));

describe("SpecGenerator", () => {
  let generator: SpecGenerator;
  const testIssue: GitHubIssue = {
    id: 1,
    number: 42,
    title: "Add user authentication",
    body: "We need to add login and signup functionality.\n\n- OAuth support\n- Email/password",
    labels: ["ai-factory", "enhancement"],
    owner: "owner",
    repo: "repo",
    url: "https://github.com/owner/repo/issues/42",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
  };

  beforeEach(() => {
    mockCreate.mockClear();
    generator = new SpecGenerator({
      apiKey: "test-key",
    });
  });

  describe("generate", () => {
    it("should generate spec from issue", async () => {
      const result = await generator.generate(testIssue);

      expect(result.title).toBe("Add user authentication");
      expect(result.spec).toContain("# Test Feature");
      expect(result.spec).toContain("## Tasks");
    });

    it("should create correct branch name", async () => {
      const result = await generator.generate(testIssue);

      expect(result.branch).toBe("ai/issue-42-add-user-authentication");
    });

    it("should include metadata", async () => {
      const result = await generator.generate(testIssue);

      expect(result.metadata.issueNumber).toBe(42);
      expect(result.metadata.issueUrl).toBe(
        "https://github.com/owner/repo/issues/42"
      );
      expect(result.metadata.generatedAt).toBeDefined();
    });

    it("should call Anthropic with correct message", async () => {
      await generator.generate(testIssue);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const call = mockCreate.mock.calls[0] as unknown as [{ model: string; max_tokens: number; messages: Array<{ content: string }> }];
      expect(call[0].model).toBe("claude-sonnet-4-20250514");
      expect(call[0].max_tokens).toBe(4096);
      expect(call[0].messages[0]!.content).toContain("Issue #42");
      expect(call[0].messages[0]!.content).toContain("Add user authentication");
    });

    it("should handle issue with no body", async () => {
      const noBodyIssue: GitHubIssue = {
        ...testIssue,
        body: null,
      };

      const result = await generator.generate(noBodyIssue);

      expect(result).toBeDefined();
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const call = mockCreate.mock.calls[0] as unknown as [{ messages: Array<{ content: string }> }];
      expect(call[0].messages[0]!.content).toContain("_No description provided_");
    });

    it("should truncate long branch names", async () => {
      const longTitleIssue: GitHubIssue = {
        ...testIssue,
        title:
          "This is a very long issue title that should be truncated to prevent branch name issues",
      };

      const result = await generator.generate(longTitleIssue);

      // Branch should be truncated to 50 chars after "ai/issue-42-"
      expect(result.branch.length).toBeLessThanOrEqual(63); // "ai/issue-42-" = 12 + 50 = 62
    });

    it("should sanitize special characters in branch name", async () => {
      const specialCharsIssue: GitHubIssue = {
        ...testIssue,
        title: "Fix: bug with @mentions & special (chars)",
      };

      const result = await generator.generate(specialCharsIssue);

      // Should only contain alphanumeric and hyphens
      expect(result.branch).toMatch(/^ai\/issue-42-[a-z0-9-]+$/);
    });
  });

  describe("configuration", () => {
    it("should use custom model when provided", async () => {
      const customGenerator = new SpecGenerator({
        apiKey: "test-key",
        model: "claude-3-opus-20240229",
      });

      await customGenerator.generate(testIssue);

      const call = mockCreate.mock.calls[0] as unknown as [{ model: string }];
      expect(call[0].model).toBe("claude-3-opus-20240229");
    });

    it("should use custom maxTokens when provided", async () => {
      const customGenerator = new SpecGenerator({
        apiKey: "test-key",
        maxTokens: 8192,
      });

      await customGenerator.generate(testIssue);

      const call = mockCreate.mock.calls[0] as unknown as [{ max_tokens: number }];
      expect(call[0].max_tokens).toBe(8192);
    });
  });

  describe("error handling", () => {
    it("should propagate Anthropic errors", async () => {
      mockCreate.mockImplementationOnce(() =>
        Promise.reject(new Error("API Error"))
      );

      await expect(generator.generate(testIssue)).rejects.toThrow("API Error");
    });
  });
});
