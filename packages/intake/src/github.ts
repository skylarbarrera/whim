import { Octokit } from "@octokit/rest";

/**
 * Retry wrapper with exponential backoff for GitHub API calls
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Don't retry on 4xx client errors (except 429 rate limit)
      if ("status" in (error as object)) {
        const status = (error as { status: number }).status;
        if (status >= 400 && status < 500 && status !== 429) {
          throw lastError;
        }
      }
      if (attempt < retries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(`GitHub API retry ${attempt + 1}/${retries} after ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError ?? new Error("GitHub API call failed after retries");
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  repo: string;
  owner: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubAdapterConfig {
  token: string;
  repos: string[]; // Format: "owner/repo"
  intakeLabel: string;
  processingLabel?: string;
  completedLabel?: string;
}

export class GitHubAdapter {
  private octokit: Octokit;
  private config: Required<GitHubAdapterConfig>;

  constructor(config: GitHubAdapterConfig) {
    this.octokit = new Octokit({ auth: config.token });
    this.config = {
      ...config,
      processingLabel: config.processingLabel ?? "ai-processing",
      completedLabel: config.completedLabel ?? "ai-completed",
    };
  }

  /**
   * Poll all configured repos for issues with the intake label
   */
  async poll(): Promise<GitHubIssue[]> {
    const issues: GitHubIssue[] = [];

    for (const repoPath of this.config.repos) {
      const [owner, repo] = repoPath.split("/");
      if (!owner || !repo) {
        console.warn(`Invalid repo format: ${repoPath}, expected owner/repo`);
        continue;
      }

      try {
        const response = await withRetry(() =>
          this.octokit.issues.listForRepo({
            owner,
            repo,
            labels: this.config.intakeLabel,
            state: "open",
            sort: "created",
            direction: "asc",
          })
        );

        for (const issue of response.data) {
          // Skip pull requests (they also appear as issues)
          if (issue.pull_request) continue;

          // Skip if already being processed
          const labelNames = issue.labels
            .map((l) => (typeof l === "string" ? l : l.name))
            .filter((n): n is string => n !== undefined);

          if (labelNames.includes(this.config.processingLabel)) continue;

          issues.push({
            id: issue.id,
            number: issue.number,
            title: issue.title,
            body: issue.body ?? null,
            labels: labelNames,
            repo,
            owner,
            url: issue.html_url,
            createdAt: issue.created_at,
            updatedAt: issue.updated_at,
          });
        }
      } catch (error) {
        console.error(`Failed to poll ${repoPath}:`, error);
      }
    }

    return issues;
  }

  /**
   * Add a label to an issue
   */
  async addLabel(
    owner: string,
    repo: string,
    issueNumber: number,
    label: string
  ): Promise<void> {
    await withRetry(() =>
      this.octokit.issues.addLabels({
        owner,
        repo,
        issue_number: issueNumber,
        labels: [label],
      })
    );
  }

  /**
   * Remove a label from an issue
   */
  async removeLabel(
    owner: string,
    repo: string,
    issueNumber: number,
    label: string
  ): Promise<void> {
    try {
      await withRetry(() =>
        this.octokit.issues.removeLabel({
          owner,
          repo,
          issue_number: issueNumber,
          name: label,
        })
      );
    } catch (error: unknown) {
      // Ignore 404 - label might not exist
      if (
        error instanceof Error &&
        "status" in error &&
        (error as { status: number }).status === 404
      ) {
        return;
      }
      throw error;
    }
  }

  /**
   * Mark an issue as being processed
   */
  async markProcessing(issue: GitHubIssue): Promise<void> {
    await this.addLabel(
      issue.owner,
      issue.repo,
      issue.number,
      this.config.processingLabel
    );
  }

  /**
   * Mark an issue as completed (remove intake/processing, add completed)
   */
  async markCompleted(issue: GitHubIssue): Promise<void> {
    await Promise.all([
      this.removeLabel(
        issue.owner,
        issue.repo,
        issue.number,
        this.config.intakeLabel
      ),
      this.removeLabel(
        issue.owner,
        issue.repo,
        issue.number,
        this.config.processingLabel
      ),
    ]);
    await this.addLabel(
      issue.owner,
      issue.repo,
      issue.number,
      this.config.completedLabel
    );
  }

  /**
   * Mark an issue as failed (remove processing, keep intake for retry)
   */
  async markFailed(issue: GitHubIssue): Promise<void> {
    await this.removeLabel(
      issue.owner,
      issue.repo,
      issue.number,
      this.config.processingLabel
    );
  }

  /**
   * Post a comment on an issue
   */
  async postComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string
  ): Promise<void> {
    await withRetry(() =>
      this.octokit.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body,
      })
    );
  }

  /**
   * Get the configured labels
   */
  getLabels() {
    return {
      intake: this.config.intakeLabel,
      processing: this.config.processingLabel,
      completed: this.config.completedLabel,
    };
  }
}
