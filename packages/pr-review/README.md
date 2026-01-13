# @factory/pr-review

Automated PR review system for AI-generated pull requests, with lint checks, test execution, and merge blocking.

## Features

- 🤖 **AI Detection**: Automatically identifies AI-generated PRs
- ✅ **Automated Checks**: Runs lint, tests, and custom quality checks
- 🚫 **Merge Blocking**: Prevents merging PRs with failing checks
- 📊 **Dashboard Integration**: Visual interface for review management
- 🔧 **Configurable**: YAML-based configuration for all aspects
- 🔌 **Extensible**: Easy to add custom check types
- 📝 **Audit Trail**: Tracks all decisions and overrides
- 🎯 **GitHub Integration**: Reports status via GitHub API

## Installation

```bash
bun install @factory/pr-review
```

## Quick Start

### 1. Create Configuration

Create `.ai/pr-review.yml` in your repository:

```yaml
lint:
  enabled: true
  tools:
    - name: eslint
      command: npx eslint .
      enabled: true

test:
  enabled: true
  command: npm test
  minPassPercentage: 100
```

### 2. Initialize Service

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
  process.env.GITHUB_TOKEN,  // Optional: for GitHub integration
  'https://factory.example.com/pr-reviews'  // Optional: dashboard URL
);
```

### 3. Use in Your Workflow

```typescript
import { LintCheck, TestCheck, getLintConfig, getTestConfig } from '@factory/pr-review';

// Detect AI-generated PR and create review
const result = await service.detectAndCreateReview({
  owner: 'myorg',
  repo: 'myrepo',
  prNumber: 123,
  title: 'Fix authentication bug',
  body: 'PR description...',
  commits: [
    {
      sha: 'abc123',
      message: 'Fix bug\n\nCo-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>',
      author: 'developer'
    }
  ],
  files: ['src/auth.ts'],
  labels: [],
  branch: 'ai/issue-42-fix-auth'
});

if (!result) {
  console.log('Not an AI-generated PR');
  return;
}

// Run lint check
const lintConfig = getLintConfig('/path/to/repo');
const lintCheck = new LintCheck(lintConfig);
await service.runCheck(
  result.review.id,
  result.checks[0].id,
  lintCheck,
  context,
  '/path/to/repo'
);

// Run test check
const testConfig = getTestConfig('/path/to/repo');
const testCheck = new TestCheck(testConfig);
await service.runCheck(
  result.review.id,
  result.checks[1].id,
  testCheck,
  context,
  '/path/to/repo'
);

// Check merge eligibility
const decision = await service.canMerge(result.review.id);
console.log(`Can merge: ${decision.allowed}`);
console.log(`Reason: ${decision.reason}`);
```

## Core Components

### ReviewService

Main orchestrator for the PR review system.

```typescript
const service = new ReviewService(db, config, githubToken?, dashboardUrl?);

// Detect and create review
const review = await service.detectAndCreateReview(context);

// Run a check
await service.runCheck(reviewId, checkId, checkInstance, context, workdir);

// Check merge eligibility
const decision = await service.canMerge(reviewId);

// Emergency override
await service.emergencyOverride(reviewId, user, reason);
```

### PRDetector

Identifies AI-generated PRs based on commit signatures, branch patterns, and labels.

```typescript
import { PRDetector } from '@factory/pr-review';

const detector = new PRDetector();
const result = detector.detect(context);

console.log(`Is AI: ${result.isAI}`);
console.log(`Confidence: ${result.confidence}`);
console.log(`Reasons: ${result.reasons.join(', ')}`);
```

### Check Types

Built-in checks for common quality gates:

```typescript
import { LintCheck, TestCheck, getLintConfig, getTestConfig } from '@factory/pr-review';

// Lint check
const lintCheck = new LintCheck(getLintConfig('/repo'));
const lintResult = await lintCheck.run(context, '/repo');

// Test check
const testCheck = new TestCheck(getTestConfig('/repo'));
const testResult = await testCheck.run(context, '/repo');
```

### Configuration

Load and validate configuration:

```typescript
import { loadConfig, validateConfig } from '@factory/pr-review';

// Load configuration
const config = loadConfig('/path/to/repo');

// Validate user config
const validation = validateConfig(userConfig);
if (!validation.valid) {
  console.error('Invalid configuration:', validation.errors);
}

// Get specific config sections
import { getLintConfig, getTestConfig, getDetectionConfig } from '@factory/pr-review';

const lintConfig = getLintConfig('/repo');
const testConfig = getTestConfig('/repo');
const detectionConfig = getDetectionConfig('/repo');
```

## Configuration Reference

### Basic Configuration

```yaml
# Detection settings
detection:
  minConfidence: 0.7
  branchPatterns: ['ai/*', 'ai/issue-*']
  checkCoAuthor: true

# Lint checks
lint:
  enabled: true
  required: true
  timeout: 60000
  failureThreshold: 0
  tools:
    - name: eslint
      command: npx eslint . --format json
      enabled: true
    - name: prettier
      command: npx prettier --check .
      enabled: true

# Test checks
test:
  enabled: true
  required: true
  timeout: 300000
  command: npm test
  minPassPercentage: 100

# Merge blocking
mergeBlocking:
  enabled: true
  requiredChecks: []
  overrideUsers: ['lead-dev']
  requireOverrideReason: true

# GitHub integration
github:
  statusContext: ai-factory/pr-review
  syncBranchProtection: false
```

See [Configuration Reference](../../docs/pr-review-configuration.md) for complete options.

## Creating Custom Checks

Extend `BaseCheck` to create custom checks:

```typescript
import { BaseCheck, type CheckConfig } from '@factory/pr-review';
import type { CheckResult, PRContext } from '@factory/shared';

