# PR Review System Integration Points

## Overview

This document details how the PR Review System integrates with existing factory components and external services.

## Integration Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        GitHub                               │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Pull Request Events                                  │  │
│  │  - opened, synchronize, reopened, closed              │  │
│  └──────────────────────────────────────────────────────┘  │
│                          │                                  │
│                          ▼                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  GitHub Actions Workflow                              │  │
│  │  (.github/workflows/pr-review.yml)                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                          │                                  │
└──────────────────────────┼──────────────────────────────────┘
                           │
                           │ Webhook / API Call
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Orchestrator                             │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  POST /api/reviews                                    │  │
│  │  Create new PR review                                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                          │                                  │
│                          ▼                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  PR Review Engine (packages/pr-review)               │  │
│  │  1. Detect AI-generated                              │  │
│  │  2. Track review state                               │  │
│  │  3. Run checks (parallel)                            │  │
│  │  4. Aggregate results                                │  │
│  │  5. Report to GitHub                                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                          │                                  │
│                          ▼                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  PostgreSQL Database                                  │  │
│  │  - pr_reviews                                         │  │
│  │  - pr_review_checks                                   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ Report Results
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    GitHub API                               │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────┐ │
│  │ Commit Status   │  │  Check Runs     │  │  Comments  │ │
│  │ API             │  │  API            │  │  API       │ │
│  └─────────────────┘  └─────────────────┘  └────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 1. GitHub Actions Integration

### Trigger Conditions

The PR review workflow is triggered by GitHub webhook events:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]
```

### Workflow Steps

1. **Checkout Code**
   - Clones the PR branch with full history
   - Ensures changed files are available for checks

2. **Detect AI Generation**
   - Runs detection logic to determine if PR is AI-generated
   - Sets output flag for conditional execution
   - Reports detection result to orchestrator

3. **Run Review (Conditional)**
   - Only runs if PR is detected as AI-generated
   - Calls orchestrator API to initiate review
   - Waits for review completion
   - Reports final status

4. **Report Results**
   - Updates GitHub commit status
   - Creates/updates check runs
   - Posts PR comment with summary

### Environment Variables

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  ORCHESTRATOR_URL: ${{ secrets.ORCHESTRATOR_URL }}
  ORCHESTRATOR_API_KEY: ${{ secrets.ORCHESTRATOR_API_KEY }}
```

### Permissions Required

```yaml
permissions:
  contents: read
  pull-requests: write
  statuses: write
  checks: write
```

## 2. Worker Integration

### Trigger Point

After PR creation in `packages/worker/src/index.ts`:

```typescript
// After createPullRequest succeeds
if (prResult.status === 'success' && prResult.prUrl) {
  const prNumber = extractPRNumber(prResult.prUrl);

  // Trigger PR review via GitHub repository_dispatch
  await triggerPRReview({
    owner: spec.repoOwner,
    repo: spec.repoName,
    prNumber,
    branch: spec.branch
  });

  log('PR review triggered for PR #' + prNumber);
}
```

### Implementation Options

#### Option A: Repository Dispatch Event (Recommended)

Worker triggers a `repository_dispatch` event to GitHub:

```typescript
async function triggerPRReview(params: TriggerPRReviewParams): Promise<void> {
  const { owner, repo, prNumber, branch } = params;

  // Use GitHub API to dispatch custom event
  await octokit.rest.repos.createDispatchEvent({
    owner,
    repo,
    event_type: 'pr-review-requested',
    client_payload: {
      pr_number: prNumber,
      branch,
      triggered_by: 'ai-factory-worker'
    }
  });
}
```

GitHub Actions listens for this event:

```yaml
on:
  repository_dispatch:
    types: [pr-review-requested]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - name: Run PR Review
        env:
          PR_NUMBER: ${{ github.event.client_payload.pr_number }}
        run: |
          bun run pr-review run --pr $PR_NUMBER
```

**Benefits**:
- Native GitHub integration
- No additional infrastructure needed
- Automatic retry via GitHub Actions
- Visible in Actions tab

#### Option B: Direct Orchestrator API Call

Worker calls orchestrator API directly:

