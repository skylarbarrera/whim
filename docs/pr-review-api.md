# PR Review System API Reference

## Overview

The PR Review System provides a comprehensive API for detecting AI-generated pull requests, running automated checks (lint, tests, etc.), and managing merge blocking. The system is built around several key components that work together to provide a complete PR review workflow.

## Core Components

### ReviewService

The main entry point for the PR review system. Coordinates detection, tracking, aggregation, and GitHub integration.

#### Constructor

```typescript
constructor(
  db: DatabaseClient,
  config: ServiceConfig,
  githubToken?: string,
  dashboardUrl?: string
)
```

**Parameters:**
- `db`: Database client for PostgreSQL operations (see DatabaseClient interface)
- `config`: Service configuration with check definitions
- `githubToken` (optional): GitHub personal access token for status API and branch protection
- `dashboardUrl` (optional): URL to dashboard for status check links

**Example:**
```typescript
import { ReviewService } from '@factory/pr-review';
import { Pool } from 'pg';

const db = new Pool({ connectionString: process.env.DATABASE_URL });
const service = new ReviewService(
  db,
  {
    checks: [
      { name: 'lint', type: 'lint', required: true },
      { name: 'test', type: 'test', required: true },
    ]
  },
  process.env.GITHUB_TOKEN,
  'https://factory.example.com/pr-reviews'
);
```

#### Methods

##### detectAndCreateReview(context: PRContext)

Detects if a PR is AI-generated and creates a review record if applicable.

**Parameters:**
- `context`: PR context with commits, files, labels, etc.

**Returns:**
```typescript
Promise<{
  review: PRReview;
  checks: PRReviewCheck[];
} | null>
```

Returns `null` if PR is not detected as AI-generated.

**Example:**
```typescript
const context = {
  owner: 'myorg',
  repo: 'myrepo',
  prNumber: 123,
  title: 'Fix bug in authentication',
  body: 'This PR fixes...',
  commits: [
    {
      sha: 'abc123',
      message: 'Fix auth bug\n\nCo-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>',
      author: 'dev-user'
    }
  ],
  files: ['src/auth.ts', 'tests/auth.test.ts'],
  labels: [],
  branch: 'ai/issue-42-auth-fix'
};

const result = await service.detectAndCreateReview(context);
if (result) {
  console.log(`Review created: ${result.review.id}`);
  console.log(`Checks to run: ${result.checks.length}`);
}
```

##### getReviewStatus(reviewId: string)

Gets review status with aggregated check results.

**Returns:**
```typescript
Promise<{
  review: PRReview;
  checks: PRReviewCheck[];
  aggregated: AggregatedResult;
} | null>
```

**Example:**
```typescript
const status = await service.getReviewStatus(reviewId);
if (status) {
  console.log(`Status: ${status.review.status}`);
  console.log(`Merge blocked: ${status.aggregated.mergeBlocked}`);
  console.log(`Summary: ${status.aggregated.summary}`);
}
```

##### getReviewStatusByPR(repoOwner: string, repoName: string, prNumber: number)

Gets review status by repository and PR number instead of review ID.

**Example:**
```typescript
const status = await service.getReviewStatusByPR('myorg', 'myrepo', 123);
```

##### runCheck(reviewId: string, checkId: string, check: BaseCheck, context: PRContext, workdir: string)

Runs a check and updates its result in the database. Automatically updates review status and reports to GitHub.

**Parameters:**
- `reviewId`: ID of the review
- `checkId`: ID of the check record
- `check`: Check instance (e.g., `new LintCheck(config)`)
- `context`: PR context
- `workdir`: Working directory where repository is checked out

**Returns:** `Promise<PRReviewCheck>` - Updated check record

**Example:**
```typescript
import { LintCheck, getLintConfig } from '@factory/pr-review';

const lintConfig = getLintConfig('/path/to/repo');
const lintCheck = new LintCheck(lintConfig);

const updatedCheck = await service.runCheck(
  reviewId,
  checkId,
  lintCheck,
  context,
  '/tmp/repo-checkout'
);

console.log(`Check ${updatedCheck.checkName}: ${updatedCheck.status}`);
```

##### updateMergeStatus(reviewId: string)

Updates merge status based on current check results. Recalculates whether merge should be blocked.

**Returns:** `Promise<AggregatedResult>`

##### overrideReview(reviewId: string, user: string, reason: string)

