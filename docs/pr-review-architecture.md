# PR Review System Architecture

## Overview

The PR Review System is a composable, automated code review framework specifically designed for AI-generated pull requests in the AI Software Factory. It ensures code quality through automated checks (linting, testing, code quality analysis) while blocking merges when failures occur.

## Goals

1. **Automated Quality Assurance**: Run comprehensive checks on every AI-generated PR
2. **Merge Protection**: Block merging when checks fail
3. **Composability**: Allow flexible configuration of checks and rules
4. **Clear Feedback**: Provide actionable insights to developers
5. **Auditability**: Maintain complete history of review decisions
6. **Emergency Override**: Support critical hotfix scenarios

## Architecture Principles

- **Separation of Concerns**: Distinct modules for detection, checking, reporting, and blocking
- **Plugin Architecture**: Easy to add new check types without modifying core
- **Configuration-Driven**: YAML-based rules and check selection
- **Stateless Checks**: Each check is independent and idempotent
- **GitHub-Native**: Leverage GitHub Actions, Status API, and Checks API

## System Components

### 1. PR Detector

**Purpose**: Identify AI-generated PRs that should go through automated review.

**Detection Methods**:
- **Commit Co-Author**: Check for "Co-Authored-By: Claude Sonnet 4.5" in commit messages
- **Branch Pattern**: Match branch names (e.g., `ai/issue-*`, `ai/*`)
- **Labels**: Detect labels applied by intake service (e.g., `ai-generated`)
- **PR Description**: Parse metadata markers in PR body

**Output**: Boolean flag indicating AI-generated status + confidence score

**Interface**:
```typescript
interface PRDetector {
  isAIGenerated(context: PRContext): Promise<DetectionResult>;
}

interface DetectionResult {
  isAI: boolean;
  confidence: number; // 0-1
  reasons: string[]; // Why it was detected as AI
  metadata: Record<string, any>;
}

interface PRContext {
  owner: string;
  repo: string;
  prNumber: number;
  commits: Commit[];
  branch: string;
  labels: string[];
  description: string;
}
```

### 2. Check Framework

**Purpose**: Provide a pluggable system for running different types of checks.

**Base Check Interface**:
```typescript
interface Check {
  name: string;
  description: string;
  required: boolean; // If true, must pass for merge

  run(context: CheckContext): Promise<CheckResult>;
}

interface CheckContext {
  repo: {
    owner: string;
    name: string;
    path: string; // Local path to cloned repo
  };
  pr: {
    number: number;
    branch: string;
    baseBranch: string;
    changedFiles: string[];
  };
  config: Record<string, any>; // Check-specific config
}

interface CheckResult {
  status: 'success' | 'failure' | 'skipped' | 'error';
  summary: string;
  details: string;
  errors?: CheckError[];
  warnings?: CheckWarning[];
  duration: number; // milliseconds
  metadata: Record<string, any>;
}

interface CheckError {
  file?: string;
  line?: number;
  column?: number;
  message: string;
  rule?: string;
  severity: 'error';
}

interface CheckWarning {
  file?: string;
  line?: number;
  column?: number;
  message: string;
  rule?: string;
  severity: 'warning';
}
```

**Built-in Checks**:

1. **Lint Check**
   - Runs configured linters (ESLint, Prettier, etc.)
   - Supports multiple file types
   - Reports violations with file/line/column

2. **Test Check**
   - Executes test suite (Jest, Vitest, Bun test)
   - Reports test counts and failures
   - Captures test output

3. **Type Check**
   - Runs TypeScript compiler
   - Reports type errors with locations

4. **Build Check**
   - Attempts to build the project
   - Verifies no build errors

5. **Security Check** (Future)
   - Scans for vulnerabilities
   - Checks dependency security

6. **Code Quality Check** (Future)
   - Complexity analysis
   - Code smell detection
   - Coverage requirements

### 3. Review Tracker

**Purpose**: Track review state throughout the PR lifecycle.

**State Machine**:
```
pending → running → [completed | failed | cancelled]
```