interface CustomCheckConfig extends CheckConfig {
  customOption: string;
}

export class CustomCheck extends BaseCheck {
  private config: CustomCheckConfig;

  constructor(config: CustomCheckConfig) {
    super(config);
    this.config = config;
  }

  async run(context: PRContext, workdir: string): Promise<CheckResult> {
    const startTime = Date.now();

    // Your check logic here
    const passed = await this.performCheck(workdir);

    return {
      status: passed ? 'success' : 'failure',
      summary: passed ? 'Check passed' : 'Check failed',
      details: 'Detailed output...',
      errors: passed ? [] : [{ message: 'Error details' }],
      warnings: [],
      duration: Date.now() - startTime,
    };
  }

  private async performCheck(workdir: string): Promise<boolean> {
    // Implement your check
    return true;
  }
}
```

## API Reference

See [API Documentation](../../docs/pr-review-api.md) for complete API reference.

### Key Methods

#### ReviewService

- `detectAndCreateReview(context: PRContext)` - Detect AI PR and create review
- `runCheck(reviewId, checkId, check, context, workdir)` - Run a check
- `getReviewStatus(reviewId)` - Get review status with aggregated results
- `canMerge(reviewId)` - Check if PR can be merged
- `emergencyOverride(reviewId, user, reason)` - Override for critical hotfixes
- `listReviews(filters?)` - List all reviews with optional filters

#### Configuration

- `loadConfig(repoPath)` - Load configuration from `.ai/pr-review.yml`
- `validateConfig(config)` - Validate configuration object
- `getLintConfig(repoPath)` - Get lint configuration
- `getTestConfig(repoPath)` - Get test configuration
- `getDetectionConfig(repoPath)` - Get detection configuration

## Database Schema

The system requires two PostgreSQL tables:

### pr_reviews

Stores PR review lifecycle information.

```sql
CREATE TABLE pr_reviews (
  id UUID PRIMARY KEY,
  repo_owner VARCHAR(255),
  repo_name VARCHAR(255),
  pr_number INTEGER,
  head_sha VARCHAR(40),
  status review_status,  -- pending, running, completed, failed, cancelled
  is_ai_generated BOOLEAN,
  detection_confidence DECIMAL(3,2),
  detection_reasons TEXT[],
  merge_blocked BOOLEAN,
  override_user VARCHAR(255),
  override_reason TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### pr_review_checks

Stores individual check results.

```sql
CREATE TABLE pr_review_checks (
  id UUID PRIMARY KEY,
  review_id UUID REFERENCES pr_reviews(id),
  check_name VARCHAR(100),
  check_type check_type,  -- lint, test, typecheck, build, security, quality
  status check_status,  -- pending, running, success, failure, skipped, error
  required BOOLEAN,
  summary TEXT,
  details TEXT,
  error_count INTEGER,
  warning_count INTEGER,
  duration INTEGER,
  metadata JSONB,
  created_at TIMESTAMP
);
```

## TypeScript Types

All types are exported from the package:

```typescript
import type {
  PRReview,
  PRReviewCheck,
  ReviewStatus,
  CheckStatus,
  CheckType,
  CheckResult,
  PRContext,
  DetectionResult,
  AggregatedResult,
  MergeDecision,
  PRReviewConfig,
  LintConfig,
  TestConfig,
} from '@factory/pr-review';
```

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
});
```

### Branch Protection

Ensure AI factory review is required:

```typescript
import { BranchProtectionManager } from '@factory/pr-review';

const manager = new BranchProtectionManager(process.env.GITHUB_TOKEN!);
await manager.ensureProtection('myorg', 'myrepo', 'main');
```

## Testing

Run tests:

```bash
bun test
```

Run with coverage:

```bash
bun test --coverage
```

Type check:

```bash
bun tsc --noEmit
```

## Documentation

- [API Reference](../../docs/pr-review-api.md) - Complete API documentation
- [User Guide](../../docs/pr-review-user-guide.md) - End-user documentation
- [Developer Guide](../../docs/pr-review-developer-guide.md) - Extending the system
- [Configuration Reference](../../docs/pr-review-configuration.md) - All configuration options
- [Architecture](../../docs/pr-review-architecture.md) - System design and integration

## Examples

### Basic Usage

```typescript
import { ReviewService, LintCheck, TestCheck } from '@factory/pr-review';

// Create service
const service = new ReviewService(db, config);

// Detect and create review
const review = await service.detectAndCreateReview(prContext);

// Run checks
if (review) {
  await service.runCheck(review.review.id, checkId, new LintCheck(lintConfig), prContext, workdir);
  await service.runCheck(review.review.id, checkId, new TestCheck(testConfig), prContext, workdir);
}
```

### Custom Check

```typescript
import { BaseCheck } from '@factory/pr-review';

class SecurityCheck extends BaseCheck {
  async run(context, workdir) {
    // Run security scan
    const vulnerabilities = await scanForVulnerabilities(workdir);

    return {
      status: vulnerabilities.length === 0 ? 'success' : 'failure',
      summary: `Found ${vulnerabilities.length} vulnerabilities`,
      errors: vulnerabilities.map(v => ({ message: v.description })),
      duration: 1000,
    };
  }
}
```

### Emergency Override

```typescript
// Critical production hotfix
const decision = await service.emergencyOverride(
  reviewId,
  'ops-lead',
  'P0 production outage - database connection fix required immediately'
);

console.log(`Override allowed: ${decision.allowed}`);
```

## License

MIT

## Support

- GitHub Issues: Report bugs and request features
- Documentation: See `docs/` directory for detailed guides
- Examples: Check `examples/` directory for usage patterns
