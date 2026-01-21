import type { ReviewFindings } from "@whim/shared";

export { type ReviewFindings } from "@whim/shared";

export const REVIEW_SYSTEM_PROMPT = `You are a code reviewer for AI-generated pull requests.
Your role is to analyze implementation diffs against specification documents and provide structured feedback.

Focus on:
1. Spec alignment - Are all requirements implemented? Any scope creep?
2. Code quality - Complexity, naming, patterns, potential bugs
3. Actionable feedback - Be specific with file:line references`;

export const REVIEW_USER_PROMPT = (spec: string, diff: string) => `## Specification (SPEC.md)
${spec}

## Git Diff
${diff}

## Instructions
Analyze the diff against the specification and provide feedback in the following JSON format:

{
  "specAlignment": {
    "score": "aligned" | "partial" | "misaligned",
    "summary": "Brief assessment of how well implementation matches spec",
    "gaps": ["Requirement X not implemented", ...],
    "extras": ["Feature Y not in spec", ...]
  },
  "codeQuality": {
    "score": "good" | "acceptable" | "needs-work",
    "summary": "Brief assessment of code quality",
    "concerns": [
      {
        "file": "path/to/file.ts",
        "line": 42,
        "issue": "Description of issue",
        "suggestion": "How to improve"
      }
    ]
  },
  "overallSummary": "High-level summary of the review"
}

Guidelines:
- Be specific and actionable
- Include file:line references where possible
- Empty arrays are fine if no gaps/extras/concerns
- Focus on meaningful issues, not nitpicks`;

export function formatReviewComment(
  findings: ReviewFindings,
  rerunUrl?: string
): string {
  const { specAlignment, codeQuality, overallSummary } = findings;

  let comment = `## Whim Code Review\n\n`;
  comment += `${overallSummary}\n\n`;

  // Spec Alignment
  const alignmentEmoji = {
    aligned: "✅",
    partial: "⚠️",
    misaligned: "❌",
  }[specAlignment.score];

  comment += `### ${alignmentEmoji} Spec Alignment: ${specAlignment.score}\n`;
  comment += `${specAlignment.summary}\n\n`;

  if (specAlignment.gaps.length > 0) {
    comment += `**Missing requirements:**\n`;
    specAlignment.gaps.forEach((gap) => {
      comment += `- ${gap}\n`;
    });
    comment += `\n`;
  }

  if (specAlignment.extras.length > 0) {
    comment += `**Unexpected additions:**\n`;
    specAlignment.extras.forEach((extra) => {
      comment += `- ${extra}\n`;
    });
    comment += `\n`;
  }

  if (specAlignment.gaps.length === 0 && specAlignment.extras.length === 0) {
    comment += `*No gaps or unexpected additions detected.*\n\n`;
  }

  // Code Quality
  const qualityEmoji = {
    good: "✅",
    acceptable: "👍",
    "needs-work": "⚠️",
  }[codeQuality.score];

  comment += `### ${qualityEmoji} Code Quality: ${codeQuality.score}\n`;
  comment += `${codeQuality.summary}\n\n`;

  if (codeQuality.concerns.length > 0) {
    comment += `**Concerns:**\n`;
    codeQuality.concerns.forEach((concern) => {
      const location = concern.line
        ? `\`${concern.file}:${concern.line}\``
        : `\`${concern.file}\``;
      comment += `- **${location}**: ${concern.issue}\n`;
      comment += `  - *Suggestion:* ${concern.suggestion}\n`;
    });
    comment += `\n`;
  } else {
    comment += `*No significant concerns.*\n\n`;
  }

  // Footer
  comment += `---\n`;
  comment += `*🏭 Reviewed by Whim*`;
  if (rerunUrl) {
    comment += ` • [Retrigger review](${rerunUrl})`;
  }

  return comment;
}