**Database Schema**:
```sql
CREATE TABLE pr_reviews (
  id UUID PRIMARY KEY,
  repo_owner VARCHAR(255) NOT NULL,
  repo_name VARCHAR(255) NOT NULL,
  pr_number INTEGER NOT NULL,
  status review_status NOT NULL, -- pending, running, completed, failed, cancelled
  is_ai_generated BOOLEAN NOT NULL,
  detection_confidence DECIMAL(3,2),
  detection_reasons TEXT[],
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  merge_blocked BOOLEAN DEFAULT false,
  override_user VARCHAR(255), -- Who approved emergency override
  override_reason TEXT,
  override_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(repo_owner, repo_name, pr_number)
);

CREATE TYPE review_status AS ENUM (
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled'
);

CREATE TABLE pr_review_checks (
  id UUID PRIMARY KEY,
  review_id UUID NOT NULL REFERENCES pr_reviews(id) ON DELETE CASCADE,
  check_name VARCHAR(100) NOT NULL,
  check_type VARCHAR(50) NOT NULL, -- lint, test, build, etc.
  status check_status NOT NULL,
  required BOOLEAN NOT NULL DEFAULT false,
  summary TEXT,
  details TEXT,
  error_count INTEGER DEFAULT 0,
  warning_count INTEGER DEFAULT 0,
  duration INTEGER, -- milliseconds
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(review_id, check_name)
);

CREATE TYPE check_status AS ENUM (
  'pending',
  'running',
  'success',
  'failure',
  'skipped',
  'error'
);

CREATE INDEX idx_pr_reviews_status ON pr_reviews(status);
CREATE INDEX idx_pr_reviews_repo_pr ON pr_reviews(repo_owner, repo_name, pr_number);
CREATE INDEX idx_pr_review_checks_review ON pr_review_checks(review_id);
CREATE INDEX idx_pr_review_checks_status ON pr_review_checks(status);
```

**Interface**:
```typescript
interface ReviewTracker {
  create(review: CreateReviewInput): Promise<PRReview>;
  update(reviewId: string, updates: UpdateReviewInput): Promise<PRReview>;
  addCheck(reviewId: string, check: CreateCheckInput): Promise<PRReviewCheck>;
  updateCheck(checkId: string, updates: UpdateCheckInput): Promise<PRReviewCheck>;
  get(reviewId: string): Promise<PRReview>;
  getByPR(owner: string, repo: string, prNumber: number): Promise<PRReview | null>;
  listChecks(reviewId: string): Promise<PRReviewCheck[]>;
}
```

### 4. Result Aggregator

**Purpose**: Combine check results and determine overall PR status.

**Logic**:
- All **required** checks must pass (status = 'success')
- Optional checks can fail without blocking
- If any required check fails → merge blocked
- Warnings don't block merge but are reported
- Errors in check execution → treated as failures

**Interface**:
```typescript
interface ResultAggregator {
  aggregate(checks: CheckResult[]): AggregatedResult;
}

interface AggregatedResult {
  overallStatus: 'pass' | 'fail' | 'error';
  mergeBlocked: boolean;
  passedChecks: number;
  failedChecks: number;
  skippedChecks: number;
  totalErrors: number;
  totalWarnings: number;
  summary: string;
  checkResults: CheckResultSummary[];
}

interface CheckResultSummary {
  name: string;
  status: CheckResult['status'];
  required: boolean;
  errorCount: number;
  warningCount: number;
}
```

### 5. GitHub Reporter

**Purpose**: Report check results back to GitHub using Status API and Checks API.

**Reporting Methods**:

1. **GitHub Status API** (Commit Status)
   - Simple pass/fail indicator
   - Shows in PR UI
   - Blocks merge via branch protection

2. **GitHub Checks API** (Check Runs)
   - Detailed check results
   - Annotations for errors/warnings
   - Expandable details section

3. **PR Comments**
   - Summary comment with all check results
   - File-specific comments for lint errors
   - Update on re-runs

**Interface**:
```typescript
interface GitHubReporter {
  reportStatus(context: PRContext, result: AggregatedResult): Promise<void>;
  reportCheck(context: PRContext, check: CheckResult): Promise<void>;
  commentSummary(context: PRContext, result: AggregatedResult): Promise<void>;
  commentError(context: PRContext, error: CheckError): Promise<void>;
}
```

### 6. Configuration System

**Purpose**: Allow flexible configuration of checks and rules per repository.

