# PR Review System - Developer Guide

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Component Deep Dive](#component-deep-dive)
3. [Creating Custom Checks](#creating-custom-checks)
4. [Adding New Lint/Test Tools](#adding-new-linttest-tools)
5. [Extending Configuration](#extending-configuration)
6. [Testing Strategies](#testing-strategies)
7. [Database Operations](#database-operations)
8. [GitHub Integration](#github-integration)
9. [Performance Considerations](#performance-considerations)
10. [Contributing Guidelines](#contributing-guidelines)

---

## Architecture Overview

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                         Worker                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Ralph executes work → Creates PR → Triggers Review  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    ReviewService                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  PRDetector  │  │ ReviewTracker│  │ Aggregator   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│         │                  │                  │              │
│         └──────────────────┴──────────────────┘              │
│                            │                                 │
│                            ▼                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Check Execution                               │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │  │
│  │  │LintCheck │  │TestCheck │  │CustomCheck│  ...     │  │
│  │  └──────────┘  └──────────┘  └──────────┘          │  │
│  └──────────────────────────────────────────────────────┘  │
│                            │                                 │
│                            ▼                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Merge Guardian                                │  │
│  │  ┌──────────────┐  ┌──────────────┐                 │  │
│  │  │GitHub Status │  │Branch Protect│                 │  │
│  │  └──────────────┘  └──────────────┘                 │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                       Database                               │
│  ┌──────────────┐  ┌──────────────────────────────────┐    │
│  │  pr_reviews  │  │  pr_review_checks                 │    │
│  └──────────────┘  └──────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Dashboard UI                              │
│  /pr-reviews (list) → /pr-reviews/:id (detail)              │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **PR Creation**: Worker creates PR via GitHub
2. **Detection**: ReviewService.detectAndCreateReview() checks if AI-generated
3. **Check Creation**: Creates check records for configured checks
4. **Execution**: Worker calls ReviewService.runCheck() for each check
5. **Aggregation**: ResultAggregator determines merge eligibility
6. **GitHub Update**: GitHubStatusClient reports status to GitHub
7. **Dashboard**: User views results and takes action if needed

### Key Design Principles

- **Composability**: Checks are independent, pluggable components
- **Extensibility**: Easy to add new check types via BaseCheck
- **Auditability**: All actions logged with timestamps and users
- **Fail-Safe**: Errors don't crash the system, they're recorded as check failures
- **Configuration-Driven**: Behavior controlled via YAML without code changes

---

## Component Deep Dive

### PRDetector

**Purpose**: Identifies AI-generated PRs based on multiple signals

**Location**: `packages/pr-review/src/detector.ts`

**Key Methods**:
- `detect(context: PRContext): DetectionResult`

**Detection Logic**:
```typescript
// Each signal contributes to confidence score
const signals = {
  coAuthor: 0.4,      // Claude co-author in commit
  branch: 0.3,        // ai/* branch pattern
  label: 0.2,         // ai-generated label
  author: 0.1         // AI author pattern
};

// Score is sum of matching signals
// isAI = true if score >= minConfidence (default 0.7)
```

**Extending Detection**:
```typescript
// Add new detection signal
export class PRDetector {
  detect(context: PRContext): DetectionResult {
    let confidence = 0;
    const reasons: string[] = [];

    // ... existing checks ...

    // Add custom signal
    if (this.checkCustomSignal(context)) {
      confidence += 0.15;
      reasons.push('Custom signal detected');
    }

    return {
      isAI: confidence >= this.minConfidence,
      confidence,
      reasons
    };
  }

  private checkCustomSignal(context: PRContext): boolean {
    // Your detection logic
    return context.title.includes('[AI]');
  }
}
```

### ReviewTracker

**Purpose**: Manages database operations for reviews and checks

**Location**: `packages/pr-review/src/tracker.ts`

**Key Methods**:
- `createReview(data: CreateReviewData): Promise<PRReview>`
- `recordCheck(data: RecordCheckData): Promise<PRReviewCheck>`
- `updateCheck(checkId: string, updates: Partial<PRReviewCheck>): Promise<PRReviewCheck>`
- `updateReviewStatus(reviewId: string, status: ReviewStatus): Promise<void>`
- `getReview(reviewId: string): Promise<{ review: PRReview; checks: PRReviewCheck[] } | null>`

**Transaction Handling**:
```typescript
// ReviewTracker uses simple queries, not transactions
// For complex operations, wrap in application-level transaction:

async function complexOperation(tracker: ReviewTracker, reviewId: string) {
  // Start application transaction
  const review = await tracker.getReview(reviewId);

  // Multiple operations
  await tracker.updateReviewStatus(reviewId, 'running');
  for (const check of review.checks) {
    await tracker.updateCheck(check.id, { status: 'pending' });
  }

  // Application ensures consistency
}
```

### ResultAggregator

**Purpose**: Combines check results to determine merge eligibility

**Location**: `packages/pr-review/src/aggregator.ts`

**Key Methods**:
- `aggregate(checks: PRReviewCheck[]): AggregatedResult`

**Aggregation Logic**:
```typescript
// Merge blocked if ANY required check is not successful
const mergeBlocked = checks.some(
  c => c.required && c.status !== 'success'
);

// Categorize checks by status
const passed = checks.filter(c => c.status === 'success');
const failed = checks.filter(c => c.status === 'failure');
const pending = checks.filter(c =>
  c.status === 'pending' || c.status === 'running'
);
const errors = checks.filter(c => c.status === 'error');
```

**Custom Aggregation**:
```typescript
// Extend ResultAggregator for custom logic
export class CustomAggregator extends ResultAggregator {
  aggregate(checks: PRReviewCheck[]): AggregatedResult {
    const base = super.aggregate(checks);

    // Add custom logic
    // e.g., warning threshold
    const totalWarnings = checks.reduce(
      (sum, c) => sum + (c.warningCount || 0), 0
    );

    if (totalWarnings > 50) {
      base.mergeBlocked = true;
      base.summary += ' (too many warnings)';
    }

    return base;
  }
}
```

### ReviewService

**Purpose**: Main orchestrator that coordinates all components

**Location**: `packages/pr-review/src/service.ts`

**Initialization**:
```typescript
const service = new ReviewService(
  db,                    // Database client
  { checks: [...] },     // Check configuration
  githubToken,           // Optional GitHub token
  dashboardUrl           // Optional dashboard URL
);
```

**Typical Usage Flow**:
```typescript
// 1. Detect and create review
const result = await service.detectAndCreateReview(context);
if (!result) {
  console.log('Not AI-generated');
  return;
}

// 2. Run checks
for (const check of result.checks) {
  const checkInstance = createCheckInstance(check.checkType);
  await service.runCheck(
    result.review.id,
    check.id,
    checkInstance,
    context,
    workdir
  );
}

// 3. Check merge eligibility
const decision = await service.canMerge(result.review.id);
console.log(`Can merge: ${decision.allowed}`);
```

---

## Creating Custom Checks

### Step 1: Extend BaseCheck

Create a new file `packages/pr-review/src/checks/my-check.ts`:

```typescript
import { BaseCheck, type CheckConfig } from './base-check.js';
import type { CheckResult, PRContext } from '@factory/shared';

interface MyCheckConfig extends CheckConfig {
  // Add custom config fields
  myOption: string;
  threshold: number;
}

export class MyCheck extends BaseCheck {
  private config: MyCheckConfig;

  constructor(config: MyCheckConfig) {
    super(config);
    this.config = config;
  }

  async run(context: PRContext, workdir: string): Promise<CheckResult> {
    const startTime = Date.now();

    try {
      // Your check logic here
      const issues = await this.performCheck(workdir);

      return {
        status: issues.length === 0 ? 'success' : 'failure',
        summary: `Found ${issues.length} issues`,
        details: issues.map(i => `- ${i.message}`).join('\n'),
        errors: issues.map(i => ({
          message: i.message,
          file: i.file,
          line: i.line,
        })),
        warnings: [],
        duration: Date.now() - startTime,
        metadata: {
          threshold: this.config.threshold,
          myOption: this.config.myOption,
        }
      };
    } catch (error) {
      return {
        status: 'error',
        summary: 'Check failed with error',
        details: error instanceof Error ? error.message : String(error),
        errors: [{ message: String(error) }],
        warnings: [],
        duration: Date.now() - startTime,
      };
    }
  }

  private async performCheck(workdir: string): Promise<Issue[]> {
    // Implement your check logic
    // e.g., run external tool, analyze files, etc.
    return [];
  }
}

interface Issue {
  message: string;
  file: string;
  line: number;
}
```

### Step 2: Add Configuration Schema

Update `packages/pr-review/src/config.ts`:

```typescript
export interface MyCheckConfig extends CheckConfig {
  myOption: string;
  threshold: number;
}

export interface PRReviewConfig {
  // ... existing config ...
  myCheck?: MyCheckConfig;
}

const DEFAULT_CONFIG: PRReviewConfig = {
  // ... existing defaults ...
  myCheck: {
    enabled: true,
    required: true,
    timeout: 60000,
    myOption: 'default',
    threshold: 10,
  },
};

export function getMyCheckConfig(repoPath: string): MyCheckConfig {
  const config = loadConfig(repoPath);
  return config.myCheck || DEFAULT_CONFIG.myCheck!;
}
```

### Step 3: Add Configuration Validation

Update `packages/pr-review/src/config-validator.ts`:

```typescript
function validateMyCheckConfig(
  config: any,
  path: string,
  errors: ValidationError[]
): void {
  if (config.threshold !== undefined) {
    if (typeof config.threshold !== 'number' || config.threshold < 0) {
      errors.push({
        field: `${path}.threshold`,
        message: 'Must be a non-negative number',
        value: config.threshold,
      });
    }
  }

  if (config.myOption !== undefined) {
    if (typeof config.myOption !== 'string') {
      errors.push({
        field: `${path}.myOption`,
        message: 'Must be a string',
        value: config.myOption,
      });
    }
  }
}

export function validateConfig(config: Partial<PRReviewConfig>): ValidationResult {
  const errors: ValidationError[] = [];

  // ... existing validation ...

  if (config.myCheck) {
    validateBaseCheckConfig(config.myCheck, 'myCheck', errors);
    validateMyCheckConfig(config.myCheck, 'myCheck', errors);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
```

### Step 4: Export from Index

Update `packages/pr-review/src/index.ts`:

```typescript
export { MyCheck } from './checks/my-check.js';
export { getMyCheckConfig, type MyCheckConfig } from './config.js';
```

### Step 5: Add Tests

Create `packages/pr-review/src/checks/my-check.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { MyCheck } from './my-check.js';

describe('MyCheck', () => {
  it('should pass when no issues found', async () => {
    const check = new MyCheck({
      enabled: true,
      required: true,
      timeout: 60000,
      myOption: 'test',
      threshold: 10,
    });

    const result = await check.run(mockContext, '/tmp/test');

    expect(result.status).toBe('success');
    expect(result.errors?.length).toBe(0);
  });

  it('should fail when issues exceed threshold', async () => {
    // ... test implementation
  });

  it('should handle errors gracefully', async () => {
    // ... test implementation
  });
});
```

### Step 6: Document in Configuration

Update `packages/pr-review/example.pr-review.yml`:

```yaml
# Custom check configuration
myCheck:
  enabled: true
  required: true
  timeout: 60000  # milliseconds
  myOption: "production"
  threshold: 5
```

---

## Adding New Lint/Test Tools

### Adding a New Lint Tool

Update the configuration to include your tool:

```yaml
lint:
  tools:
    - name: ruff
      command: ruff check . --format json
      enabled: true
      include: ['**/*.py']
      exclude: ['**/migrations/**']

    - name: mypy
      command: mypy src/ --strict
      enabled: true
      include: ['src/**/*.py']
```

The `LintRunner` automatically parses output formats:
- **JSON**: ESLint, Ruff, many modern tools
- **Text**: Prettier, older tools
- **Generic**: Pattern matching for `file:line:column` format

### Custom Output Parser

If your tool has a unique format, extend `LintRunner`:

```typescript
// packages/pr-review/src/lint-runner.ts

function parseLintOutput(tool: string, output: string): LintViolation[] {
  // Add custom parser
  if (tool === 'mytool') {
    return parseMyToolOutput(output);
  }

  // ... existing parsers ...
}

function parseMyToolOutput(output: string): LintViolation[] {
  const violations: LintViolation[] = [];

  // Parse your tool's output format
  const lines = output.split('\n');
  for (const line of lines) {
    const match = line.match(/^(\w+): (.+) at (.+):(\d+)$/);
    if (match) {
      violations.push({
        file: match[3],
        line: parseInt(match[4]),
        column: 0,
        message: match[2],
        severity: match[1] === 'ERROR' ? 'error' : 'warning',
        rule: 'unknown',
      });
    }
  }

  return violations;
}
```

### Adding a New Test Framework

The `TestRunner` supports:
- Jest (text and JSON output)
- Vitest (text and JSON output)
- Bun test
- Generic (keyword-based parsing)

To add a new framework, update `parseTestOutput`:

```typescript
// packages/pr-review/src/test-runner.ts

export function parseTestOutput(output: string): TestStats {
  // Add custom framework detection
  if (output.includes('MyFramework')) {
    return parseMyFrameworkOutput(output);
  }

  // ... existing parsers ...
}

function parseMyFrameworkOutput(output: string): TestStats {
  // Parse your framework's output
  // Look for patterns like:
  // - "X tests passed"
  // - "Y tests failed"
  // - Test failure details

  return {
    passed: 10,
    failed: 2,
    skipped: 1,
    total: 13,
    failures: [
      {
        name: 'test name',
        message: 'assertion failed',
        stack: 'stack trace...'
      }
    ]
  };
}
```

---

## Extending Configuration

### Adding a New Configuration Section

1. **Define Interface** in `config.ts`:

```typescript
export interface NewFeatureConfig {
  enabled: boolean;
  option1: string;
  option2: number;
}

export interface PRReviewConfig {
  // ... existing ...
  newFeature?: NewFeatureConfig;
}
```

2. **Add Default** in `DEFAULT_CONFIG`:

```typescript
const DEFAULT_CONFIG: PRReviewConfig = {
  // ... existing ...
  newFeature: {
    enabled: false,
    option1: 'default',
    option2: 42,
  },
};
```

3. **Add Merge Logic** in `mergeConfig`:

```typescript
function mergeConfig(defaults: PRReviewConfig, user: Partial<PRReviewConfig>): PRReviewConfig {
  const result: PRReviewConfig = { ...defaults };

  // ... existing merges ...

  if (user.newFeature) {
    result.newFeature = {
      ...defaults.newFeature!,
      ...user.newFeature,
    };
  }

  return result;
}
```

4. **Add Validation** in `config-validator.ts`:

```typescript
function validateNewFeatureConfig(
  config: any,
  path: string,
  errors: ValidationError[]
): void {
  if (config.option2 !== undefined) {
    if (typeof config.option2 !== 'number' || config.option2 < 0) {
      errors.push({
        field: `${path}.option2`,
        message: 'Must be a non-negative number',
        value: config.option2,
      });
    }
  }
}
```

5. **Add Helper Function**:

```typescript
export function getNewFeatureConfig(repoPath: string): NewFeatureConfig {
  const config = loadConfig(repoPath);
  return config.newFeature || DEFAULT_CONFIG.newFeature!;
}
```

6. **Document** in `example.pr-review.yml`:

```yaml
# New feature configuration
newFeature:
  enabled: true
  option1: "production"
  option2: 100
```

---

## Testing Strategies

### Unit Testing

Test individual components in isolation:

```typescript
// detector.test.ts
describe('PRDetector', () => {
  const detector = new PRDetector();

  it('should detect Claude co-author', () => {
    const context = {
      commits: [{
        message: 'Fix bug\n\nCo-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>'
      }],
      // ... other fields ...
    };

    const result = detector.detect(context);
    expect(result.isAI).toBe(true);
    expect(result.reasons).toContain('Claude co-author detected');
  });
});
```

### Integration Testing

Test multiple components together:

```typescript
// service.test.ts
describe('ReviewService Integration', () => {
  let db: DatabaseClient;
  let service: ReviewService;

  beforeEach(async () => {
    db = await createTestDatabase();
    service = new ReviewService(db, testConfig);
  });

  it('should create review and run checks', async () => {
    const context = createTestContext();

    // Create review
    const result = await service.detectAndCreateReview(context);
    expect(result).not.toBeNull();

    // Run a check
    const lintCheck = new LintCheck(testLintConfig);
    const updated = await service.runCheck(
      result!.review.id,
      result!.checks[0].id,
      lintCheck,
      context,
      '/tmp/test'
    );

    expect(updated.status).toBe('success');
  });
});
```

### End-to-End Testing

Test complete workflow:

```typescript
// e2e.test.ts
describe('PR Review E2E', () => {
  it('should complete full review workflow', async () => {
    // 1. Create PR (mock GitHub)
    const pr = await createTestPR();

    // 2. Detect and create review
    const review = await service.detectAndCreateReview(pr.context);

    // 3. Run all checks
    for (const check of review!.checks) {
      await runCheck(check);
    }

    // 4. Verify merge decision
    const decision = await service.canMerge(review!.review.id);
    expect(decision.allowed).toBe(true);

    // 5. Verify GitHub status updated
    const status = await getGitHubStatus(pr.sha);
    expect(status.state).toBe('success');
  });
});
```

### Mocking Database

```typescript
function createMockDatabase(): DatabaseClient {
  const storage = new Map();

  return {
    async query(sql: string, params?: any[]) {
      // Implement mock query logic
      if (sql.includes('INSERT INTO pr_reviews')) {
        const id = uuidv4();
        storage.set(id, { id, ...params });
        return { rows: [{ id }] };
      }

      if (sql.includes('SELECT * FROM pr_reviews')) {
        const review = storage.get(params[0]);
        return { rows: review ? [review] : [] };
      }

      return { rows: [] };
    }
  };
}
```

### Testing Configuration

```typescript
describe('Configuration', () => {
  it('should load and merge configuration', () => {
    const config = loadConfig('/test/repo');
    expect(config.lint?.enabled).toBe(true);
  });

  it('should validate invalid configuration', () => {
    const result = validateConfig({
      lint: {
        timeout: -1000 // Invalid!
      }
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('lint.timeout');
  });
});
```

---

## Database Operations

### Direct Queries

For custom operations, query the database directly:

```typescript
import { Pool } from 'pg';

const db = new Pool({ connectionString: process.env.DATABASE_URL });

// Get reviews for a repository
const result = await db.query(
  `SELECT * FROM pr_reviews
   WHERE repo_owner = $1 AND repo_name = $2
   ORDER BY created_at DESC`,
  ['myorg', 'myrepo']
);

const reviews = result.rows;
```

### Custom Analytics

```typescript
// Get average check duration by type
async function getAverageCheckDuration(db: DatabaseClient) {
  const result = await db.query(`
    SELECT
      check_type,
      AVG(duration) as avg_duration,
      COUNT(*) as total_checks
    FROM pr_review_checks
    WHERE duration IS NOT NULL
    GROUP BY check_type
    ORDER BY avg_duration DESC
  `);

  return result.rows;
}

// Get most common failure reasons
async function getCommonFailures(db: DatabaseClient) {
  const result = await db.query(`
    SELECT
      check_name,
      COUNT(*) as failure_count,
      AVG(error_count) as avg_errors
    FROM pr_review_checks
    WHERE status = 'failure'
    GROUP BY check_name
    ORDER BY failure_count DESC
    LIMIT 10
  `);

  return result.rows;
}
```

### Migrations

When adding new fields:

```sql
-- migrations/003_add_new_field.sql
ALTER TABLE pr_reviews
ADD COLUMN new_field VARCHAR(255);

CREATE INDEX idx_pr_reviews_new_field ON pr_reviews(new_field);
```

---

## GitHub Integration

### Status API

Report check results to GitHub:

```typescript
import { GitHubStatusClient } from '@factory/pr-review';

const client = new GitHubStatusClient(
  process.env.GITHUB_TOKEN!,
  'https://dashboard.example.com'
);

await client.createStatus({
  owner: 'myorg',
  repo: 'myrepo',
  sha: 'abc123',
  state: 'success',
  description: 'All checks passed',
  context: 'ai-factory/pr-review',
  targetUrl: 'https://dashboard.example.com/pr-reviews/uuid'
});
```

### Branch Protection

Configure branch protection rules programmatically:

```typescript
import { BranchProtectionManager } from '@factory/pr-review';

const manager = new BranchProtectionManager(process.env.GITHUB_TOKEN!);

// Ensure protection on main branch
await manager.ensureProtection('myorg', 'myrepo', 'main');

// Sync across multiple branches
await manager.syncProtectionAcrossBranches(
  'myorg',
  'myrepo',
  ['main', 'develop', 'staging']
);
```

### Webhooks (Future Enhancement)

To react to GitHub events in real-time:

```typescript
// Future: GitHub webhook handler
app.post('/webhooks/github', async (req, res) => {
  const event = req.headers['x-github-event'];
  const payload = req.body;

  if (event === 'pull_request' && payload.action === 'opened') {
    // Trigger review
    const context = extractPRContext(payload);
    const review = await service.detectAndCreateReview(context);

    if (review) {
      // Enqueue check execution
      await queueChecks(review);
    }
  }

  res.status(200).send('OK');
});
```

---

## Performance Considerations

### Database Indexing

Ensure proper indexes for common queries:

```sql
-- Query by status
CREATE INDEX idx_pr_reviews_status ON pr_reviews(status);

-- Query by repository
CREATE INDEX idx_pr_reviews_repo ON pr_reviews(repo_owner, repo_name);

-- Query blocked reviews
CREATE INDEX idx_pr_reviews_blocked ON pr_reviews(merge_blocked)
  WHERE merge_blocked = true;
```

### Check Parallelization

Run independent checks in parallel:

```typescript
// Sequential (slow)
for (const check of checks) {
  await runCheck(check);
}

// Parallel (fast)
await Promise.all(
  checks.map(check => runCheck(check))
);
```

### Caching

Cache configuration to avoid repeated file reads:

```typescript
let cachedConfig: PRReviewConfig | null = null;

export function loadConfig(repoPath: string): PRReviewConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = loadConfigFromFile(repoPath);
  return cachedConfig;
}

// Clear cache when config changes
export function clearConfigCache(): void {
  cachedConfig = null;
}
```

### Database Connection Pooling

Use connection pooling for better performance:

```typescript
import { Pool } from 'pg';

// Good: Connection pool (reuses connections)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,  // Maximum connections
  idleTimeoutMillis: 30000,
});

// Bad: New connection per query
// const client = new Client({ ... });
// await client.connect();
```

---

## Contributing Guidelines

### Code Style

- Use TypeScript strict mode
- Follow existing code structure
- Add JSDoc comments for public APIs
- Use meaningful variable names
- Keep functions focused and small

### Testing Requirements

- All new features require tests
- Maintain >90% code coverage
- Include unit tests for components
- Add integration tests for workflows
- Test error handling paths

### Pull Request Process

1. Create feature branch: `feature/my-feature`
2. Implement changes with tests
3. Run tests: `bun test`
4. Run type checking: `bun tsc --noEmit`
5. Update documentation
6. Submit PR with description

### Documentation

When adding features:
- Update API documentation
- Add configuration examples
- Update user guide if user-facing
- Add developer guide section if extending system

### Commit Messages

Follow conventional commits:

```
feat: add security check type
fix: handle timeout errors in check execution
docs: update configuration reference
test: add integration tests for merge guardian
refactor: extract common validation logic
```

---

## Additional Resources

- [API Reference](./pr-review-api.md) - Complete API documentation
- [User Guide](./pr-review-user-guide.md) - End-user documentation
- [Configuration Reference](./pr-review-configuration.md) - All configuration options
- [Architecture](./pr-review-architecture.md) - System design details

---

## Getting Help

- Review existing code in `packages/pr-review/src/`
- Check test files for usage examples
- Read inline JSDoc comments
- Refer to similar components (e.g., LintCheck for creating checks)
- Open GitHub issues for questions
