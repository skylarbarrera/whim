import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  REVIEW_SYSTEM_PROMPT,
  REVIEW_USER_PROMPT,
  type ReviewFindings,
} from "./prompts/review-prompt.js";
import { getHarness, type HarnessName, type HarnessEvent } from "./harness/index.js";

export { type ReviewFindings } from "./prompts/review-prompt.js";

interface ReviewConfig {
  model?: string;
  enabled?: boolean;
}

/**
 * Generate git diff between current HEAD and origin/main
 */
export function generateDiff(repoDir: string): string {
  try {
    // Try origin/main first, fall back to origin/master
    const refs = ["origin/main", "origin/master", "origin/HEAD"];

    for (const ref of refs) {
      try {
        // Check if ref exists
        execSync(`git rev-parse --verify ${ref}`, {
          cwd: repoDir,
          stdio: "pipe",
        });

        // Generate diff
        const diff = execSync(`git diff ${ref}...HEAD`, {
          cwd: repoDir,
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024, // 10MB max diff
        });

        return diff;
      } catch {
        // Try next ref
        continue;
      }
    }

    throw new Error("Could not find a valid base ref (tried origin/main, origin/master, origin/HEAD)");
  } catch (error) {
    throw new Error(
      `Failed to generate diff: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Read spec from repository.
 * Ralphie v1.1+ stores specs in specs/active/<name>.md
 * Falls back to SPEC.md for backward compatibility.
 */
export function readSpec(repoDir: string): string {
  // Try specs/active/ first (Ralphie v1.1+ location)
  const specsActiveDir = join(repoDir, "specs", "active");
  if (existsSync(specsActiveDir)) {
    const files = readdirSync(specsActiveDir).filter(
      (f) => f.endsWith(".md") && !f.startsWith(".")
    );
    if (files.length === 1 && files[0]) {
      const specPath = join(specsActiveDir, files[0]);
      try {
        return readFileSync(specPath, "utf-8");
      } catch (error) {
        throw new Error(
          `Failed to read spec: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    if (files.length > 1 && files[0]) {
      // Multiple specs - use the first one but warn
      console.warn(`[REVIEW] Multiple specs found in specs/active/, using ${files[0]}`);
      const specPath = join(specsActiveDir, files[0]);
      return readFileSync(specPath, "utf-8");
    }
  }

  // Fall back to SPEC.md for backward compatibility
  const legacySpecPath = join(repoDir, "SPEC.md");
  if (!existsSync(legacySpecPath)) {
    throw new Error("SPEC.md not found in repository root or specs/active/");
  }

  try {
    return readFileSync(legacySpecPath, "utf-8");
  } catch (error) {
    throw new Error(
      `Failed to read SPEC.md: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Call Claude API to review code diff against spec
 */
export async function reviewCode(
  diff: string,
  spec: string,
  config: ReviewConfig = {}
): Promise<ReviewFindings> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required");
  }

  const model = config.model ?? process.env.AI_REVIEW_MODEL ?? "claude-sonnet-4-20250514";

  const client = new Anthropic({ apiKey });

  const startTime = Date.now();
  console.log(`[REVIEW] Calling Claude API with model: ${model}`);

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: REVIEW_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: REVIEW_USER_PROMPT(spec, diff),
        },
      ],
    });

    const duration = Date.now() - startTime;
    console.log(`[REVIEW] API call completed in ${duration}ms`);

    // Extract JSON from response
    const content = response.content[0];
    if (!content || content.type !== "text") {
      throw new Error("Expected text response from Claude API");
    }

    // Parse JSON from response (Claude might wrap it in markdown code blocks)
    let jsonText = content.text.trim();

    // Remove markdown code blocks if present
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.replace(/^```json\n/, "").replace(/\n```$/, "");
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```\n/, "").replace(/\n```$/, "");
    }

    const findings = JSON.parse(jsonText) as ReviewFindings;

    // Validate structure
    if (!findings.specAlignment || !findings.codeQuality || !findings.overallSummary) {
      throw new Error("Invalid review findings structure");
    }

    return findings;
  } catch (error) {
    throw new Error(
      `Failed to review code: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Main review function - generates diff, reads spec, calls Claude API
 */
export async function reviewPullRequest(
  repoDir: string,
  config: ReviewConfig = {}
): Promise<ReviewFindings | null> {
  // Check if review is enabled
  const enabled = config.enabled ?? process.env.AI_REVIEW_ENABLED !== "false";
  if (!enabled) {
    console.log("[REVIEW] AI review is disabled (AI_REVIEW_ENABLED=false)");
    return null;
  }

  console.log("[REVIEW] Starting pull request review...");

  try {
    // Generate diff
    console.log("[REVIEW] Generating diff...");
    const diff = generateDiff(repoDir);

    if (!diff || diff.trim().length === 0) {
      console.log("[REVIEW] No changes detected, skipping review");
      return null;
    }

    console.log(`[REVIEW] Diff size: ${diff.length} bytes`);

    // Check diff size limit (Claude context limit)
    const maxDiffSize = 500 * 1024; // 500KB
    if (diff.length > maxDiffSize) {
      console.warn(`[REVIEW] Diff too large (${diff.length} bytes), truncating to ${maxDiffSize} bytes`);
      const truncatedDiff = diff.slice(0, maxDiffSize) + "\n\n... (diff truncated due to size)";
      return await reviewCode(truncatedDiff, readSpec(repoDir), config);
    }

    // Read spec
    console.log("[REVIEW] Reading SPEC.md...");
    const spec = readSpec(repoDir);
    console.log(`[REVIEW] Spec size: ${spec.length} bytes`);

    // Call Claude API
    const findings = await reviewCode(diff, spec, config);

    console.log("[REVIEW] Review completed successfully");
    console.log(`[REVIEW]   Spec alignment: ${findings.specAlignment.score}`);
    console.log(`[REVIEW]   Code quality: ${findings.codeQuality.score}`);

    return findings;
  } catch (error) {
    console.error("[REVIEW] Review failed:", error instanceof Error ? error.message : String(error));
    // Don't throw - we don't want review failures to block PR creation
    return null;
  }
}

/**
 * Check if review findings have actionable issues to fix
 */
export function hasActionableIssues(findings: ReviewFindings): boolean {
  const hasGaps = findings.specAlignment.gaps.length > 0;
  const hasConcerns = findings.codeQuality.concerns.length > 0;
  return hasGaps || hasConcerns;
}

/**
 * Format review findings into a prompt for the fix agent
 */
function formatFixPrompt(findings: ReviewFindings): string {
  const lines: string[] = [
    "A code review found the following issues that need to be fixed:",
    "",
  ];

  // Add spec gaps
  if (findings.specAlignment.gaps.length > 0) {
    lines.push("## Missing Requirements (from SPEC.md)");
    for (const gap of findings.specAlignment.gaps) {
      lines.push(`- ${gap}`);
    }
    lines.push("");
  }

  // Add code quality concerns
  if (findings.codeQuality.concerns.length > 0) {
    lines.push("## Code Quality Issues");
    for (const concern of findings.codeQuality.concerns) {
      const location = concern.line
        ? `${concern.file}:${concern.line}`
        : concern.file;
      lines.push(`- **${location}**: ${concern.issue}`);
      lines.push(`  - Suggestion: ${concern.suggestion}`);
    }
    lines.push("");
  }

  lines.push("## Instructions");
  lines.push("1. Fix each issue listed above");
  lines.push("2. Run tests to verify fixes work");
  lines.push("3. Commit your changes with a descriptive message");
  lines.push("");
  lines.push("Focus on the specific issues - don't refactor unrelated code.");

  return lines.join("\n");
}

export interface ReviewFixResult {
  applied: boolean;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  error?: string;
}

/**
 * Run the fix agent to address review findings
 */
export async function runReviewFixes(
  repoDir: string,
  findings: ReviewFindings,
  harnessName: HarnessName = "claude"
): Promise<ReviewFixResult> {
  if (!hasActionableIssues(findings)) {
    console.log("[FIX] No actionable issues to fix");
    return { applied: false };
  }

  const harness = getHarness(harnessName);
  const prompt = formatFixPrompt(findings);

  console.log(`[FIX] Running fix agent with ${harness.name} harness...`);
  console.log(`[FIX] Issues to fix:`);
  console.log(`[FIX]   Spec gaps: ${findings.specAlignment.gaps.length}`);
  console.log(`[FIX]   Code concerns: ${findings.codeQuality.concerns.length}`);

  const onEvent = (event: HarnessEvent) => {
    switch (event.type) {
      case "tool_start":
        console.log(`[FIX:${harness.name}] Tool start: ${event.name}`);
        break;
      case "tool_end":
        console.log(`[FIX:${harness.name}] Tool end: ${event.name}${event.error ? " (error)" : ""}`);
        break;
      case "message":
        console.log(`[FIX:${harness.name}] ${event.text}`);
        break;
      case "error":
        console.error(`[FIX:${harness.name}] Error: ${event.message}`);
        break;
    }
  };

  try {
    const result = await harness.run(prompt, { cwd: repoDir }, onEvent);

    console.log(`[FIX] Harness completed: success=${result.success}, duration=${result.durationMs}ms`);

    if (!result.success) {
      console.error(`[FIX] Fix agent failed: ${result.error}`);
      return {
        applied: false,
        tokensIn: result.usage?.inputTokens,
        tokensOut: result.usage?.outputTokens,
        costUsd: result.costUsd,
        error: result.error,
      };
    }

    return {
      applied: true,
      tokensIn: result.usage?.inputTokens,
      tokensOut: result.usage?.outputTokens,
      costUsd: result.costUsd,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[FIX] Unexpected error: ${errorMessage}`);
    return { applied: false, error: errorMessage };
  }
}