**Configuration File** (`.ai/pr-review.yml`):
```yaml
version: 1

# Detection rules
detection:
  methods:
    - commit-coauthor
    - branch-pattern
    - label
  branch_patterns:
    - 'ai/**'
    - 'ai/*'
  required_labels:
    - 'ai-generated'
  confidence_threshold: 0.8

# Checks to run
checks:
  - name: lint
    type: lint
    required: true
    config:
      tools:
        - eslint
        - prettier
      ignore_warnings: false

  - name: test
    type: test
    required: true
    config:
      command: 'bun test'
      timeout: 300000 # 5 minutes
      min_coverage: 80

  - name: typecheck
    type: typecheck
    required: true
    config:
      strict: true

  - name: build
    type: build
    required: false
    config:
      command: 'bun run build'
      timeout: 300000

# Merge blocking rules
merge_protection:
  require_all_checks: false # Only required checks must pass
  allow_override: true
  override_roles:
    - admin
    - maintainer

# Reporting preferences
reporting:
  github_status: true
  github_checks: true
  pr_comment: true
  file_comments: true # For lint errors

# Performance
performance:
  parallel_checks: true
  max_parallel: 3
  global_timeout: 600000 # 10 minutes
```

**Interface**:
```typescript
interface ConfigLoader {
  load(repoPath: string): Promise<PRReviewConfig>;
  validate(config: PRReviewConfig): ValidationResult;
}

interface PRReviewConfig {
  version: number;
  detection: DetectionConfig;
  checks: CheckConfig[];
  mergeProtection: MergeProtectionConfig;
  reporting: ReportingConfig;
  performance: PerformanceConfig;
}
```

## Integration Points

### 1. GitHub Actions Workflow

**Trigger**: On pull request events (opened, synchronize, reopened)

**Workflow** (`.github/workflows/pr-review.yml`):
```yaml
name: PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  detect:
    name: Detect AI-generated PR
    runs-on: ubuntu-latest
    outputs:
      is_ai: ${{ steps.detect.outputs.is_ai }}
    steps:
      - uses: actions/checkout@v4
      - name: Detect AI PR
        id: detect
        run: |
          # Run detection logic
          bun run pr-review detect

  review:
    name: Run PR Review
    runs-on: ubuntu-latest
    needs: detect
    if: needs.detect.outputs.is_ai == 'true'
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup
        run: bun install

      - name: Run Review
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          bun run pr-review run --pr ${{ github.event.pull_request.number }}
```

### 2. Worker Integration

**Trigger Point**: After PR creation in `packages/worker/src/index.ts`

**Flow**:
```typescript
// In worker after createPullRequest succeeds
if (prResult.status === 'success' && prResult.prUrl) {
  // Trigger PR review
  await triggerPRReview({
    owner,
    repo,
    prNumber: extractPRNumber(prResult.prUrl),
    branch: spec.branch
  });
}
```

**Implementation Options**:

A. **Webhook Trigger** (Recommended)
   - Worker creates PR
   - GitHub webhook fires to orchestrator
   - Orchestrator delegates to PR review system

B. **Direct API Call**
   - Worker calls orchestrator API
   - Orchestrator queues review job
   - GitHub Actions picks up review

C. **GitHub Dispatch Event**
   - Worker triggers repository_dispatch event
   - GitHub Actions workflow starts
   - Runs review directly

### 3. Database Integration

**Orchestrator Changes**:
- Add review tracking to work item status
- Store review results alongside metrics
- Query review history for dashboards

**Schema Updates** (new migration):
```sql
-- Already defined above in Review Tracker section
-- Add foreign key to work_items table
ALTER TABLE work_items
ADD COLUMN pr_review_id UUID REFERENCES pr_reviews(id);
```

### 4. Dashboard Integration

**New Pages**:
- `/reviews` - List all PR reviews
- `/reviews/:id` - Review details with check results
- `/reviews/stats` - Review success rates, common failures

**API Endpoints**:
- `GET /api/reviews` - List reviews with filters
- `GET /api/reviews/:id` - Get review details
- `GET /api/reviews/:id/checks` - Get check results
- `POST /api/reviews/:id/override` - Emergency override

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        GitHub                               │
│  ┌──────────┐  PR Created   ┌──────────────────┐          │
│  │   Repo   │──────────────▶│  Webhook / GHA   │          │
│  └──────────┘               └──────────────────┘          │
│                                      │                      │
└──────────────────────────────────────┼──────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Orchestrator                             │
│  ┌────────────────┐      ┌────────────────┐               │
│  │  Review API    │◀────▶│  PR Review DB  │               │
│  │   Endpoints    │      │   (Postgres)   │               │
│  └────────────────┘      └────────────────┘               │
│         │                                                   │
│         ▼                                                   │
│  ┌────────────────────────────────────────┐               │
│  │       PR Review Engine                 │               │
│  │  ┌──────────┐  ┌──────────┐           │               │
│  │  │ Detector │  │ Tracker  │           │               │
│  │  └──────────┘  └──────────┘           │               │
│  │  ┌──────────────────────────────┐     │               │
│  │  │  Check Runner (Parallel)      │     │               │
│  │  │  ├─ Lint   ├─ Test  ├─ Build │     │               │
│  │  └──────────────────────────────┘     │               │
│  │  ┌──────────┐  ┌──────────┐           │               │
│  │  │Aggregator│  │ Reporter │           │               │
│  │  └──────────┘  └──────────┘           │               │
│  └────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│               GitHub API (Report Results)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Status API   │  │  Checks API  │  │  Comments   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

