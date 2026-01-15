/**
 * Background Spec Generation Manager
 *
 * Manages async spec generation for work items created with descriptions.
 * Tracks in-flight generations, handles retries, and updates work items on completion.
 */

import type { WorkItem } from "@whim/shared";
import type { Database } from "./db.js";
import { RalphSpecGenerator, type GenerateMetadata } from "./spec-gen.js";

const SPEC_MAX_ATTEMPTS = parseInt(process.env.SPEC_MAX_ATTEMPTS ?? "3", 10);

interface GenerationAttempt {
  workItemId: string;
  attempt: number;
  promise: Promise<void>;
}

/**
 * Manager for background spec generation
 * Handles async spec generation with retry logic
 */
export class SpecGenerationManager {
  private generator: RalphSpecGenerator;
  private inFlight: Map<string, GenerationAttempt>;

  constructor(private db: Database, config?: { timeoutMs?: number; workDir?: string }) {
    this.generator = new RalphSpecGenerator(config);
    this.inFlight = new Map();
  }

  /**
   * Start spec generation for a work item
   * Returns immediately - generation happens in background
   */
  start(workItem: WorkItem): void {
    // Don't start if already in flight
    if (this.inFlight.has(workItem.id)) {
      console.log(`[SpecGenManager] Generation already in progress for ${workItem.id}`);
      return;
    }

    // Validate work item has description
    if (!workItem.description) {
      console.error(`[SpecGenManager] Work item ${workItem.id} has no description`);
      return;
    }

    const attempt: GenerationAttempt = {
      workItemId: workItem.id,
      attempt: 1,
      promise: this.runGeneration(workItem, 1),
    };

    this.inFlight.set(workItem.id, attempt);
  }

  /**
   * Check if a work item has generation in progress
   */
  isGenerating(workItemId: string): boolean {
    return this.inFlight.has(workItemId);
  }

  /**
   * Get status of a work item's generation
   */
  getStatus(workItemId: string): { inProgress: boolean; attempt: number } {
    const attempt = this.inFlight.get(workItemId);
    return {
      inProgress: !!attempt,
      attempt: attempt?.attempt ?? 0,
    };
  }

  /**
   * Run spec generation with retry logic
   */
  private async runGeneration(workItem: WorkItem, attempt: number): Promise<void> {
    try {
      console.log(`[SpecGenManager] Starting generation for ${workItem.id} (attempt ${attempt})`);

      // Build metadata for branch naming
      const metadata: GenerateMetadata = {
        source: workItem.source ?? undefined,
        sourceRef: workItem.sourceRef ?? undefined,
        title: undefined, // Will be extracted from spec
      };

      // Generate spec using Ralph
      const result = await this.generator.generate(workItem.description!, metadata);

      // Update work item with generated spec and branch
      await this.db.execute(
        `UPDATE work_items
         SET spec = $1, branch = $2, status = 'queued'::work_item_status, updated_at = NOW()
         WHERE id = $3`,
        [result.spec, result.branch, workItem.id]
      );

      console.log(
        `[SpecGenManager] Generation succeeded for ${workItem.id} - branch: ${result.branch}`
      );

      // Remove from in-flight
      this.inFlight.delete(workItem.id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(
        `[SpecGenManager] Generation failed for ${workItem.id} (attempt ${attempt}): ${errorMessage}`
      );

      // Retry if under max attempts
      if (attempt < SPEC_MAX_ATTEMPTS) {
        console.log(`[SpecGenManager] Retrying ${workItem.id} (attempt ${attempt + 1})`);

        // Update attempt tracking
        const nextAttempt: GenerationAttempt = {
          workItemId: workItem.id,
          attempt: attempt + 1,
          promise: this.runGeneration(workItem, attempt + 1),
        };
        this.inFlight.set(workItem.id, nextAttempt);
      } else {
        // Max attempts reached - mark as failed
        console.error(`[SpecGenManager] Max attempts reached for ${workItem.id}`);

        await this.db.execute(
          `UPDATE work_items
           SET status = 'failed'::work_item_status, error = $1, updated_at = NOW()
           WHERE id = $2`,
          [`Spec generation failed after ${SPEC_MAX_ATTEMPTS} attempts: ${errorMessage}`, workItem.id]
        );

        // Remove from in-flight
        this.inFlight.delete(workItem.id);
      }
    }
  }

  /**
   * Get count of in-flight generations
   */
  getInFlightCount(): number {
    return this.inFlight.size;
  }

  /**
   * Get all in-flight work item IDs
   */
  getInFlightIds(): string[] {
    return Array.from(this.inFlight.keys());
  }
}