Records an override in the database (for audit trail). Use `emergencyOverride` to also update GitHub status.

##### emergencyOverride(reviewId: string, user: string, reason: string)

Performs emergency override to allow merge despite check failures. Updates review status to completed and reports to GitHub.

**Parameters:**
- `reviewId`: Review to override
- `user`: Username performing override
- `reason`: Justification for override

**Returns:** `Promise<MergeDecision>`

**Example:**
```typescript
const decision = await service.emergencyOverride(
  reviewId,
  'ops-lead',
  'Critical production hotfix - bypassing checks'
);
console.log(`Override allowed: ${decision.allowed}`);
```

##### canMerge(reviewId: string)

Checks if PR can be merged based on current check results.

**Returns:**
```typescript
Promise<{
  allowed: boolean;
  reason: string;
  checksPassed: number;
  checksFailed: number;
  checksPending: number;
}>
```

##### listReviews(filters?: object)

Lists all reviews with optional filters.

**Filters:**
- `status`: Filter by review status ('pending', 'running', 'completed', 'failed', 'cancelled')
- `repoOwner`: Filter by repository owner
- `repoName`: Filter by repository name
- `mergeBlocked`: Filter by merge blocked status (boolean)

**Returns:** `Promise<PRReview[]>`

**Example:**
```typescript
// Get all blocked reviews
const blocked = await service.listReviews({ mergeBlocked: true });

// Get running reviews for a specific repo
const running = await service.listReviews({
  status: 'running',
  repoOwner: 'myorg',
  repoName: 'myrepo'
});
```

##### evaluateAndReportStatus(reviewId: string)

Evaluates merge eligibility and reports status to GitHub (if configured).

**Returns:** `Promise<MergeDecision>`

##### syncProtection(owner: string, repo: string, branches?: string[])

Synchronizes branch protection rules for a repository. Ensures AI factory review is required on specified branches.

**Parameters:**
- `owner`: Repository owner
- `repo`: Repository name
- `branches`: Branches to protect (default: ['main', 'master'])

**Returns:** `Promise<Map<string, boolean>>` - Map of branch names to success status

**Example:**
```typescript
const results = await service.syncProtection('myorg', 'myrepo', ['main', 'develop']);
console.log(`Protected main: ${results.get('main')}`);
```

##### getCheckSummary(reviewId: string)

Gets check summary statistics for a review.

**Returns:**
```typescript
Promise<{
  total: number;
  required: number;
  passed: number;
  failed: number;
  pending: number;
}>
```

---

## Check System

### BaseCheck

Abstract base class for all check types. Provides timeout handling, status management, and error handling.

#### Methods

##### run(context: PRContext, workdir: string): Promise<CheckResult>

Runs the check. Must be implemented by subclasses.

##### getName(): string

Returns the check name.

##### isRequired(): boolean

Returns whether the check is required for merge.

**Example of extending BaseCheck:**
```typescript
import { BaseCheck, type CheckResult } from '@factory/pr-review';

export class CustomCheck extends BaseCheck {
  async run(context: PRContext, workdir: string): Promise<CheckResult> {
    const startTime = Date.now();

    // Your check logic here
    const passed = await this.performCheck(workdir);

    return {
      status: passed ? 'success' : 'failure',
      summary: passed ? 'Check passed' : 'Check failed',
      details: 'Detailed output...',
      errors: passed ? [] : [{ message: 'Error details', line: 10 }],
      warnings: [],
      duration: Date.now() - startTime,
      metadata: { customField: 'value' }
    };
  }
}
```

### LintCheck

Runs configured lint tools and reports violations.

**Constructor:**
```typescript
constructor(config: LintConfig)
```

**Example:**
```typescript
import { LintCheck, getLintConfig } from '@factory/pr-review';

const config = getLintConfig('/repo/path');
const lintCheck = new LintCheck(config);

const result = await lintCheck.run(context, '/tmp/checkout');
console.log(`Errors: ${result.errors?.length || 0}`);
```

### TestCheck

Runs test suite and reports results.

**Constructor:**
```typescript
constructor(config: TestConfig)
```

**Example:**
```typescript
import { TestCheck, getTestConfig } from '@factory/pr-review';

const config = getTestConfig('/repo/path');
const testCheck = new TestCheck(config);

const result = await testCheck.run(context, '/tmp/checkout');
console.log(`Pass percentage: ${result.metadata?.passPercentage}%`);
```

---

