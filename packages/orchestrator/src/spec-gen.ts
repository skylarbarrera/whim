import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";

export interface GenerateMetadata {
  source?: string; // 'github', 'linear', 'api', etc.
  sourceRef?: string; // 'issue:42', 'LIN-123', etc.
  title?: string; // For spec title
}

export interface GeneratedSpec {
  title: string;
  spec: string;
  branch: string;
  metadata: {
    source?: string;
    sourceRef?: string;
    generatedAt: string;
  };
}

export interface RalphSpecGeneratorConfig {
  timeoutMs?: number;
  workDir?: string;
}

/**
 * Events emitted by ralphie spec --headless
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
 * Wrapper for Ralphie's autonomous spec generation (ralphie spec --headless)
 *
 * This uses Ralphie's built-in spec generation capabilities including:
 * - LLM-powered spec creation from descriptions
 * - Automatic validation against spec conventions
 * - Structured JSON event output
 *
 * Generalized for use with any source (GitHub, Linear, API, etc.)
 */
export class RalphSpecGenerator {
  private timeoutMs: number;
  private workDir: string;

  constructor(config: RalphSpecGeneratorConfig = {}) {
    this.timeoutMs = config.timeoutMs ?? 300000; // 5 minutes default
    this.workDir = config.workDir ?? "/tmp/spec";
  }

  /**
   * Generate a spec from a description using Ralph
   *
   * @param description - The work description (can be from any source)
   * @param metadata - Optional metadata for branch naming and tracking
   */
  async generate(description: string, metadata?: GenerateMetadata): Promise<GeneratedSpec> {
    const result = await this.runRalphSpec(description);

    if (!result.success || !result.spec) {
      throw new Error(result.error ?? "Ralph spec generation failed");
    }

    const branch = this.generateBranchName(metadata);
    const title = metadata?.title ?? this.extractTitleFromSpec(result.spec);

    return {
      title,
      spec: result.spec,
      branch,
      metadata: {
        source: metadata?.source,
        sourceRef: metadata?.sourceRef,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Run ralphie spec --headless and parse JSON events
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

      console.log(`[RalphSpecGen] Running: ralphie ${args.join(" ")}`);

      const proc: ChildProcess = spawn("ralphie", args, {
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
            const spec = readFileSync(specPath, "utf-8");

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
            error: "Ralphie exited successfully but no completion event received",
          });
        } else {
          resolve({
            success: false,
            error: `Ralphie exited with code ${code}: ${stderr || "no error output"}`,
          });
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        resolve({
          success: false,
          error: `Failed to spawn ralphie: ${err.message}`,
        });
      });
    });
  }

  /**
   * Generate a branch name from metadata
   *
   * With source: ai/<source>-<sanitized-sourceRef>-<slug>
   * Without source: ai/<timestamp>-<slug>
   */
  private generateBranchName(metadata?: GenerateMetadata): string {
    if (metadata?.source && metadata?.sourceRef) {
      // Branch format: ai/<source>-<sanitized-sourceRef>-<slug>
      const sanitizedRef = this.sanitizeSourceRef(metadata.sourceRef);
      const slug = metadata.title ? this.createSlug(metadata.title) : "task";
      return `ai/${metadata.source}-${sanitizedRef}-${slug}`;
    } else {
      // Fallback: ai/<timestamp>-<slug>
      const timestamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14); // YYYYMMDDHHmmss
      const slug = metadata?.title ? this.createSlug(metadata.title) : "task";
      return `ai/${timestamp}-${slug}`;
    }
  }

  /**
   * Sanitize sourceRef for use in branch names
   * Replace colons and special chars with dashes
   */
  private sanitizeSourceRef(sourceRef: string): string {
    return sourceRef
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  /**
   * Create a URL-safe slug from a title
   */
  private createSlug(title: string): string {
    const maxLen = 40;
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, maxLen);
  }

  /**
   * Extract title from spec markdown (first # heading)
   */
  private extractTitleFromSpec(spec: string): string {
    const lines = spec.split("\n");
    for (const line of lines) {
      const match = line.match(/^#\s+(.+)$/);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return "Generated Task";
  }
}