```typescript
async function triggerPRReview(params: TriggerPRReviewParams): Promise<void> {
  const response = await fetch(`${ORCHESTRATOR_URL}/api/reviews`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ORCHESTRATOR_API_KEY}`
    },
    body: JSON.stringify({
      repoOwner: params.owner,
      repoName: params.repo,
      prNumber: params.prNumber,
      isAIGenerated: true,
      detectionConfidence: 1.0,
      detectionReasons: ['Created by AI Factory Worker']
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to trigger PR review: ${response.statusText}`);
  }
}
```

**Benefits**:
- Immediate execution
- Direct feedback
- No GitHub Actions dependency

**Drawbacks**:
- Requires orchestrator API to be accessible from worker
- No built-in retry mechanism

#### Option C: Webhook to Orchestrator

GitHub webhook sends PR events directly to orchestrator:

1. Configure webhook in GitHub repo settings
2. Orchestrator listens at `/webhooks/github`
3. Orchestrator processes PR events and triggers review

**Benefits**:
- Automatic for all PRs
- No worker changes needed
- Centralized event handling

**Drawbacks**:
- Requires publicly accessible orchestrator endpoint
- Must handle webhook signatures
- Processes ALL PRs (not just AI-generated)

### Recommended Approach

**Use Option A (Repository Dispatch)** for production:
- Best balance of features and simplicity
- Leverages existing GitHub Actions infrastructure
- Provides audit trail in Actions tab
- Automatic retry on failures

## 3. Orchestrator API Integration

### New API Endpoints

Add these endpoints to `packages/orchestrator/src/server.ts`:

#### POST /api/reviews

Create a new PR review.

```typescript
interface CreateReviewRequest {
  repoOwner: string;
  repoName: string;
  prNumber: number;
  isAIGenerated: boolean;
  detectionConfidence: number;
  detectionReasons: string[];
}

interface CreateReviewResponse {
  id: string;
  status: ReviewStatus;
}
```

#### GET /api/reviews/:id

Get review details.

```typescript
interface GetReviewResponse {
  review: PRReview;
  checks: PRReviewCheck[];
}
```

#### GET /api/reviews

List reviews with filters.

```typescript
interface ListReviewsRequest {
  repoOwner?: string;
  repoName?: string;
  status?: ReviewStatus;
  limit?: number;
  offset?: number;
}

interface ListReviewsResponse {
  reviews: PRReview[];
  total: number;
}
```

#### POST /api/reviews/:id/override

Emergency override to allow merge despite failures.

```typescript
interface OverrideReviewRequest {
  reason: string;
  user: string; // Admin who authorized override
}

interface OverrideReviewResponse {
  success: boolean;
  review: PRReview;
}
```

#### POST /api/reviews/:id/retry

Retry failed checks.

```typescript
interface RetryReviewRequest {
  checkNames?: string[]; // If omitted, retry all failed checks
}

interface RetryReviewResponse {
  success: boolean;
  retriedChecks: string[];
}
```

#### GET /api/reviews/stats

Get review statistics.

```typescript
interface ReviewStatsResponse {
  total: number;
  byStatus: Record<ReviewStatus, number>;
  successRate: number;
  avgDuration: number;
  blockedMerges: number;
  overrides: number;
}
```

### Database Access

Update `packages/orchestrator/src/db.ts` to include review queries:

```typescript
class Database {
  // Existing methods...

  // PR Review methods
  async createReview(input: CreateReviewInput): Promise<PRReview> {
    const result = await this.queryOne<PRReviewRow>(
      `INSERT INTO pr_reviews
       (repo_owner, repo_name, pr_number, is_ai_generated,
        detection_confidence, detection_reasons)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.repoOwner,
        input.repoName,
        input.prNumber,
        input.isAIGenerated,
        input.detectionConfidence,
        input.detectionReasons
      ]
    );
    return rowToPRReview(result);
  }

  async getReview(id: string): Promise<PRReview | null> {
    return this.queryOne<PRReviewRow>(
      'SELECT * FROM pr_reviews WHERE id = $1',
      [id]
    ).then(row => row ? rowToPRReview(row) : null);
  }

  async getReviewByPR(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<PRReview | null> {
    return this.queryOne<PRReviewRow>(
      `SELECT * FROM pr_reviews
       WHERE repo_owner = $1 AND repo_name = $2 AND pr_number = $3`,
      [owner, repo, prNumber]
    ).then(row => row ? rowToPRReview(row) : null);
  }

  async updateReview(id: string, updates: UpdateReviewInput): Promise<PRReview> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }
    if (updates.mergeBlocked !== undefined) {
      setClauses.push(`merge_blocked = $${paramIndex++}`);
      values.push(updates.mergeBlocked);
    }
    if (updates.completedAt !== undefined) {
      setClauses.push(`completed_at = $${paramIndex++}`);
      values.push(updates.completedAt);
    }

    values.push(id);

    const result = await this.queryOne<PRReviewRow>(
      `UPDATE pr_reviews SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );
    return rowToPRReview(result);
  }

  async createCheck(input: CreateCheckInput): Promise<PRReviewCheck> {
    const result = await this.queryOne<PRReviewCheckRow>(
      `INSERT INTO pr_review_checks
       (review_id, check_name, check_type, required)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.reviewId, input.checkName, input.checkType, input.required]
    );
    return rowToPRReviewCheck(result);
  }

  async updateCheck(id: string, updates: UpdateCheckInput): Promise<PRReviewCheck> {
    // Similar to updateReview...
  }

  async listChecks(reviewId: string): Promise<PRReviewCheck[]> {
    const rows = await this.query<PRReviewCheckRow>(
      'SELECT * FROM pr_review_checks WHERE review_id = $1 ORDER BY created_at',
      [reviewId]
    );
    return rows.map(rowToPRReviewCheck);
  }
}
```

## 4. Database Integration

### Connection to Orchestrator

The PR Review package uses the same PostgreSQL database as the orchestrator:

```typescript
import { Database } from '@factory/orchestrator';

