import type { PRReviewConfig } from "./config.js";

/**
 * Validation error with field path and message
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validate PR review configuration
 *
 * @param config - Configuration to validate
 * @returns Validation result with errors if any
 */
export function validateConfig(config: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  // Check if config is an object
  if (!config || typeof config !== "object") {
    return {
      valid: false,
      errors: [{ field: "root", message: "Config must be an object" }],
    };
  }

  const cfg = config as Record<string, unknown>;

  // Validate detection config
  if (cfg.detection !== undefined) {
    validateDetectionConfig(cfg.detection, errors);
  }

  // Validate lint config
  if (cfg.lint !== undefined) {
    validateLintConfig(cfg.lint, errors);
  }

  // Validate test config
  if (cfg.test !== undefined) {
    validateTestConfig(cfg.test, errors);
  }

  // Validate merge blocking config
  if (cfg.mergeBlocking !== undefined) {
    validateMergeBlockingConfig(cfg.mergeBlocking, errors);
  }

  // Validate branch protection config
  if (cfg.branchProtection !== undefined) {
    validateBranchProtectionConfig(cfg.branchProtection, errors);
  }

  // Validate GitHub config
  if (cfg.github !== undefined) {
    validateGitHubConfig(cfg.github, errors);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate detection configuration
 */
function validateDetectionConfig(
  detection: unknown,
  errors: ValidationError[]
): void {
  if (typeof detection !== "object" || detection === null) {
    errors.push({
      field: "detection",
      message: "Must be an object",
    });
    return;
  }

  const d = detection as Record<string, unknown>;

  // Validate minConfidence
  if (d.minConfidence !== undefined) {
    if (
      typeof d.minConfidence !== "number" ||
      d.minConfidence < 0 ||
      d.minConfidence > 1
    ) {
      errors.push({
        field: "detection.minConfidence",
        message: "Must be a number between 0 and 1",
      });
    }
  }

  // Validate branchPatterns
  if (d.branchPatterns !== undefined) {
    if (!Array.isArray(d.branchPatterns)) {
      errors.push({
        field: "detection.branchPatterns",
        message: "Must be an array of strings",
      });
    } else {
      d.branchPatterns.forEach((pattern, idx) => {
        if (typeof pattern !== "string") {
          errors.push({
            field: `detection.branchPatterns[${idx}]`,
            message: "Must be a string",
          });
        }
      });
    }
  }

  // Validate labelPatterns
  if (d.labelPatterns !== undefined) {
    if (!Array.isArray(d.labelPatterns)) {
      errors.push({
        field: "detection.labelPatterns",
        message: "Must be an array of strings",
      });
    } else {
      d.labelPatterns.forEach((pattern, idx) => {
        if (typeof pattern !== "string") {
          errors.push({
            field: `detection.labelPatterns[${idx}]`,
            message: "Must be a string",
          });
        }
      });
    }
  }

  // Validate authorPatterns
  if (d.authorPatterns !== undefined) {
    if (!Array.isArray(d.authorPatterns)) {
      errors.push({
        field: "detection.authorPatterns",
        message: "Must be an array of strings",
      });
    } else {
      d.authorPatterns.forEach((pattern, idx) => {
        if (typeof pattern !== "string") {
          errors.push({
            field: `detection.authorPatterns[${idx}]`,
            message: "Must be a string",
          });
        }
      });
    }
  }

  // Validate checkCoAuthor
  if (d.checkCoAuthor !== undefined && typeof d.checkCoAuthor !== "boolean") {
    errors.push({
      field: "detection.checkCoAuthor",
      message: "Must be a boolean",
    });
  }
}

/**
 * Validate lint configuration
 */
function validateLintConfig(lint: unknown, errors: ValidationError[]): void {
  if (typeof lint !== "object" || lint === null) {
    errors.push({
      field: "lint",
      message: "Must be an object",
    });
    return;
  }

  const l = lint as Record<string, unknown>;

  // Validate enabled
  if (l.enabled !== undefined && typeof l.enabled !== "boolean") {
    errors.push({
      field: "lint.enabled",
      message: "Must be a boolean",
    });
  }

  // Validate required
  if (l.required !== undefined && typeof l.required !== "boolean") {
    errors.push({
      field: "lint.required",
      message: "Must be a boolean",
    });
  }

  // Validate timeout
  if (l.timeout !== undefined) {
    if (typeof l.timeout !== "number" || l.timeout < 1000) {
      errors.push({
        field: "lint.timeout",
        message: "Must be a number >= 1000 (milliseconds)",
      });
    }
  }

  // Validate failureThreshold
  if (l.failureThreshold !== undefined) {
    if (typeof l.failureThreshold !== "number" || l.failureThreshold < 0) {
      errors.push({
        field: "lint.failureThreshold",
        message: "Must be a non-negative number",
      });
    }
  }

  // Validate tools
  if (l.tools !== undefined) {
    if (!Array.isArray(l.tools)) {
      errors.push({
        field: "lint.tools",
        message: "Must be an array",
      });
    } else {
      l.tools.forEach((tool, idx) => {
        if (typeof tool !== "object" || tool === null) {
          errors.push({
            field: `lint.tools[${idx}]`,
            message: "Must be an object",
          });
          return;
        }

        const t = tool as Record<string, unknown>;

        if (typeof t.name !== "string") {
          errors.push({
            field: `lint.tools[${idx}].name`,
            message: "Must be a string",
          });
        }

        if (typeof t.command !== "string") {
          errors.push({
            field: `lint.tools[${idx}].command`,
            message: "Must be a string",
          });
        }

        if (t.enabled !== undefined && typeof t.enabled !== "boolean") {
          errors.push({
            field: `lint.tools[${idx}].enabled`,
            message: "Must be a boolean",
          });
        }

        if (t.include !== undefined && !Array.isArray(t.include)) {
          errors.push({
            field: `lint.tools[${idx}].include`,
            message: "Must be an array of strings",
          });
        }

        if (t.exclude !== undefined && !Array.isArray(t.exclude)) {
          errors.push({
            field: `lint.tools[${idx}].exclude`,
            message: "Must be an array of strings",
          });
        }
      });
    }
  }
}

/**
 * Validate test configuration
 */
function validateTestConfig(test: unknown, errors: ValidationError[]): void {
  if (typeof test !== "object" || test === null) {
    errors.push({
      field: "test",
      message: "Must be an object",
    });
    return;
  }

  const t = test as Record<string, unknown>;

  // Validate enabled
  if (t.enabled !== undefined && typeof t.enabled !== "boolean") {
    errors.push({
      field: "test.enabled",
      message: "Must be a boolean",
    });
  }

  // Validate required
  if (t.required !== undefined && typeof t.required !== "boolean") {
    errors.push({
      field: "test.required",
      message: "Must be a boolean",
    });
  }

  // Validate timeout
  if (t.timeout !== undefined) {
    if (typeof t.timeout !== "number" || t.timeout < 1000) {
      errors.push({
        field: "test.timeout",
        message: "Must be a number >= 1000 (milliseconds)",
      });
    }
  }

  // Validate command
  if (t.command !== undefined && typeof t.command !== "string") {
    errors.push({
      field: "test.command",
      message: "Must be a string",
    });
  }

  // Validate minPassPercentage
  if (t.minPassPercentage !== undefined) {
    if (
      typeof t.minPassPercentage !== "number" ||
      t.minPassPercentage < 0 ||
      t.minPassPercentage > 100
    ) {
      errors.push({
        field: "test.minPassPercentage",
        message: "Must be a number between 0 and 100",
      });
    }
  }

  // Validate minCoverage
  if (t.minCoverage !== undefined) {
    if (
      typeof t.minCoverage !== "number" ||
      t.minCoverage < 0 ||
      t.minCoverage > 100
    ) {
      errors.push({
        field: "test.minCoverage",
        message: "Must be a number between 0 and 100",
      });
    }
  }
}

/**
 * Validate merge blocking configuration
 */
function validateMergeBlockingConfig(
  mergeBlocking: unknown,
  errors: ValidationError[]
): void {
  if (typeof mergeBlocking !== "object" || mergeBlocking === null) {
    errors.push({
      field: "mergeBlocking",
      message: "Must be an object",
    });
    return;
  }

  const mb = mergeBlocking as Record<string, unknown>;

  // Validate enabled
  if (mb.enabled !== undefined && typeof mb.enabled !== "boolean") {
    errors.push({
      field: "mergeBlocking.enabled",
      message: "Must be a boolean",
    });
  }

  // Validate requiredChecks
  if (mb.requiredChecks !== undefined) {
    if (!Array.isArray(mb.requiredChecks)) {
      errors.push({
        field: "mergeBlocking.requiredChecks",
        message: "Must be an array of strings",
      });
    } else {
      mb.requiredChecks.forEach((check, idx) => {
        if (typeof check !== "string") {
          errors.push({
            field: `mergeBlocking.requiredChecks[${idx}]`,
            message: "Must be a string",
          });
        }
      });
    }
  }

  // Validate overrideUsers
  if (mb.overrideUsers !== undefined) {
    if (!Array.isArray(mb.overrideUsers)) {
      errors.push({
        field: "mergeBlocking.overrideUsers",
        message: "Must be an array of strings",
      });
    } else {
      mb.overrideUsers.forEach((user, idx) => {
        if (typeof user !== "string") {
          errors.push({
            field: `mergeBlocking.overrideUsers[${idx}]`,
            message: "Must be a string",
          });
        }
      });
    }
  }

  // Validate requireOverrideReason
  if (
    mb.requireOverrideReason !== undefined &&
    typeof mb.requireOverrideReason !== "boolean"
  ) {
    errors.push({
      field: "mergeBlocking.requireOverrideReason",
      message: "Must be a boolean",
    });
  }
}

/**
 * Validate branch protection configuration
 */
function validateBranchProtectionConfig(
  branchProtection: unknown,
  errors: ValidationError[]
): void {
  if (typeof branchProtection !== "object" || branchProtection === null) {
    errors.push({
      field: "branchProtection",
      message: "Must be an object",
    });
    return;
  }

  const bp = branchProtection as Record<string, unknown>;

  // Validate enabled
  if (bp.enabled !== undefined && typeof bp.enabled !== "boolean") {
    errors.push({
      field: "branchProtection.enabled",
      message: "Must be a boolean",
    });
  }

  // Validate branches
  if (bp.branches !== undefined) {
    if (!Array.isArray(bp.branches)) {
      errors.push({
        field: "branchProtection.branches",
        message: "Must be an array of strings",
      });
    } else {
      bp.branches.forEach((branch, idx) => {
        if (typeof branch !== "string") {
          errors.push({
            field: `branchProtection.branches[${idx}]`,
            message: "Must be a string",
          });
        }
      });
    }
  }

  // Validate requirePullRequestReviews
  if (
    bp.requirePullRequestReviews !== undefined &&
    typeof bp.requirePullRequestReviews !== "boolean"
  ) {
    errors.push({
      field: "branchProtection.requirePullRequestReviews",
      message: "Must be a boolean",
    });
  }

  // Validate requiredApprovingReviews
  if (bp.requiredApprovingReviews !== undefined) {
    if (
      typeof bp.requiredApprovingReviews !== "number" ||
      bp.requiredApprovingReviews < 0 ||
      bp.requiredApprovingReviews > 6
    ) {
      errors.push({
        field: "branchProtection.requiredApprovingReviews",
        message: "Must be a number between 0 and 6",
      });
    }
  }

  // Validate dismissStaleReviews
  if (
    bp.dismissStaleReviews !== undefined &&
    typeof bp.dismissStaleReviews !== "boolean"
  ) {
    errors.push({
      field: "branchProtection.dismissStaleReviews",
      message: "Must be a boolean",
    });
  }
}

/**
 * Validate GitHub configuration
 */
function validateGitHubConfig(
  github: unknown,
  errors: ValidationError[]
): void {
  if (typeof github !== "object" || github === null) {
    errors.push({
      field: "github",
      message: "Must be an object",
    });
    return;
  }

  const gh = github as Record<string, unknown>;

  // Validate token
  if (gh.token !== undefined && typeof gh.token !== "string") {
    errors.push({
      field: "github.token",
      message: "Must be a string",
    });
  }

  // Validate statusContext
  if (gh.statusContext !== undefined && typeof gh.statusContext !== "string") {
    errors.push({
      field: "github.statusContext",
      message: "Must be a string",
    });
  }

  // Validate targetUrl
  if (gh.targetUrl !== undefined && typeof gh.targetUrl !== "string") {
    errors.push({
      field: "github.targetUrl",
      message: "Must be a string",
    });
  }

  // Validate syncBranchProtection
  if (
    gh.syncBranchProtection !== undefined &&
    typeof gh.syncBranchProtection !== "boolean"
  ) {
    errors.push({
      field: "github.syncBranchProtection",
      message: "Must be a boolean",
    });
  }
}
