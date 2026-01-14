import { spawn, type ChildProcess } from "node:child_process";
import type { GitHubIssue } from "./github.js";

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

export interface RalphSpecGeneratorConfig {
  timeoutMs?: number;
  workDir?: string;
}

/**
 * Events emitted by ralph spec --headless
 */
type RalphSpecEvent =
  | { event: "spec_generation_started"; description: string; timestamp: string }
  | {
      event: "spec_generation_complete";
      specPath: string;
      taskCount: number;
      validationPassed: boolean;
      violations: number;
      timestamp: string;
    }
  | { event: "spec_generation_failed"; error: string; timestamp: string };

export interface RalphSpecResult {
  success: boolean;
  spec?: string;
  taskCount?: number;
  validationPassed?: boolean;
  error?: string;
}

/**
 * Wrapper for Ralph's autonomous spec generation (ralph spec --headless)
 *
 * This uses Ralph's built-in spec generation capabilities including:
 * - LLM-powered spec creation from descriptions
 * - Automatic validation against spec conventions
 * - Structured JSON event output
 */
export class RalphSpecGenerator {
  private timeoutMs: number;
  private workDir: string;

  constructor(config: RalphSpecGeneratorConfig = {}) {
    this.timeoutMs = config.timeoutMs ?? 300000; // 5 minutes default
    this.workDir = config.workDir ?? "/tmp";
  }

  /**
   * Generate a spec from a GitHub issue using Ralph
   */
  async generate(issue: GitHubIssue): Promise<GeneratedSpec> {
    const description = this.formatIssueDescription(issue);
    const result = await this.runRalphSpec(description);

    if (!result.success || !result.spec) {
      throw new Error(result.error ?? "Ralph spec generation failed");
    }

    const branch = this.generateBranchName(issue);

    return {
      title: issue.title,
      spec: result.spec,
      branch,
      metadata: {
        issueNumber: issue.number,
        issueUrl: issue.url,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Format GitHub issue into a description for Ralph
   */
  private formatIssueDescription(issue: GitHubIssue): string {
    const parts = [
      `GitHub Issue #${issue.number}: ${issue.title}`,
      "",
      `Repository: ${issue.owner}/${issue.repo}`,
      `Labels: ${issue.labels.join(", ") || "none"}`,
      "",
    ];

    if (issue.body && issue.body.trim()) {
      parts.push("Description:", issue.body.trim());
    }

    return parts.join("\n");
  }

  /**
   * Run ralph spec --headless and parse JSON events
   */
  private async runRalphSpec(description: string): Promise<RalphSpecResult> {
    return new Promise((resolve) => {
      const args = [
        "spec",
        "--headless",
        "--timeout",
        String(Math.floor(this.timeoutMs / 1000)),
        "--cwd",
        this.workDir,
        description,
      ];

      console.log(`[RalphSpecGen] Running: ralph ${args.join(" ")}`);

      const proc: ChildProcess = spawn("ralph", args, {
        cwd: this.workDir,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      const events: RalphSpecEvent[] = [];

      // Set overall timeout
      const timeout = setTimeout(() => {
        proc.kill("SIGTERM");
        resolve({
          success: false,
          error: `Timeout after ${this.timeoutMs / 1000}s`,
        });
      }, this.timeoutMs);

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();

        // Parse JSON events line by line
        const lines = data.toString().split("\n");
        for (const line of lines) {
          if (line.trim()) {
            try {
              const event = JSON.parse(line) as RalphSpecEvent;
              events.push(event);
              console.log(`[RalphSpecGen] Event: ${event.event}`);
            } catch {
              // Not JSON, ignore
            }
          }
        }
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        clearTimeout(timeout);

        console.log(`[RalphSpecGen] Process exited with code ${code}`);

        // Check for successful completion event
        const completeEvent = events.find(
          (e): e is Extract<RalphSpecEvent, { event: "spec_generation_complete" }> =>
            e.event === "spec_generation_complete"
        );

        if (completeEvent) {
          // Read the generated SPEC.md file
          const specPath = `${this.workDir}/SPEC.md`;
          try {
            const fs = require("fs");
            const spec = fs.readFileSync(specPath, "utf-8");

            resolve({
              success: true,
              spec,
              taskCount: completeEvent.taskCount,
              validationPassed: completeEvent.validationPassed,
            });
            return;
          } catch (err) {
            resolve({
              success: false,
              error: `Failed to read generated spec: ${err}`,
            });
            return;
          }
        }

        // Check for failure event
        const failEvent = events.find(
          (e): e is Extract<RalphSpecEvent, { event: "spec_generation_failed" }> =>
            e.event === "spec_generation_failed"
        );

        if (failEvent) {
          resolve({
            success: false,
            error: failEvent.error,
          });
          return;
        }

        // No events found, check exit code
        if (code === 0) {
          resolve({
            success: false,
            error: "Ralph exited successfully but no completion event received",
          });
        } else {
          resolve({
            success: false,
            error: `Ralph exited with code ${code}: ${stderr || "no error output"}`,
          });
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        resolve({
          success: false,
          error: `Failed to spawn ralph: ${err.message}`,
        });
      });
    });
  }

  /**
   * Generate a branch name from issue metadata
   */
  private generateBranchName(issue: GitHubIssue): string {
    const prefix = `ai/issue-${issue.number}-`;
    const maxSlugLen = 60 - prefix.length;
    const slug = issue.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, maxSlugLen);

    return `${prefix}${slug}`;
  }
}
