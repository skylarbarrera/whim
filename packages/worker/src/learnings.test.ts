import { describe, it, expect } from "bun:test";
import {
  parseLearningsFromMarkdown,
  getLearningsPath,
  getNewLearningsPath,
} from "./learnings.js";

describe("parseLearningsFromMarkdown", () => {
  it("should parse learnings sections", () => {
    const content = `# New Learnings

## Learning 1

This is the first learning content.
It spans multiple lines.

## Learning 2

This is another learning.
`;

    const learnings = parseLearningsFromMarkdown(content, "test spec");

    expect(learnings).toHaveLength(2);
    expect(learnings[0]!.content).toContain("first learning content");
    expect(learnings[1]!.content).toContain("another learning");
    expect(learnings[0]!.spec).toBe("test spec");
  });

  it("should parse insights sections", () => {
    const content = `## Insight: Important discovery

Found that the system works better with caching.
`;

    const learnings = parseLearningsFromMarkdown(content, "spec");

    expect(learnings).toHaveLength(1);
    expect(learnings[0]!.content).toContain("caching");
  });

  it("should parse notes sections", () => {
    const content = `## Note

Remember to check error handling.
`;

    const learnings = parseLearningsFromMarkdown(content, "spec");

    expect(learnings).toHaveLength(1);
    expect(learnings[0]!.content).toContain("error handling");
  });

  it("should fall back to full content if no sections match", () => {
    const content = `Some general content without headers.
This should be captured as a single learning.
`;

    const learnings = parseLearningsFromMarkdown(content, "spec");

    expect(learnings).toHaveLength(1);
    expect(learnings[0]!.content).toContain("general content");
  });

  it("should return empty array for empty content", () => {
    const learnings = parseLearningsFromMarkdown("", "spec");
    expect(learnings).toHaveLength(0);
  });

  it("should return empty array for whitespace-only content", () => {
    const learnings = parseLearningsFromMarkdown("   \n\n   ", "spec");
    expect(learnings).toHaveLength(0);
  });

  it("should strip headers and separators from fallback", () => {
    const content = `# Title
---
Some content here
---
`;

    const learnings = parseLearningsFromMarkdown(content, "spec");

    expect(learnings).toHaveLength(1);
    expect(learnings[0]!.content).toBe("Some content here");
    expect(learnings[0]!.content).not.toContain("#");
    expect(learnings[0]!.content).not.toContain("---");
  });
});

describe("path helpers", () => {
  it("getLearningsPath should return .ai/learnings.md path", () => {
    const path = getLearningsPath("/workspace/repo");
    expect(path).toBe("/workspace/repo/.ai/learnings.md");
  });

  it("getNewLearningsPath should return .ai/new-learnings.md path", () => {
    const path = getNewLearningsPath("/workspace/repo");
    expect(path).toBe("/workspace/repo/.ai/new-learnings.md");
  });
});