## Configuration System

### loadConfig(repoPath: string): PRReviewConfig

Loads configuration from `.ai/pr-review.yml` and merges with defaults.

**Example:**
```typescript
import { loadConfig } from '@factory/pr-review';

const config = loadConfig('/path/to/repo');
console.log(`Min confidence: ${config.detection?.minConfidence}`);
```

### Configuration Helpers

Each configuration section has a dedicated helper function:

- `getDetectionConfig(repoPath)` - PR detection settings
- `getLintConfig(repoPath)` - Lint check configuration
- `getTestConfig(repoPath)` - Test check configuration
- `getMergeBlockingConfig(repoPath)` - Merge blocking rules
- `getBranchProtectionConfig(repoPath)` - Branch protection settings
- `getGitHubConfig(repoPath)` - GitHub integration settings

### validateConfig(config: Partial<PRReviewConfig>): ValidationResult

Validates configuration object against schema.

**Returns:**
```typescript
{
  valid: boolean;
  errors: Array<{
    field: string;
    message: string;
    value?: any;
  }>;
}
```

**Example:**
```typescript
import { validateConfig } from '@factory/pr-review';

const validation = validateConfig({
  lint: {
    enabled: true,
    timeout: -1000 // Invalid!
  }
});

if (!validation.valid) {
  validation.errors.forEach(err => {
    console.error(`${err.field}: ${err.message}`);
  });
}
```

---

## Database Schema

### pr_reviews Table

Stores PR review lifecycle information.

**Columns:**
- `id` (UUID, PK): Unique review identifier
- `repo_owner` (VARCHAR): Repository owner
- `repo_name` (VARCHAR): Repository name
- `pr_number` (INTEGER): Pull request number
- `head_sha` (VARCHAR): Git commit SHA of PR head
- `status` (review_status): Current review status
- `is_ai_generated` (BOOLEAN): Whether PR is AI-generated
- `detection_confidence` (DECIMAL): Confidence score 0-1
- `detection_reasons` (TEXT[]): Reasons for AI detection
- `started_at` (TIMESTAMP): Review start time
- `completed_at` (TIMESTAMP): Review completion time
- `merge_blocked` (BOOLEAN): Whether merge is currently blocked
- `override_user` (VARCHAR): User who performed override
- `override_reason` (TEXT): Reason for override
- `override_at` (TIMESTAMP): Override timestamp
- `created_at` (TIMESTAMP): Record creation time
- `updated_at` (TIMESTAMP): Last update time

**Indexes:**
- `idx_pr_reviews_status` - Query by status
- `idx_pr_reviews_repo_pr` - Query by repo and PR number
- `idx_pr_reviews_merge_blocked` - Query blocked PRs
- `idx_pr_reviews_created_at` - Query by creation time

**Constraints:**
- `unique_pr_review` - One review per repo/PR combination

### pr_review_checks Table

Stores individual check results for each review.

**Columns:**
- `id` (UUID, PK): Unique check identifier
- `review_id` (UUID, FK): Reference to pr_reviews
- `check_name` (VARCHAR): Name of the check
- `check_type` (check_type): Type of check (lint, test, etc.)
- `status` (check_status): Current check status
- `required` (BOOLEAN): Whether check must pass
- `summary` (TEXT): Brief summary of results
- `details` (TEXT): Detailed output
- `error_count` (INTEGER): Number of errors found
- `warning_count` (INTEGER): Number of warnings found
- `duration` (INTEGER): Execution time in milliseconds
- `started_at` (TIMESTAMP): Check start time
- `completed_at` (TIMESTAMP): Check completion time
- `metadata` (JSONB): Check-specific metadata
- `created_at` (TIMESTAMP): Record creation time

**Indexes:**
- `idx_pr_review_checks_review` - Query checks for a review
- `idx_pr_review_checks_status` - Query by status
- `idx_pr_review_checks_type` - Query by check type
- `idx_pr_review_checks_required_status` - Query required checks

**Constraints:**
- `unique_review_check` - One check per review/name combination

### Enums

**review_status:**
- `pending` - Review created, not started
- `running` - Checks currently executing
- `completed` - All checks completed successfully
- `failed` - One or more checks failed
- `cancelled` - Review was cancelled

**check_status:**
- `pending` - Check created, not started
- `running` - Check currently executing
- `success` - Check passed
- `failure` - Check failed
- `skipped` - Check was skipped
- `error` - Check encountered an error

