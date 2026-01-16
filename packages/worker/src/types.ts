import type { WorkItem } from "@whim/shared";

/**
 * Work item that is ready for execution (has spec and branch).
 * Used after validation to ensure type safety.
 *
 * Execution workers require these fields to be present:
 * - spec: The SPEC.md content to write to the repo
 * - branch: The branch to create and push to
 */
export interface ExecutionReadyWorkItem extends Omit<WorkItem, "spec" | "branch"> {
  spec: string;
  branch: string;
}

/**
 * Type guard to check if a work item is ready for execution
 */
export function isExecutionReady(workItem: WorkItem): workItem is ExecutionReadyWorkItem {
  return workItem.spec !== null && workItem.branch !== null;
}

/**
 * Work item that is ready for verification (has branch and prNumber).
 * Used by verification workers to validate type safety.
 *
 * Verification workers require these fields to be present:
 * - branch: The branch to checkout and verify
 * - prNumber: The PR number to comment on with results
 */
export interface VerificationReadyWorkItem extends Omit<WorkItem, "branch" | "prNumber"> {
  branch: string;
  prNumber: number;
}

/**
 * Type guard to check if a work item is ready for verification
 */
export function isVerificationReady(workItem: WorkItem): workItem is VerificationReadyWorkItem {
  return workItem.branch !== null && workItem.prNumber !== null && workItem.prNumber !== undefined;
}
