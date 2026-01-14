import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  REVIEW_SYSTEM_PROMPT,
  REVIEW_USER_PROMPT,
  type ReviewFindings,
} from "./prompts/review-prompt.js";

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
 * Read SPEC.md from repository root
 */
export function readSpec(repoDir: string): string {
  const specPath = join(repoDir, "SPEC.md");

  if (!existsSync(specPath)) {
    throw new Error("SPEC.md not found in repository root");
  }

  try {
    return readFileSync(specPath, "utf-8");
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
    if (content.type !== "text") {
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
