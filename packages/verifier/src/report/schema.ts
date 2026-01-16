/**
 * Verification Report Schema
 *
 * TypeScript interfaces for the verifier agent's output.
 */

export type Verdict = 'pass' | 'needs_work' | 'fail';
export type SpecStatus = 'pass' | 'partial' | 'fail' | 'skipped';
export type ReviewStatus = 'pass' | 'needs_work' | 'fail';
export type TestStatus = 'pass' | 'fail' | 'skipped';
export type TypeCheckStatus = 'pass' | 'fail';
export type BrowserCheckStatus = 'pass' | 'warnings' | 'fail';
export type IntegrationCheckStatus = 'pass' | 'fail';
export type IssueSeverity = 'error' | 'warning' | 'info';
export type IssueCategory = 'security' | 'bugs' | 'performance' | 'quality' | 'api_contract';
export type BrowserIssueType = 'console_error' | 'render' | 'a11y' | 'interaction';

/**
 * Code issue found during review.
 */
export interface CodeIssue {
  file: string;
  line?: number;
  severity: IssueSeverity;
  category: IssueCategory;
  message: string;
  suggestion?: string;
}

/**
 * Type error information.
 */
export interface TypeErrorInfo {
  file: string;
  line: number;
  message: string;
}

/**
 * Browser check issue.
 */
export interface BrowserIssue {
  page: string;
  type: BrowserIssueType;
  message: string;
  screenshot?: string;
}

/**
 * Spec compliance check result.
 */
export interface SpecCompliance {
  status: SpecStatus;
  requirementsChecked: number;
  requirementsMet: number;
  missingRequirements: string[];
  scopeCreep: string[];
  scopeCreepIsBlocking: boolean;
  notes: string[];
}

/**
 * Code review result.
 */
export interface CodeReview {
  status: ReviewStatus;
  issuesByCategory: {
    security: CodeIssue[];
    bugs: CodeIssue[];
    performance: CodeIssue[];
    quality: CodeIssue[];
    api_contract: CodeIssue[];
  };
  counts: {
    errors: number;
    warnings: number;
    info: number;
  };
  issues: CodeIssue[];
  suggestions: string[];
}

/**
 * Test execution result.
 */
export interface TestResults {
  status: TestStatus;
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  failingTests: string[];
  coverage?: number;
  /** Tests that failed initially but passed on retry */
  flakyTests?: FlakyTest[];
}

/**
 * Type check result.
 */
export interface TypeCheck {
  status: TypeCheckStatus;
  errors: TypeErrorInfo[];
}

/**
 * Temporary tests result (optional check).
 */
export interface TemporaryTests {
  testsWritten: number;
  testsRun: number;
  testsPassed: number;
  findings: string[];
}

/**
 * Browser verification result (optional check).
 */
export interface BrowserCheck {
  status: BrowserCheckStatus;
  pagesChecked: string[];
  issues: BrowserIssue[];
  screenshots?: string[];
}

/**
 * Integration check result (optional check).
 */
export interface IntegrationCheck {
  status: IntegrationCheckStatus;
  endpointsTested: string[];
  issues: string[];
}

/**
 * Performance check result (optional check).
 */
export interface PerformanceCheck {
  status: BrowserCheckStatus;
  buildSizeKb?: number;
  bundleAnalysis?: {
    totalSizeKb: number;
    largestChunks: { name: string; sizeKb: number }[];
  };
  issues: string[];
}

/**
 * Action item for feedback to Ralph.
 */
export interface ActionItem {
  priority: 1 | 2 | 3;
  type: 'test_failure' | 'type_error' | 'spec_missing' | 'security' | 'bug' | 'review';
  description: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

/**
 * Failing test details for feedback.
 */
export interface FailingTestDetail {
  name: string;
  error: string;
  file: string;
}

/**
 * Verification feedback for Ralph when verdict is not 'pass'.
 */
export interface VerificationFeedback {
  actionItems: ActionItem[];
  failingTests?: FailingTestDetail[];
  typeErrors?: TypeErrorInfo[];
  missingRequirements?: string[];
}

/**
 * Full verification report.
 */
export interface VerificationReport {
  // Metadata
  prNumber: number;
  repo: string;
  branch: string;
  sha: string;
  verifiedAt: string;
  durationMs: number;
  harness: 'claude' | 'codex';

  // Overall verdict
  verdict: Verdict;
  summary: string;

  // Required checks
  specCompliance: SpecCompliance;
  codeReview: CodeReview;
  testResults: TestResults;
  typeCheck: TypeCheck;

  // Optional checks (null if not performed)
  temporaryTests?: TemporaryTests;
  browserCheck?: BrowserCheck;
  integrationCheck?: IntegrationCheck;
  performanceCheck?: PerformanceCheck;

  // Metadata
  costUsd?: number;

  // Phase 3: Advanced Review
  /** Self-critique phase results (if performed) */
  critique?: CritiqueOutput;
  /** Cost tracking details */
  costTracking?: CostTracking;

  // Feedback for Ralph (populated when verdict !== 'pass')
  feedback?: VerificationFeedback;
}

/**
 * Options for the verify() function.
 */
export interface VerifyOptions {
  repoDir: string;
  prNumber: number;
  harness: 'claude' | 'codex';
  githubToken: string;
  repo?: string;
  branch?: string;
  sha?: string;
}

/**
 * PERCEIVE phase output.
 */
export interface PerceiveOutput {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  scope: {
    hasFrontend: boolean;
    hasBackend: boolean;
    hasTests: boolean;
    hasConfig: boolean;
    hasMigrations: boolean;
  };
  specFound: boolean;
  specRequirements: string[];
  relatedFiles: string[];
  complexity: 'simple' | 'medium' | 'complex';
  estimatedDurationSec: number;
}

/**
 * PLAN phase output.
 */
export interface PlanOutput {
  checksPlanned: Array<{
    check: string;
    reason: string;
    priority: number;
  }>;
  chunkingStrategy?: {
    enabled: boolean;
    chunks: Array<{
      files: string[];
      description: string;
    }>;
  };
  estimatedCost: number;
  estimatedDuration: number;
}

/**
 * CRITIQUE phase output.
 */
export interface CritiqueOutput {
  originalFindings: number;
  filteredFindings: number;
  filterReasons: Array<{
    finding: string;
    reason: 'false_positive' | 'not_actionable' | 'out_of_scope' | 'too_minor' | 'wrong_severity';
  }>;
}

/**
 * Flaky test information.
 */
export interface FlakyTest {
  name: string;
  file?: string;
  /** First run failed, retry passed */
  passedOnRetry: boolean;
}

/**
 * Cost tracking information.
 */
export interface CostTracking {
  /** Total cost in USD */
  totalCostUsd: number;
  /** Number of LLM calls made */
  llmCalls: number;
  /** Total duration in ms */
  totalDurationMs: number;
  /** Whether budget was exceeded */
  budgetExceeded: boolean;
  /** Which budget limit was hit (if any) */
  limitHit?: 'cost' | 'duration' | 'calls';
}
