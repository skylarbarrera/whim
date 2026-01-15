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