const db = new Database(process.env.DATABASE_URL!);
```

### Data Flow

1. **Review Creation**
   - INSERT into `pr_reviews` table
   - Returns review ID

2. **Check Execution**
   - INSERT into `pr_review_checks` for each check
   - UPDATE status as checks progress
   - Store results in `details` and `metadata` fields

3. **Review Completion**
   - UPDATE `pr_reviews.status` to 'completed'
   - Set `completed_at` timestamp
   - Set `merge_blocked` based on check results

4. **Override Handling**
   - UPDATE `pr_reviews.override_user`, `override_reason`, `override_at`
   - Set `merge_blocked` to false

### Querying Review History

```sql
-- Get all reviews for a repo
SELECT * FROM pr_reviews
WHERE repo_owner = 'owner' AND repo_name = 'repo'
ORDER BY created_at DESC;

-- Get failed checks for a review
SELECT * FROM pr_review_checks
WHERE review_id = 'review-uuid'
  AND status = 'failure'
  AND required = true;

-- Get reviews with blocked merges
SELECT r.*, COUNT(c.id) as failed_checks
FROM pr_reviews r
LEFT JOIN pr_review_checks c ON c.review_id = r.id AND c.status = 'failure'
WHERE r.merge_blocked = true
GROUP BY r.id
ORDER BY r.created_at DESC;

-- Get override statistics
SELECT
  override_user,
  COUNT(*) as override_count,
  array_agg(DISTINCT override_reason) as reasons
