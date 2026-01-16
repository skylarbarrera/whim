// Work Item Types

export type WorkItemType = "execution" | "verification";

export type WorkItemStatus =
  | "generating"
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
  branch: string | null;
  spec: string | null;
  description: string | null;
  type: WorkItemType;
  priority: Priority;
  status: WorkItemStatus;
  workerId: string | null;
  iteration: number;
  maxIterations: number;
  retryCount: number;
  nextRetryAt: Date | null;
  prUrl: string | null;
  prNumber: number | null;
  parentWorkItemId: string | null;
  verificationPassed: boolean | null;
  source: string | null;
  sourceRef: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  error: string | null;
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

// PR Review Types

export interface ReviewFindings {
  specAlignment: {
    score: "aligned" | "partial" | "misaligned";
    summary: string;
    gaps: string[];
    extras: string[];
  };
  codeQuality: {
    score: "good" | "acceptable" | "needs-work";
    summary: string;
    concerns: Array<{
      file: string;
      line?: number;
      issue: string;
      suggestion: string;
    }>;
  };
  overallSummary: string;
}

export interface PRReview {
  id: string;
  workItemId: string;
  prNumber: number;
  reviewTimestamp: Date;
  modelUsed: string;
  findings: ReviewFindings;
  createdAt: Date;
  updatedAt: Date;
}

// Metrics Types

export type TestStatus = "passed" | "failed" | "timeout" | "skipped" | "error";

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
  testStatus?: TestStatus;
  timestamp: Date;
}

export interface VerificationStats {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  passRate: number;
}

export interface WhimMetrics {
  activeWorkers: number;
  queuedItems: number;
  completedToday: number;
  failedToday: number;
  iterationsToday: number;
  dailyBudget: number;
  avgCompletionTime: number;
  successRate: number;
  verification?: VerificationStats;
}

// API Request Types

export interface AddWorkItemRequest {
  repo: string;
  branch?: string;
  spec?: string;
  description?: string;
  priority?: Priority;
  maxIterations?: number;
  source?: string;
  sourceRef?: string;
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
  repo: string;
  files: string[];
}

export interface WorkerCompleteRequest {
  prUrl?: string;
  prNumber?: number;
  verificationEnabled?: boolean;
  verificationPassed?: boolean;
  review?: {
    modelUsed: string;
    findings: ReviewFindings;
  };
  metrics?: {
    tokensIn: number;
    tokensOut: number;
    duration: number;
    filesModified: number;
    testsRun: number;
    testsPassed: number;
    testsFailed: number;
    testStatus?: TestStatus;
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

export interface WorkerLogsResponse {
  workerId: string;
  logs: string[];
}

// Config Types

export type HarnessType = "claude-code" | "codex" | "opencode";
export type ProjectType = "web" | "api" | "cli" | "library" | "monorepo";

export interface RalphConfig {
  harness: HarnessType;
}

export interface VerificationSettings {
  enabled: boolean;
  browser?: boolean;
  unit?: boolean;
  api?: boolean;
}

export interface WhimConfig {
  type: ProjectType;
  verification: VerificationSettings;
  packages?: Array<{
    path: string;
    type: ProjectType;
    verification: VerificationSettings;
  }>;
}

// Error Response

export interface ErrorResponse {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}
