import Anthropic from "@anthropic-ai/sdk";
import type { GitHubIssue } from "./github.js";

export interface SpecGeneratorConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export interface GeneratedSpec {
  title: string;
  spec: string;
  branch: string;
  metadata: {
    issueNumber: number;
    issueUrl: string;
    generatedAt: string;
  };
}

const SPEC_GENERATION_PROMPT = `You are a senior software engineer tasked with converting a GitHub issue into a detailed implementation specification.

Given the issue title and body, create a SPEC.md that:
1. Clearly states the goal
2. Lists all implementation tasks as checkboxes
3. Defines acceptance criteria
4. Notes any edge cases or considerations

Format your response as a markdown document with the following structure:

# <Title>

## Goal
<1-2 sentence summary>

## Tasks
- [ ] Task 1
  - Sub-task details
- [ ] Task 2
- [ ] Task 3

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Notes
<Any additional context, edge cases, or considerations>

Be specific and actionable. Each checkbox should represent a concrete piece of work.`;

export class SpecGenerator {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(config: SpecGeneratorConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model ?? "claude-sonnet-4-20250514";
    this.maxTokens = config.maxTokens ?? 4096;
  }

  /**
   * Generate a spec from a GitHub issue
   */
  async generate(issue: GitHubIssue): Promise<GeneratedSpec> {
    const issueContent = this.formatIssueContent(issue);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [
        {
          role: "user",
          content: `${SPEC_GENERATION_PROMPT}\n\n---\n\n${issueContent}`,
        },
      ],
    });

    const spec = this.extractTextContent(response.content);
    const branch = this.generateBranchName(issue);

    return {
      title: issue.title,
      spec,
      branch,
      metadata: {
        issueNumber: issue.number,
        issueUrl: issue.url,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  private formatIssueContent(issue: GitHubIssue): string {
    const parts = [
      `## Issue #${issue.number}: ${issue.title}`,
      "",
      `**Repository:** ${issue.owner}/${issue.repo}`,
      `**Created:** ${issue.createdAt}`,
      `**Labels:** ${issue.labels.join(", ") || "none"}`,
      "",
      "## Description",
      "",
      issue.body || "_No description provided_",
    ];

    return parts.join("\n");
  }

  private extractTextContent(
    content: Anthropic.Messages.ContentBlock[]
  ): string {
    return content
      .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  }

  private generateBranchName(issue: GitHubIssue): string {
    // Create a slug from the issue title
    const slug = issue.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);

    return `ai/issue-${issue.number}-${slug}`;
  }
}