FROM pr_reviews
WHERE override_user IS NOT NULL
GROUP BY override_user;
```

## 5. Dashboard Integration

### New Dashboard Pages

Add to `packages/dashboard/app/`:

#### /reviews - Reviews List Page

```typescript
// app/reviews/page.tsx
export default async function ReviewsPage() {
  const reviews = await fetch('/api/reviews').then(r => r.json());

  return (
    <div>
      <h1>PR Reviews</h1>
      <DataTable
        data={reviews}
        columns={[
          { key: 'prNumber', label: 'PR #' },
          { key: 'repoName', label: 'Repository' },
          { key: 'status', label: 'Status' },
          { key: 'mergeBlocked', label: 'Blocked', type: 'boolean' },
          { key: 'createdAt', label: 'Created', type: 'date' }
        ]}
      />
    </div>
  );
}
```

#### /reviews/[id] - Review Details Page

```typescript
// app/reviews/[id]/page.tsx
export default async function ReviewDetailPage({ params }: { params: { id: string } }) {
  const { review, checks } = await fetch(`/api/reviews/${params.id}`)
    .then(r => r.json());

  return (
    <div>
      <h1>PR Review #{review.prNumber}</h1>
      <ReviewSummary review={review} />
      <CheckResults checks={checks} />
      {review.mergeBlocked && (
        <OverrideButton reviewId={review.id} />
      )}
    </div>
  );
}
```

#### /reviews/stats - Review Statistics Page

```typescript
// app/reviews/stats/page.tsx
export default async function ReviewStatsPage() {
  const stats = await fetch('/api/reviews/stats').then(r => r.json());

  return (
    <div>
      <h1>Review Statistics</h1>
      <StatsGrid>
        <StatCard title="Total Reviews" value={stats.total} />
        <StatCard title="Success Rate" value={`${stats.successRate}%`} />
        <StatCard title="Blocked Merges" value={stats.blockedMerges} />
        <StatCard title="Overrides" value={stats.overrides} />
      </StatsGrid>
      <ChartComponent data={stats.byStatus} />
    </div>
  );
}
```

### Navigation Updates

Add to `packages/dashboard/components/Navigation.tsx`:

```typescript
const navItems = [
  { href: '/', label: 'Overview' },
  { href: '/workers', label: 'Workers' },
  { href: '/queue', label: 'Queue' },
  { href: '/reviews', label: 'Reviews' }, // NEW
  { href: '/learnings', label: 'Learnings' },
  { href: '/metrics', label: 'Metrics' }
];
```

### API Proxy Configuration

Update `packages/dashboard/next.config.js`:

```javascript
module.exports = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.ORCHESTRATOR_URL}/api/:path*`
      }
    ];
  }
};
```

## 6. GitHub API Integration

### Authentication

Use GitHub App installation token for best security:

```typescript
import { App } from '@octokit/app';

const app = new App({
  appId: process.env.GITHUB_APP_ID!,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY!
});

const octokit = await app.getInstallationOctokit(installationId);
```

### Commit Status API

Report overall pass/fail status:

```typescript
await octokit.rest.repos.createCommitStatus({
  owner,
  repo,
  sha: commitSha,
  state: result.overallStatus === 'pass' ? 'success' : 'failure',
  context: 'ai-factory/pr-review',
  description: result.summary,
  target_url: `${DASHBOARD_URL}/reviews/${reviewId}`
});
```

### Checks API

Create detailed check run with annotations:

```typescript
const checkRun = await octokit.rest.checks.create({
  owner,
  repo,
  name: 'AI Factory PR Review',
  head_sha: commitSha,
  status: 'in_progress'
});

// After checks complete
await octokit.rest.checks.update({
  owner,
  repo,
  check_run_id: checkRun.data.id,
  status: 'completed',
  conclusion: result.overallStatus === 'pass' ? 'success' : 'failure',
  output: {
    title: result.summary,
    summary: formatSummary(result),
    annotations: formatAnnotations(result.checkResults)
  }
});
```

### PR Comments API

Post summary comment:

```typescript
await octokit.rest.issues.createComment({
  owner,
  repo,
  issue_number: prNumber,
  body: formatPRComment(result)
});
```

Comment format:

```markdown
## AI Factory PR Review Results

**Overall Status**: ✅ Pass / ❌ Fail

### Checks Summary
- ✅ Lint: Passed
- ✅ Tests: Passed (15/15)
- ❌ Type Check: Failed (3 errors)

### Details
**Type Check Failures:**
- `src/foo.ts:42` - Type 'string' is not assignable to type 'number'
- `src/bar.ts:15` - Property 'baz' does not exist on type 'Foo'

[View Full Results](https://factory.example.com/reviews/abc123)
```

## 7. Branch Protection Integration

### Required Status Checks

Configure in repository settings:

