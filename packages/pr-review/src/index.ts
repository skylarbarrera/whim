// Core modules
export { PRDetector } from './detector.js';
export { ReviewTracker, type DatabaseClient } from './tracker.js';
export { ResultAggregator, type AggregatedResult } from './aggregator.js';
export { ReviewService, type CheckConfig, type ServiceConfig } from './service.js';

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
