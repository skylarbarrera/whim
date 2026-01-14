/**
 * GitHubAdapter Tests
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { GitHubAdapter, type GitHubIssue } from "./github.js";

// Mock Octokit
const mockListForRepo = mock(() =>
  Promise.resolve({
    data: [
      {
        id: 1,
        number: 42,
        title: "Test Issue",
        body: "Issue description",
        labels: [{ name: "whim" }],
        html_url: "https://github.com/owner/repo/issues/42",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
      {
        id: 2,
        number: 43,
        title: "PR as Issue",
        body: "This is a PR",
        labels: [{ name: "whim" }],
        pull_request: { url: "..." },
        html_url: "https://github.com/owner/repo/pull/43",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
      {
        id: 3,
        number: 44,
        title: "Already Processing",
        body: "Being processed",
        labels: [{ name: "whim" }, { name: "ai-processing" }],
        html_url: "https://github.com/owner/repo/issues/44",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
    ],
  })
);

const mockAddLabels = mock(() => Promise.resolve());
const mockRemoveLabel = mock(() => Promise.resolve());

// Mock the Octokit module
mock.module("@octokit/rest", () => ({
  Octokit: class MockOctokit {
    issues = {
      listForRepo: mockListForRepo,
      addLabels: mockAddLabels,
      removeLabel: mockRemoveLabel,
    };
  },
}));

describe("GitHubAdapter", () => {
  let adapter: GitHubAdapter;

  beforeEach(() => {
    mockListForRepo.mockClear();
    mockAddLabels.mockClear();
    mockRemoveLabel.mockClear();

    adapter = new GitHubAdapter({
      token: "test-token",
      repos: ["owner/repo"],
      intakeLabel: "whim",
    });
  });

  describe("poll", () => {
    it("should return issues with intake label", async () => {
      const issues = await adapter.poll();

      expect(issues).toHaveLength(1);
      expect(issues[0]!.number).toBe(42);
      expect(issues[0]!.title).toBe("Test Issue");
    });

    it("should filter out pull requests", async () => {
      const issues = await adapter.poll();

      // PR #43 should be filtered out
      const prIssue = issues.find((i) => i.number === 43);
      expect(prIssue).toBeUndefined();
    });

    it("should filter out already processing issues", async () => {
      const issues = await adapter.poll();

      // Issue #44 with ai-processing label should be filtered out
      const processingIssue = issues.find((i) => i.number === 44);
      expect(processingIssue).toBeUndefined();
    });

    it("should call Octokit with correct parameters", async () => {
      await adapter.poll();

      expect(mockListForRepo).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        labels: "whim",
        state: "open",
        sort: "created",
        direction: "asc",
      });
    });

    it("should handle multiple repos", async () => {
      const multiAdapter = new GitHubAdapter({
        token: "test-token",
        repos: ["owner/repo1", "owner/repo2"],
        intakeLabel: "whim",
      });

      await multiAdapter.poll();

      expect(mockListForRepo).toHaveBeenCalledTimes(2);
    });

    it("should handle invalid repo format gracefully", async () => {
      const invalidAdapter = new GitHubAdapter({
        token: "test-token",
        repos: ["invalid-format"],
        intakeLabel: "whim",
      });

      const issues = await invalidAdapter.poll();

      expect(issues).toHaveLength(0);
    });
  });

  describe("addLabel", () => {
    it("should add label to issue", async () => {
      await adapter.addLabel("owner", "repo", 42, "test-label");

      expect(mockAddLabels).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        issue_number: 42,
        labels: ["test-label"],
      });
    });
  });

  describe("removeLabel", () => {
    it("should remove label from issue", async () => {
      await adapter.removeLabel("owner", "repo", 42, "test-label");

      expect(mockRemoveLabel).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        issue_number: 42,
        name: "test-label",
      });
    });

    it("should ignore 404 errors (label not found)", async () => {
      const error = new Error("Not Found") as Error & { status: number };
      error.status = 404;
      mockRemoveLabel.mockImplementationOnce(() => Promise.reject(error));

      // Should not throw
      await adapter.removeLabel("owner", "repo", 42, "nonexistent-label");
    });
  });

  describe("markProcessing", () => {
    it("should add processing label", async () => {
      const issue: GitHubIssue = {
        id: 1,
        number: 42,
        title: "Test",
        body: "Body",
        labels: ["whim"],
        owner: "owner",
        repo: "repo",
        url: "https://github.com/owner/repo/issues/42",
        createdAt: "2024-01-01",
        updatedAt: "2024-01-01",
      };

      await adapter.markProcessing(issue);

      expect(mockAddLabels).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        issue_number: 42,
        labels: ["ai-processing"],
      });
    });
  });

  describe("markCompleted", () => {
    it("should remove intake/processing and add completed label", async () => {
      const issue: GitHubIssue = {
        id: 1,
        number: 42,
        title: "Test",
        body: "Body",
        labels: ["whim", "ai-processing"],
        owner: "owner",
        repo: "repo",
        url: "https://github.com/owner/repo/issues/42",
        createdAt: "2024-01-01",
        updatedAt: "2024-01-01",
      };

      await adapter.markCompleted(issue);

      // Should remove both labels
      expect(mockRemoveLabel).toHaveBeenCalledTimes(2);
      // Should add completed label
      expect(mockAddLabels).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        issue_number: 42,
        labels: ["ai-completed"],
      });
    });
  });

  describe("markFailed", () => {
    it("should remove processing label", async () => {
      const issue: GitHubIssue = {
        id: 1,
        number: 42,
        title: "Test",
        body: "Body",
        labels: ["whim", "ai-processing"],
        owner: "owner",
        repo: "repo",
        url: "https://github.com/owner/repo/issues/42",
        createdAt: "2024-01-01",
        updatedAt: "2024-01-01",
      };

      await adapter.markFailed(issue);

      expect(mockRemoveLabel).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        issue_number: 42,
        name: "ai-processing",
      });
    });
  });

  describe("getLabels", () => {
    it("should return configured labels", () => {
      const labels = adapter.getLabels();

      expect(labels).toEqual({
        intake: "whim",
        processing: "ai-processing",
        completed: "ai-completed",
      });
    });

    it("should use custom labels when provided", () => {
      const customAdapter = new GitHubAdapter({
        token: "test",
        repos: ["owner/repo"],
        intakeLabel: "custom-intake",
        processingLabel: "custom-processing",
        completedLabel: "custom-completed",
      });

      expect(customAdapter.getLabels()).toEqual({
        intake: "custom-intake",
        processing: "custom-processing",
        completed: "custom-completed",
      });
    });
  });
});
