# PR Review System - User Guide

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [How It Works](#how-it-works)
4. [Using the Dashboard](#using-the-dashboard)
5. [Understanding Review Results](#understanding-review-results)
6. [Manual Review Process](#manual-review-process)
7. [Emergency Overrides](#emergency-overrides)
8. [Configuration](#configuration)
9. [Troubleshooting](#troubleshooting)

---

## Introduction

The PR Review System is an automated quality control system designed specifically for AI-generated pull requests. It automatically detects PRs created by AI agents (like Ralph in the AI Software Factory), runs configured checks (linting, tests, etc.), and enforces merge blocking when checks fail.

### Key Features

- **Automatic Detection**: Identifies AI-generated PRs based on commit signatures, branch patterns, and labels
- **Automated Checks**: Runs lint, test, typecheck, and other quality checks
- **Merge Blocking**: Prevents merging PRs with failing checks
- **Dashboard UI**: Visual interface for monitoring and managing reviews
- **Manual Reviews**: Approve or reject PRs manually when needed
- **Emergency Overrides**: Allow critical hotfixes to bypass checks with audit trail
- **GitHub Integration**: Reports status directly to GitHub as commit statuses

---

## Getting Started

### Prerequisites

- PostgreSQL database (for storing review data)
- GitHub repository with pull requests
- Node.js environment for running the orchestrator

### Initial Setup

1. **Run Database Migrations**

   The PR review tables are created automatically when you run migrations:

   ```bash
   ./scripts/migrate.sh
   ```

   This creates the `pr_reviews` and `pr_review_checks` tables.

2. **Configure GitHub Token** (Optional but recommended)

   For GitHub status integration and branch protection:

   ```bash
   export GITHUB_TOKEN=ghp_your_token_here
   ```

3. **Create Configuration File**

   Create `.ai/pr-review.yml` in your repository:

   ```yaml
   # Minimal configuration - uses sensible defaults
   lint:
     enabled: true

   test:
     enabled: true
   ```

4. **Start the Orchestrator**

   The PR review system is integrated into the orchestrator:

   ```bash
   ./scripts/dev.sh
   ```

### Quick Start Example

1. Have Ralph (or another AI agent) create a PR
2. The system detects it's AI-generated (via commit co-author signature)
3. Configured checks run automatically
4. View results in the dashboard at `http://localhost:3000/pr-reviews`
5. Merge when all checks pass, or perform manual review/override if needed

---

## How It Works

### AI-Generated PR Detection

The system identifies AI-generated PRs using multiple signals:

#### 1. **Commit Co-Author Signature** (Primary)

   Checks for Claude's co-author signature in commit messages:

   ```
   Fix authentication bug

   Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
   ```

#### 2. **Branch Name Patterns**

   Detects AI-specific branch naming conventions:

   - `ai/*` - General AI branch prefix
   - `ai/issue-*` - Issue-based branches (e.g., `ai/issue-42-fix-auth`)
   - `ai/task-*` - Task-based branches (e.g., `ai/task-123-refactor`)

#### 3. **Label Patterns**

   Recognizes AI-related labels:

   - `ai-generated`
   - `automated`
   - `bot`

#### 4. **Author Patterns**

   Checks commit author names for AI patterns:

   - `claude`
   - `ai-factory`

### Detection Confidence

Each PR receives a confidence score (0-1) indicating how certain the system is that it's AI-generated:

- **0.9-1.0**: Very high confidence (multiple strong signals)
- **0.7-0.89**: High confidence (several signals)
- **0.5-0.69**: Medium confidence (some signals)
- **< 0.5**: Low confidence (not classified as AI-generated)

PRs must score ≥0.7 (configurable) to trigger the review process.

### Check Execution

When a PR is detected, the system:

1. Creates a review record in the database
2. Creates check records for each configured check (lint, test, etc.)
3. Updates the review status to "running"
4. Executes checks (usually triggered by the worker after PR creation)
5. Records results for each check
6. Aggregates results to determine merge eligibility
7. Reports status to GitHub (if configured)

### Merge Blocking

A PR is blocked from merging if:

- Any **required** check fails
- Any check is still pending (not yet completed)
- The review has not been manually approved (if configured)

A PR can be merged if:

- All **required** checks pass
- Optional checks may fail without blocking
- Or an emergency override has been applied

---

## Using the Dashboard

The dashboard provides a visual interface for monitoring and managing PR reviews.

### Accessing the Dashboard

Navigate to: `http://localhost:3000/pr-reviews` (or your dashboard URL)

### Reviews List Page

![Reviews List](../assets/pr-reviews-list.png)

The list page shows:

- **Summary Cards**: Total reviews, AI-generated count, merge blocked count
- **Status Filter**: Filter by pending, running, completed, or failed
- **Review Cards**: Each shows:
  - Repository name and PR number
  - Current status badge
  - Detection confidence
  - Merge blocked warning (if applicable)
  - Override information (if applied)
  - Link to detailed view

### Review Detail Page

Click any review to see full details:

#### Review Information
- Repository and PR number
- Status and timestamps
- Detection confidence and reasons
- Merge blocked status

#### Check Results
Each check displays:
- **Check name and type** (lint, test, etc.)
- **Status badge** (pending, running, success, failure, error)
- **Error and warning counts**
- **Execution duration**
- **Expandable details** with full output

#### Status Cards
Summary cards showing:
- ✅ Passed checks
- ❌ Failed checks
- 🚨 Errors
- ⚠️ Warnings

#### Actions
- **Emergency Override** form (for authorized users)
- **Manual Review** form (approve/reject)

---

## Understanding Review Results

### Review Statuses

| Status | Description | Next Steps |
|--------|-------------|------------|
| **Pending** | Review created, checks not started | Wait for worker to run checks |
| **Running** | Checks currently executing | Wait for completion |
| **Completed** | All checks passed | PR can be merged |
| **Failed** | One or more required checks failed | Fix issues and push new commits |
| **Cancelled** | Review was cancelled | N/A |

### Check Statuses

| Status | Icon | Description |
|--------|------|-------------|
| **Pending** | ⏳ | Check not yet started |
| **Running** | ▶️ | Check currently executing |
| **Success** | ✅ | Check passed |
| **Failure** | ❌ | Check failed |
| **Skipped** | ⏭️ | Check was skipped (disabled or not applicable) |
| **Error** | 🚨 | Check encountered an error |

### Reading Check Results

#### Lint Check Results

```
Summary: Found 5 violations across 2 files

Details:
eslint:
  src/auth.ts:42:3 - 'user' is assigned a value but never used
  src/auth.ts:58:12 - Prefer const over let

prettier:
  src/utils.ts:10:1 - Expected 2 spaces but found 4
```

**What to do:**
1. Review each violation
2. Fix the issues in your code
3. Commit and push changes
4. Checks will re-run automatically

#### Test Check Results

```
Summary: 2 tests failed out of 45 total tests (95.6% pass rate)

Details:
Failures:
  ✗ auth.test.ts: should validate expired tokens
    Expected: true
    Received: false
    at line 156

  ✗ utils.test.ts: should handle null input
    TypeError: Cannot read property 'length' of null
    at line 89
```

**What to do:**
1. Investigate failing tests
2. Fix the underlying issues or update tests
3. Commit and push changes
4. Tests will re-run

---

## Manual Review Process

Sometimes you need to manually approve or reject a PR beyond automated checks.

### When to Use Manual Review

- Automated checks pass but code quality is questionable
- Need to verify business logic or requirements
- Security concerns that automated checks miss
- Architecture decisions need human judgment

### Approving a Review

1. Navigate to the review detail page
2. Review all check results carefully
3. Click the **Manual Review** section
4. Select **Approve**
5. Add a comment explaining your approval
6. Click **Submit Review**

The review status updates to "completed" and merge blocking is lifted (if all checks also passed).

### Rejecting a Review

1. Navigate to the review detail page
2. Identify issues that need addressing
3. Click the **Manual Review** section
4. Select **Reject**
5. Add a comment explaining what needs to be fixed
6. Click **Submit Review**

The PR remains merge blocked. The developer should address your feedback and request re-review.

---

## Emergency Overrides

Emergency overrides allow authorized users to bypass failing checks for critical situations.

### When to Use Overrides

**Appropriate situations:**
- Critical production hotfix needed immediately
- Infrastructure emergency requiring rapid deployment
- Check system malfunction (false positives)

**Inappropriate situations:**
- Avoiding fixing legitimate issues
- Skipping tests because "we'll fix it later"
- Regular workflow shortcut

### Performing an Override

1. Navigate to the review detail page
2. Verify you're authorized (check configuration for allowed users)
3. Click the **Emergency Override** section
4. Enter your username
5. Provide a detailed reason (required):
   ```
   Production database outage - deploying fix for connection pool leak.
   All tests pass locally but CI is down. Validated manually.
   ```
6. Click **Override and Allow Merge**

### Override Audit Trail

All overrides are logged with:
- Username who performed override
- Timestamp
- Reason provided
- Original check results

This creates accountability and allows security teams to audit emergency actions.

### Override Limitations

- Only users listed in `mergeBlocking.overrideUsers` configuration can override
- Reason is required (if `requireOverrideReason` is enabled)
- Override does not re-run checks - it only lifts merge blocking
- Override is permanent for that review (cannot be undone)

---

## Configuration

### Configuration File Location

Create `.ai/pr-review.yml` in your repository root.

### Basic Configuration

```yaml
# Minimal working configuration
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

### Common Scenarios

#### Scenario 1: Strict Quality Control

```yaml
lint:
  enabled: true
  required: true
  failureThreshold: 0  # Zero tolerance for violations
  tools:
    - name: eslint
      command: npx eslint . --max-warnings 0
      enabled: true
    - name: prettier
      command: npx prettier --check .
      enabled: true

test:
  enabled: true
  required: true
  command: npm test
  minPassPercentage: 100  # All tests must pass

mergeBlocking:
  enabled: true
  requiredChecks: []  # All required checks must pass
  requireOverrideReason: true
```

#### Scenario 2: Lenient Development

```yaml
lint:
  enabled: true
  required: false  # Don't block merge on lint issues
  failureThreshold: 10  # Allow up to 10 violations

test:
  enabled: true
  required: true
  minPassPercentage: 90  # 90% pass rate sufficient

mergeBlocking:
  enabled: true
  overrideUsers: ['lead-dev', 'tech-lead']  # Multiple override users
```

#### Scenario 3: Custom Tools

```yaml
lint:
  enabled: true
  tools:
    - name: ruff
      command: ruff check .
      enabled: true
      include: ['**/*.py']
    - name: mypy
      command: mypy src/
      enabled: true
      include: ['src/**/*.py']

test:
  enabled: true
  command: pytest --cov=src --cov-report=term
  minPassPercentage: 100
  minCoverage: 80  # Require 80% code coverage
```

### Detection Configuration

Customize how AI-generated PRs are detected:

```yaml
detection:
  minConfidence: 0.8  # Require 80% confidence
  branchPatterns:
    - ai/*
    - ai/issue-*
    - bot/*
  labelPatterns:
    - ai-generated
    - automated
    - claude
  authorPatterns:
    - claude
    - ai-factory
    - bot
  checkCoAuthor: true
```

### Configuration Validation

The system validates your configuration on load. If invalid:

```
Error: Invalid configuration in .ai/pr-review.yml:
  - lint.failureThreshold: Must be >= 0
  - test.minPassPercentage: Must be between 0 and 100
  - lint.timeout: Must be >= 1000 (milliseconds)
```

Fix the issues and reload the configuration.

See [Configuration Reference](./pr-review-configuration.md) for complete documentation.

---

## Troubleshooting

### PR Not Detected as AI-Generated

**Symptom**: PR doesn't trigger review system

**Possible causes:**

1. **Missing co-author signature**
   - Check commit messages for Claude co-author line
   - Ensure Ralph is configured to add co-author

2. **Branch name doesn't match patterns**
   - Use `ai/` prefix in branch names
   - Or add custom pattern to configuration

3. **Low confidence score**
   - Only one weak signal detected
   - Check `detection.minConfidence` setting (default 0.7)

**Solution:**
```bash
# Check detection manually
git log --format=full

# Ensure commits have co-author
git commit --amend -m "Your message

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# Or use ai/ branch prefix
git checkout -b ai/issue-123-feature
```

### Checks Not Running

**Symptom**: Review stuck in "pending" status

**Possible causes:**

1. **Worker not running**
   - Check worker service status
   - Review worker logs for errors

2. **Checks disabled in configuration**
   - Verify `enabled: true` in config

3. **Check command not found**
   - Ensure lint/test commands exist in repository

**Solution:**
```bash
# Check worker status
docker compose ps worker

# Test check command manually
cd /path/to/repo
npm test  # Should work

# Review worker logs
docker compose logs -f worker
```

### Check Timeout

**Symptom**: Check status shows "error" with "Timeout" message

**Possible causes:**

1. **Check takes too long**
   - Default timeout is 60s (lint) or 5min (test)

2. **Hanging process**
   - Check waiting for input
   - Infinite loop in code

**Solution:**
```yaml
# Increase timeout in configuration
lint:
  timeout: 120000  # 2 minutes

test:
  timeout: 600000  # 10 minutes
```

### False Positive Violations

**Symptom**: Lint check reports issues in generated files

**Solution:**
```yaml
# Exclude generated files
lint:
  tools:
    - name: eslint
      command: npx eslint .
      enabled: true
      exclude:
        - dist/
        - build/
        - node_modules/
        - '**/*.generated.ts'
```

### GitHub Status Not Updating

**Symptom**: GitHub doesn't show commit status from PR review

**Possible causes:**

1. **Missing GitHub token**
   ```bash
   export GITHUB_TOKEN=ghp_your_token_here
   ```

2. **Insufficient permissions**
   - Token needs `repo:status` permission

3. **GitHub integration disabled**
   ```yaml
   # Enable in configuration
   github:
     syncBranchProtection: true
   ```

**Solution:**
```bash
# Test GitHub API access
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/user

# Should return your user info
```

### Merge Still Blocked After Checks Pass

**Symptom**: All checks green but PR blocked

**Possible causes:**

1. **Manual review required**
   - Configuration requires explicit approval
   - Submit manual review approval

2. **Branch protection rules**
   - GitHub branch protection requires additional checks
   - Review required reviewers setting

**Solution:**
1. Check review detail page for blockers
2. Submit manual approval if needed
3. Verify GitHub branch protection settings

### Database Connection Errors

**Symptom**: "Cannot connect to database" errors

**Solution:**
```bash
# Check database is running
docker compose ps postgres

# Test connection
docker compose exec postgres psql -U factory -c "SELECT 1"

# Check connection string
echo $DATABASE_URL
```

### Configuration Not Loading

**Symptom**: Changes to `.ai/pr-review.yml` not taking effect

**Possible causes:**

1. **YAML syntax error**
   - Invalid indentation
   - Unclosed quotes

2. **Wrong file location**
   - Must be `.ai/pr-review.yml` in repo root

**Solution:**
```bash
# Validate YAML syntax
npx js-yaml .ai/pr-review.yml

# Check file location
ls -la .ai/pr-review.yml

# Check orchestrator logs for config errors
docker compose logs orchestrator | grep -i config
```

---

## Getting Help

### Resources

- [API Documentation](./pr-review-api.md) - Developer API reference
- [Configuration Reference](./pr-review-configuration.md) - Complete config options
- [Architecture Guide](./pr-review-architecture.md) - System design details
- [Developer Guide](./pr-review-developer-guide.md) - Extending the system

### Logging

Enable debug logging for troubleshooting:

```bash
export DEBUG=pr-review:*
./scripts/dev.sh
```

### Support

- GitHub Issues: Report bugs and request features
- Logs: Check orchestrator and worker logs for errors
- Database: Query `pr_reviews` and `pr_review_checks` tables directly

---

## Best Practices

1. **Start with defaults** - Use minimal configuration initially, customize later
2. **Test configuration changes** - Validate YAML before committing
3. **Monitor review dashboard** - Regular check on blocked PRs
4. **Document overrides** - Always provide detailed reasons
5. **Iterate on thresholds** - Adjust `failureThreshold` and `minPassPercentage` based on experience
6. **Keep tools updated** - Regularly update lint and test tools
7. **Review logs** - Investigate failed checks thoroughly before overriding
8. **Use manual reviews** - Don't rely solely on automated checks for critical changes
9. **Audit overrides** - Periodically review override usage for patterns
10. **Configure branch protection** - Enable GitHub branch protection for added security