```yaml
# .github/branch-protection.yml
branch_protection:
  required_status_checks:
    strict: true
    contexts:
      - 'ai-factory/pr-review'
  required_pull_request_reviews:
    required_approving_review_count: 0  # Automated review only
  enforce_admins: true
  restrictions: null
```

### GitHub API Configuration

Set via GitHub API:

```typescript
await octokit.rest.repos.updateBranchProtection({
  owner,
  repo,
  branch: 'main',
  required_status_checks: {
    strict: true,
    contexts: ['ai-factory/pr-review']
  },
  enforce_admins: true,
  required_pull_request_reviews: null,
  restrictions: null
});
```

## 8. Configuration Management

### Repository Configuration

Each repository can override defaults with `.ai/pr-review.yml`:

```yaml
version: 1

detection:
  confidence_threshold: 0.9

checks:
  - name: lint
    type: lint
    required: true
  - name: test
    type: test
    required: true
    config:
      min_coverage: 90

merge_protection:
  allow_override: true
  override_roles: [admin]

reporting:
  github_status: true
  github_checks: true
  pr_comment: true
```

### Loading Configuration

```typescript
async function loadConfig(repoPath: string): Promise<PRReviewConfig> {
  const configPath = path.join(repoPath, '.ai', 'pr-review.yml');

  if (await fs.pathExists(configPath)) {
    const content = await fs.readFile(configPath, 'utf-8');
    return yaml.parse(content);
  }

  // Return default config
  return getDefaultConfig();
}
```

## 9. Error Handling and Retries

### Transient Failures

Retry on network errors, rate limits:

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      if (!isRetryable(error)) throw error;
      await sleep(delayMs * Math.pow(2, i));
    }
  }
  throw new Error('Unreachable');
}
```

### Check Execution Errors

Distinguish between check failure and execution error:

```typescript
try {
  const result = await runCheck(check, context);
  return result; // status: 'success' | 'failure'
} catch (error) {
  return {
    status: 'error' as const,
    summary: 'Check execution failed',
    details: error.message,
    errors: [],
    warnings: [],
    duration: 0,
    metadata: { error: String(error) }
  };
}
```

### GitHub API Rate Limits

Handle rate limit errors:

```typescript
try {
  await octokit.rest.repos.createCommitStatus(/*...*/);
} catch (error) {
  if (error.status === 403 && error.response?.headers['x-ratelimit-remaining'] === '0') {
    const resetTime = error.response.headers['x-ratelimit-reset'];
    log('Rate limited, waiting until', new Date(resetTime * 1000));
    await waitUntil(resetTime * 1000);
    // Retry
  }
}
```

## 10. Monitoring and Observability

### Metrics to Track

```typescript
interface ReviewMetrics {
  // Volume
  reviewsCreated: number;
  checksExecuted: number;

  // Success rates
  reviewSuccessRate: number;
  checkSuccessRate: number;

  // Performance
  avgReviewDuration: number;
  avgCheckDuration: number;
  p95ReviewDuration: number;

  // Issues
  blockedMerges: number;
  overridesUsed: number;
  checkErrors: number;

  // By check type
  checkSuccessRateByType: Record<CheckType, number>;
  avgCheckDurationByType: Record<CheckType, number>;
}
```

### Logging Format

Use structured logging:

```typescript
log({
  level: 'info',
  component: 'pr-review',
  action: 'review_started',
  reviewId: 'abc123',
  repoOwner: 'owner',
  repoName: 'repo',
  prNumber: 42,
  timestamp: new Date().toISOString()
});
```

### Alerting Rules

Set up alerts for:
- Review failure rate > 50% for 1 hour
- Check execution errors > 10 in 5 minutes
- Review duration > 15 minutes
- Override rate > 20% of reviews

## Summary

The PR Review System integrates with:

1. **GitHub Actions**: Workflow execution environment
2. **Worker**: Triggers review after PR creation
3. **Orchestrator**: API endpoints and core logic
4. **Database**: Persistent state storage
5. **Dashboard**: UI for monitoring and overrides
6. **GitHub API**: Status reporting and comments

The recommended integration approach uses:
- Repository dispatch events for triggering
- GitHub Actions for check execution
- Orchestrator API for state management
- GitHub Status/Checks API for reporting
- Branch protection for enforcement