## Security Considerations

1. **Token Management**
   - Use GitHub App installation tokens
   - Scope tokens to minimum required permissions
   - Rotate tokens regularly

2. **Code Execution Safety**
   - Run checks in isolated containers
   - Limit resource usage (CPU, memory, timeout)
   - Prevent malicious code execution

3. **Override Controls**
   - Require admin approval for overrides
   - Log all override decisions
   - Require override reason

4. **Audit Trail**
   - Log all review decisions
   - Track who triggered reviews
   - Record check results permanently

## Performance Considerations

1. **Parallel Execution**
   - Run independent checks in parallel
   - Configurable parallelism level
   - Fail fast on required check failures

2. **Caching**
   - Cache lint results for unchanged files
   - Reuse build artifacts when possible
   - Cache dependencies

3. **Resource Limits**
   - Global timeout (default 10 minutes)
   - Per-check timeout (default 5 minutes)
   - Memory limits for check execution

4. **Incremental Checks**
   - Only check changed files for lint
   - Run affected tests only (when possible)
   - Skip checks for draft PRs (optional)

## Error Handling

1. **Check Failures**
   - Distinguish between check failure and execution error
   - Retry transient errors (network, API rate limits)
   - Fail gracefully with clear error messages

2. **Configuration Errors**
   - Validate config on load
   - Provide default config if missing
   - Log config validation errors

3. **API Failures**
   - Retry GitHub API calls with backoff
   - Fall back to PR comments if Status API fails
   - Log all API errors

4. **Timeout Handling**
   - Kill stuck checks after timeout
   - Report timeout as check failure
   - Allow manual retry

## Monitoring and Observability

1. **Metrics**
   - Review success/failure rates
   - Check execution times
   - Most common failure reasons
   - Override frequency

2. **Logging**
   - Structured logs with correlation IDs
   - Log all check executions
   - Log API calls to GitHub

3. **Alerting**
   - Alert on high failure rates
   - Alert on repeated check timeouts
   - Alert on override abuse

4. **Dashboard Widgets**
   - PR review queue status
   - Recent review results
   - Check health metrics

## Future Enhancements

1. **Smart Checks**
   - AI-powered code review suggestions
   - Automatic fix suggestions
   - Context-aware checks based on changed files

2. **Advanced Blocking**
   - Graduated blocking based on severity
   - Time-based auto-merge for low-risk changes
   - Risk scoring for PRs

3. **Integration Expansion**
   - SonarQube integration
   - CodeClimate integration
   - Snyk security scanning
   - Performance regression detection

4. **Review Workflows**
   - Multi-stage reviews (auto → manual → merge)
   - Conditional checks based on file patterns
   - Different rules for different branches

5. **Learning and Adaptation**
   - Learn from override patterns
   - Adjust check sensitivity
   - Suggest config improvements

## Migration Plan

1. **Phase 1: Core Framework** (Current iteration)
   - Build detector, tracker, aggregator
   - Implement basic checks (lint, test)
   - Set up database schema

2. **Phase 2: GitHub Integration**
   - Build reporters
   - Set up GitHub Actions workflows
   - Configure branch protection

3. **Phase 3: Worker Integration**
   - Trigger reviews from worker
   - Track review status in orchestrator
   - Update dashboard

4. **Phase 4: Production Hardening**
   - Add monitoring and alerting
   - Performance optimization
   - Security audit

5. **Phase 5: Advanced Features**
   - Additional check types
   - Smart suggestions
   - External integrations

## Success Criteria

- [ ] 100% of AI-generated PRs detected correctly
- [ ] All checks complete within 10 minutes (95th percentile)
- [ ] Zero false negatives (no bad code merged)
- [ ] < 5% false positives (no good code blocked)
- [ ] Clear, actionable feedback on all failures
- [ ] Emergency override works within 1 minute
- [ ] Full audit trail for compliance
- [ ] Dashboard shows real-time review status
