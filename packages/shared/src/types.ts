// Work Item Types

export type WorkItemStatus =
  | "queued"
  | "assigned"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export type Priority = "low" | "medium" | "high" | "critical";

export interface WorkItem {
  id: string;
  repo: string;
  branch: string;
  spec: string;
  priority: Priority;
  status: WorkItemStatus;
  workerId: string | null;
  iteration: number;
  maxIterations: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  error: string | null;
  prUrl: string | null;
  metadata: Record<string, unknown>;
}

// Worker Types

export type WorkerStatus =
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "stuck"
  | "killed";

export interface Worker {
  id: string;
  workItemId: string;
  status: WorkerStatus;
  iteration: number;
  lastHeartbeat: Date;
  startedAt: Date;
  completedAt: Date | null;
  containerId: string | null;
  error: string | null;
}

// Learning Types

export interface Learning {
  id: string;
  repo: string;
  spec: string;
  content: string;
  embedding: number[] | null;
  createdAt: Date;
  workItemId: string | null;
}

// Metrics Types

export interface WorkerMetrics {
  id: string;
  workerId: string;
  workItemId: string;
  iteration: number;
  tokensIn: number;
  tokensOut: number;
  duration: number;
  filesModified: number;
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  testStatus?: "passed" | "failed" | "timeout" | "skipped" | "error";
  timestamp: Date;
}

export interface FactoryMetrics {
  activeWorkers: number;
  queuedItems: number;
  completedToday: number;
  failedToday: number;
  iterationsToday: number;
  dailyBudget: number;
  avgCompletionTime: number;
  successRate: number;
}

// API Request Types

export interface AddWorkItemRequest {
  repo: string;
  branch?: string;
  spec: string;
  priority?: Priority;
  maxIterations?: number;
  metadata?: Record<string, unknown>;
}

export interface WorkerRegisterRequest {
  workItemId: string;
}

export interface WorkerHeartbeatRequest {
  iteration: number;
  status?: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface WorkerLockRequest {
  files: string[];
}

export interface WorkerCompleteRequest {
  prUrl?: string;
  metrics?: {
    tokensIn: number;
    tokensOut: number;
    duration: number;
    filesModified: number;
    testsRun: number;
    testsPassed: number;
    testsFailed: number;
    testStatus?: "passed" | "failed" | "timeout" | "skipped" | "error";
  };
  learnings?: Array<{
    content: string;
    spec: string;
  }>;
}

export interface WorkerFailRequest {
  error: string;
  iteration: number;
}

export interface WorkerStuckRequest {
  reason: string;
  attempts: number;
}

// API Response Types

export interface AddWorkItemResponse {
  id: string;
  status: WorkItemStatus;
}

export interface WorkerRegisterResponse {
  workerId: string;
  workItem: WorkItem;
}

export interface WorkerLockResponse {
  acquired: boolean;
  conflictingWorker?: string;
}

export interface StatusResponse {
  status: "healthy" | "degraded" | "error";
  workers: {
    active: number;
    maxWorkers: number;
  };
  queue: {
    size: number;
    oldest: Date | null;
  };
  rateLimits: {
    iterationsToday: number;
    dailyBudget: number;
    lastSpawn: Date | null;
    cooldownSeconds: number;
  };
}

export interface QueueStatsResponse {
  total: number;
  byStatus: Record<WorkItemStatus, number>;
  byPriority: Record<Priority, number>;
}

export interface WorkerStatsResponse {
  total: number;
  byStatus: Record<WorkerStatus, number>;
  avgIterations: number;
  avgDuration: number;
}

// Error Response

export interface ErrorResponse {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}
