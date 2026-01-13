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

// PR Review Types

export type ReviewStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type CheckStatus = "pending" | "running" | "success" | "failure" | "skipped" | "error";

export type CheckType = "lint" | "test" | "typecheck" | "build" | "security" | "quality";

export interface PRReview {
  id: string;
  repoOwner: string;
  repoName: string;
  prNumber: number;
  status: ReviewStatus;
  isAIGenerated: boolean;
  detectionConfidence: number;
  detectionReasons: string[];
  startedAt: Date;
  completedAt: Date | null;
  mergeBlocked: boolean;
  overrideUser: string | null;
  overrideReason: string | null;
  overrideAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PRReviewCheck {
  id: string;
  reviewId: string;
  checkName: string;
  checkType: CheckType;
  status: CheckStatus;
  required: boolean;
  summary: string | null;
  details: string | null;
  errorCount: number;
  warningCount: number;
  duration: number | null;
  startedAt: Date;
  completedAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface CheckError {
  file?: string;
  line?: number;
  column?: number;
  message: string;
  rule?: string;
  severity: "error";
}

export interface CheckWarning {
  file?: string;
  line?: number;
  column?: number;
  message: string;
  rule?: string;
  severity: "warning";
}

export interface DetectionResult {
  isAI: boolean;
  confidence: number;
  reasons: string[];
  metadata: Record<string, unknown>;
}

export interface PRContext {
  owner: string;
  repo: string;
  prNumber: number;
  commits: Array<{
    sha: string;
    message: string;
    author: string;
  }>;
  branch: string;
  baseBranch: string;
  labels: string[];
  description: string;
  changedFiles: string[];
}

export interface CheckResult {
  status: CheckStatus;
  summary: string;
  details: string;
  errors?: CheckError[];
  warnings?: CheckWarning[];
  duration: number;
  metadata: Record<string, unknown>;
}

export interface AggregatedResult {
  overallStatus: "pass" | "fail" | "error";
  mergeBlocked: boolean;
  passedChecks: number;
  failedChecks: number;
  skippedChecks: number;
  totalErrors: number;
  totalWarnings: number;
  summary: string;
  checkResults: Array<{
    name: string;
    status: CheckStatus;
    required: boolean;
    errorCount: number;
    warningCount: number;
  }>;
}

// PR Review API Types

export interface CreateReviewRequest {
  repoOwner: string;
  repoName: string;
  prNumber: number;
  isAIGenerated: boolean;
  detectionConfidence: number;
  detectionReasons: string[];
}

export interface UpdateReviewRequest {
  status?: ReviewStatus;
  mergeBlocked?: boolean;
  overrideUser?: string;
  overrideReason?: string;
}

export interface CreateCheckRequest {
  reviewId: string;
  checkName: string;
  checkType: CheckType;
  required: boolean;
}

export interface UpdateCheckRequest {
  status?: CheckStatus;
  summary?: string;
  details?: string;
  errorCount?: number;
  warningCount?: number;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export interface ListReviewsRequest {
  repoOwner?: string;
  repoName?: string;
  status?: ReviewStatus;
  limit?: number;
  offset?: number;
}

export interface OverrideReviewRequest {
  reason: string;
}

// Error Response

export interface ErrorResponse {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}