**check_type:**
- `lint` - Code linting check
- `test` - Test suite execution
- `typecheck` - Type checking (TypeScript, Flow, etc.)
- `build` - Build verification
- `security` - Security scanning
- `quality` - Code quality metrics

---

## TypeScript Type Definitions

### Core Types

```typescript
// Review record
interface PRReview {
  id: string;
  repoOwner: string;
  repoName: string;
  prNumber: number;
  headSha: string;
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

// Check record
interface PRReviewCheck {
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
  metadata: Record<string, any>;
  createdAt: Date;
}

// PR context for detection and checks
interface PRContext {
  owner: string;
  repo: string;
  prNumber: number;
  title: string;
  body: string;
  commits: Array<{
    sha: string;
    message: string;
    author: string;
  }>;
  files: string[];
  labels: string[];
  branch: string;
}

// Check result
interface CheckResult {
  status: CheckStatus;
  summary: string;
  details?: string;
  errors?: CheckError[];
  warnings?: CheckWarning[];
  duration: number;
  metadata?: Record<string, any>;
}

// Aggregated results
interface AggregatedResult {
  mergeBlocked: boolean;
  summary: string;
  passed: PRReviewCheck[];
  failed: PRReviewCheck[];
  pending: PRReviewCheck[];
  errors: PRReviewCheck[];
}

// Merge decision
interface MergeDecision {
  allowed: boolean;
  reason: string;
  checksPassed: number;
  checksFailed: number;
  checksPending: number;
}
```

---

## Error Handling

All async methods may throw errors. Common error scenarios:

1. **Review not found:** Method throws `Error` with message "Review {id} not found"
2. **Database errors:** Propagated from underlying database client
3. **GitHub API errors:** Thrown when GitHub operations fail (rate limits, permissions, etc.)
4. **Configuration errors:** Thrown by `loadConfig` when YAML is invalid
5. **Check timeout:** Check status set to 'error' with timeout message

**Example error handling:**
```typescript
try {
  const result = await service.runCheck(reviewId, checkId, check, context, workdir);
} catch (error) {
  if (error.message.includes('not found')) {
    console.error('Review does not exist');
  } else if (error.code === 'ETIMEDOUT') {
    console.error('Check timed out');
  } else {
    console.error('Unexpected error:', error);
  }
}
```

---

## Database Client Interface

The `DatabaseClient` interface defines required database operations:

```typescript
interface DatabaseClient {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
}
```

This is compatible with `pg.Pool`, `pg.Client`, and similar PostgreSQL clients.

---

## GitHub Integration

### GitHubStatusClient

Reports check results as commit statuses.

**Methods:**
- `createStatus(params: CreateStatusParams): Promise<CommitStatus>`
- `createStatusFromReview(review: PRReview, failed: boolean): Promise<CommitStatus>`

### BranchProtectionManager

Manages branch protection rules.

**Methods:**
- `ensureProtection(owner: string, repo: string, branch: string): Promise<boolean>`
- `syncProtectionAcrossBranches(owner: string, repo: string, branches: string[]): Promise<Map<string, boolean>>`

### MergeGuardian

Enforces merge eligibility rules.

**Methods:**
- `canMerge(reviewId: string): Promise<MergeDecision>`
- `evaluateAndUpdate(reviewId: string): Promise<MergeDecision>`
- `override(params: OverrideParams): Promise<MergeDecision>`
- `getCheckSummary(reviewId: string): Promise<CheckSummary>`

---

## Testing Utilities

### Test Runners

```typescript
// Run lint tools
import { runLintTools } from '@factory/pr-review';

const results = await runLintTools(
  [
    { name: 'eslint', command: 'npx eslint .', enabled: true },
    { name: 'prettier', command: 'npx prettier --check .', enabled: true }
  ],
  '/repo/path',
  60000 // timeout
);

// Run tests
import { runTests } from '@factory/pr-review';

const testResult = await runTests(
  'npm test',
  '/repo/path',
  300000 // timeout
);

console.log(`Passed: ${testResult.stats.passed}/${testResult.stats.total}`);
```

---

## See Also

- [Configuration Reference](./pr-review-configuration.md) - Complete configuration options
- [User Guide](./pr-review-user-guide.md) - End-user documentation
- [Developer Guide](./pr-review-developer-guide.md) - Extending the system
- [Architecture](./pr-review-architecture.md) - System design and integration
