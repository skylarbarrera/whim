// Core modules
export { PRDetector } from './detector.js';
export { ReviewTracker, type DatabaseClient } from './tracker.js';
export { ResultAggregator, type AggregatedResult } from './aggregator.js';
export { ReviewService, type CheckConfig, type ServiceConfig } from './service.js';

// Merge blocking
export { GitHubStatusClient, REVIEW_STATUS_CONTEXT, type StatusState, type CreateStatusParams, type CommitStatus } from './github-status.js';
export { BranchProtectionManager, type BranchProtection, type UpdateProtectionParams } from './branch-protection.js';
export { MergeGuardian, type MergeDecision, type OverrideParams } from './merge-guardian.js';

// Check modules
export { BaseCheck, type CheckConfig as BaseCheckConfig } from './checks/base-check.js';
export { LintCheck } from './checks/lint-check.js';
export { TestCheck } from './checks/test-check.js';

// Configuration
export { loadConfig, getLintConfig, getTestConfig, type PRReviewConfig, type LintConfig, type TestConfig, type LintToolConfig } from './config.js';

// Lint runner
export { runLintTool, runLintTools, type LintResult } from './lint-runner.js';

// Test runner
export { runTests, parseTestOutput, type TestResult, type TestStats, type TestFailure } from './test-runner.js';

// Re-export types from shared
export type {
  PRReview,
  PRReviewCheck,
  ReviewStatus,
  CheckStatus,
  CheckType,
  DetectionResult,
  PRContext,
  CheckResult,
  CheckError,
  CheckWarning,
} from '@factory/shared';
