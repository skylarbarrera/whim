import { describe, it, expect, mock, beforeEach } from "bun:test";
import { RalphSpecGenerator } from "./ralph-spec-gen.js";
import type { GitHubIssue } from "./github.js";

describe("RalphSpecGenerator", () => {
  const mockIssue: GitHubIssue = {
    id: 456789,
    number: 123,
    title: "Add user authentication",
    body: "We need to add JWT-based authentication to the API",
    owner: "testorg",
    repo: "testrepo",
    url: "https://github.com/testorg/testrepo/issues/123",
    labels: ["enhancement", "security"],
    createdAt: "2024-01-15T10:00:00Z",
    updatedAt: "2024-01-15T10:00:00Z",
  };

  describe("formatIssueDescription", () => {
    it("should format issue with body", () => {
      const gen = new RalphSpecGenerator();
      // Access private method via any for testing
      const description = (gen as any).formatIssueDescription(mockIssue);

      expect(description).toContain("GitHub Issue #123");
      expect(description).toContain("Add user authentication");
      expect(description).toContain("testorg/testrepo");
      expect(description).toContain("JWT-based authentication");
    });

    it("should handle issue without body", () => {
      const gen = new RalphSpecGenerator();
      const issueWithoutBody = { ...mockIssue, body: "" };
      const description = (gen as any).formatIssueDescription(issueWithoutBody);

      expect(description).toContain("GitHub Issue #123");
      expect(description).not.toContain("Description:");
    });

    it("should include labels", () => {
      const gen = new RalphSpecGenerator();
      const description = (gen as any).formatIssueDescription(mockIssue);

      expect(description).toContain("enhancement, security");
    });
  });

  describe("generateBranchName", () => {
    it("should generate valid branch name", () => {
      const gen = new RalphSpecGenerator();
      const branch = (gen as any).generateBranchName(mockIssue);

      expect(branch).toBe("ai/issue-123-add-user-authentication");
    });

    it("should handle special characters", () => {
      const gen = new RalphSpecGenerator();
      const issueWithSpecialChars = {
        ...mockIssue,
        title: "Fix: Bug with @mentions & #hashtags!",
      };
      const branch = (gen as any).generateBranchName(issueWithSpecialChars);

      expect(branch).toBe("ai/issue-123-fix-bug-with-mentions-hashtags");
    });

    it("should truncate long titles", () => {
      const gen = new RalphSpecGenerator();
      const longTitle = "a".repeat(100);
      const issueWithLongTitle = { ...mockIssue, title: longTitle };
      const branch = (gen as any).generateBranchName(issueWithLongTitle);

      expect(branch.length).toBeLessThanOrEqual(60); // ai/issue-123- + 50 chars
    });
  });

  describe("constructor", () => {
    it("should use default config", () => {
      const gen = new RalphSpecGenerator();
      expect(gen).toBeDefined();
      expect((gen as any).timeoutMs).toBe(300000);
      expect((gen as any).workDir).toBe("/tmp");
    });

    it("should accept custom config", () => {
      const gen = new RalphSpecGenerator({
        timeoutMs: 60000,
        workDir: "/custom/path",
      });
      expect((gen as any).timeoutMs).toBe(60000);
      expect((gen as any).workDir).toBe("/custom/path");
    });
  });
});
