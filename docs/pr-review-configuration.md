# PR Review Configuration Guide

This guide explains how to configure the AI-generated PR review system.

## Overview

The PR review system is configured via a YAML file located at `.ai/pr-review.yml` in your repository root. All configuration is optional - the system provides sensible defaults for all settings.

## Configuration File Location

```
your-repo/
  .ai/
    pr-review.yml    # Your configuration file
```

For a complete example configuration, see `packages/pr-review/example.pr-review.yml`.

## Configuration Sections

### Detection Configuration

Controls how the system identifies AI-generated pull requests.

```yaml
detection:
  # Minimum confidence score (0-1) to classify as AI-generated
  # Higher values require stronger signals
  minConfidence: 0.7

  # Branch name patterns that indicate AI-generated PRs
  branchPatterns:
    - "ai/*"
    - "ai/issue-*"
    - "ai/task-*"

  # Label patterns that indicate AI-generated PRs
  labelPatterns:
    - "ai-generated"
    - "automated"
    - "bot"

  # Commit author patterns to detect AI (case-insensitive)
  authorPatterns:
    - "claude"
    - "ai-factory"

  # Whether to check for Claude co-author signature
  checkCoAuthor: true
```

**Fields:**
- `minConfidence`: Score threshold (0-1). Higher = stricter detection.
- `branchPatterns`: Glob patterns for AI branch names. Wildcards supported.
- `labelPatterns`: PR label text to match (substring matching).
- `authorPatterns`: Commit author patterns (case-insensitive substring).
- `checkCoAuthor`: Check for "Co-Authored-By: Claude" in commits.

### Lint Configuration

Controls linting checks that run on every commit.

```yaml
lint:
  # Whether lint checks are enabled
  enabled: true

  # Whether lint checks are required to pass for merge
  required: true

  # Maximum execution time in milliseconds
  timeout: 60000  # 60 seconds

  # Lint tools to run
  tools:
    - name: eslint
      command: "npx eslint . --format json"
      enabled: true
      # Optional: File patterns to include
      include:
        - "src/**/*.ts"
        - "packages/**/*.tsx"
      # Optional: File patterns to exclude
      exclude:
        - "**/*.test.ts"

    - name: prettier
      command: "npx prettier --check ."
      enabled: true

  # Number of violations required to fail (0 = any violation fails)
  failureThreshold: 0
```

**Fields:**
- `enabled`: Enable/disable all lint checks.
- `required`: If true, failures block merge. If false, failures are reported but don't block.
- `timeout`: Maximum execution time per tool (milliseconds).
- `tools`: Array of lint tools to run. Each tool runs independently.
- `tools[].name`: Tool identifier (for reporting).
- `tools[].command`: Command to execute.
- `tools[].enabled`: Enable/disable individual tool.
- `tools[].include`: Optional glob patterns for files to lint.
- `tools[].exclude`: Optional glob patterns for files to skip.
- `failureThreshold`: Allow N violations before failing (0 = strict).

**Supported Lint Tools:**
- ESLint (auto-detects JSON output with `--format json`)
- Prettier (text output parsing)
- Any tool that outputs `file:line:column: message` format

### Test Configuration

Controls test execution and pass/fail criteria.

```yaml
test:
  # Whether test checks are enabled
  enabled: true

  # Whether test checks are required to pass for merge
  required: true

  # Maximum execution time in milliseconds
  timeout: 300000  # 5 minutes

  # Test command to run
  command: "npm test"

  # Minimum pass percentage required (0-100)
  minPassPercentage: 100

  # Optional: Minimum code coverage percentage (0-100)
  minCoverage: 80
```

**Fields:**
- `enabled`: Enable/disable test checks.
- `required`: If true, test failures block merge.
- `timeout`: Maximum execution time (milliseconds).
- `command`: Shell command to run tests.
- `minPassPercentage`: Minimum % of tests that must pass (0-100).
- `minCoverage`: Optional minimum code coverage % (if supported by test framework).

**Supported Test Frameworks:**
The system auto-detects output from:
- Jest (text and JSON formats)
- Vitest (text and JSON formats)
- Bun test
- Generic test runners (keyword-based parsing)

### Merge Blocking Configuration

Controls when PRs are blocked from merging.

```yaml
mergeBlocking:
  # Whether to enforce merge blocking
  enabled: true

  # Names of checks that must pass before merge
  # Empty array = all required checks must pass
  requiredChecks: []

  # GitHub usernames who can perform emergency overrides
  overrideUsers:
    - "admin-user"
    - "engineering-lead"

  # Whether to require a reason when overriding
  requireOverrideReason: true
```

**Fields:**
- `enabled`: Enable/disable merge blocking. If false, checks run but don't prevent merging.
- `requiredChecks`: Specific checks that must pass. Empty = all required checks.
- `overrideUsers`: GitHub usernames allowed to override merge blocks.
- `requireOverrideReason`: Require explanation for overrides.

### Branch Protection Configuration

Controls automatic GitHub branch protection setup.

```yaml
branchProtection:
  # Whether to automatically configure branch protection
  enabled: false

  # Branch patterns to protect
  branches:
    - "main"
    - "master"
    - "develop"

  # Whether to require pull request reviews
  requirePullRequestReviews: true

  # Number of required approving reviews (0-6)
  requiredApprovingReviews: 1

  # Whether to dismiss stale reviews on push
  dismissStaleReviews: true
```

**Fields:**
- `enabled`: Enable automatic branch protection setup (requires GitHub admin token).
- `branches`: List of branches to protect.
- `requirePullRequestReviews`: Require PR reviews before merge.
- `requiredApprovingReviews`: Number of required approvals (0-6).
- `dismissStaleReviews`: Auto-dismiss approvals when new commits are pushed.

**Note:** Enabling branch protection requires a GitHub token with admin permissions on the repository.

### GitHub Integration Configuration

Controls how the system integrates with GitHub.

```yaml
github:
  # GitHub API token (can also use GITHUB_TOKEN env var)
  token: "ghp_xxxxxxxxxxxxxxxxxxxx"

  # Status context name for GitHub status checks
  statusContext: "ai-factory/pr-review"

  # Target URL for status checks (link to dashboard)
  targetUrl: "https://factory.example.com/pr-reviews"

  # Whether to automatically sync branch protection rules
  syncBranchProtection: false
```

**Fields:**
- `token`: GitHub API token. Can also be provided via `GITHUB_TOKEN` environment variable.
- `statusContext`: Name shown in PR checks list.
- `targetUrl`: URL users are directed to for detailed review info.
- `syncBranchProtection`: Auto-sync branch protection (requires `branchProtection.enabled`).

## Common Configuration Scenarios

### Strict Mode

All checks required, no tolerance for failures:

```yaml
detection:
  minConfidence: 0.9

lint:
  required: true
  failureThreshold: 0

test:
  required: true
  minPassPercentage: 100
  minCoverage: 90

mergeBlocking:
  enabled: true
  requiredChecks: []
```

### Lenient Mode

Checks run but don't block, allow some failures:

```yaml
lint:
  required: false
  failureThreshold: 10

test:
  required: false
  minPassPercentage: 95

mergeBlocking:
  enabled: false
```

### Custom Tools

Use your own linters and test runners:

```yaml
lint:
  tools:
    - name: custom-linter
      command: "./scripts/lint.sh"
      enabled: true
      include:
        - "src/**/*"

test:
  command: "make test"
  timeout: 600000
```

### High Security

Enforce branch protection and require approvals:

```yaml
detection:
  minConfidence: 0.95

branchProtection:
  enabled: true
  branches:
    - "main"
    - "production"
  requiredApprovingReviews: 2
  dismissStaleReviews: true

mergeBlocking:
  enabled: true
  overrideUsers:
    - "security-lead"
  requireOverrideReason: true
```

## Configuration Validation

The system validates your configuration on load. If validation fails:
1. Error messages show which fields are invalid
2. The system falls back to default configuration
3. Warnings are logged to help you fix the issue

Example validation error:
```
Invalid configuration in .ai/pr-review.yml:
  - lint.timeout: Must be a number >= 1000 (milliseconds)
  - test.minPassPercentage: Must be a number between 0 and 100
```

## Environment Variables

Some settings can be overridden via environment variables:

- `GITHUB_TOKEN`: GitHub API token (overrides `github.token`)

## Default Configuration

If no config file exists, these defaults are used:

```yaml
detection:
  minConfidence: 0.7
  branchPatterns: ["ai/*", "ai/issue-*", "ai/task-*"]
  labelPatterns: ["ai-generated", "automated", "bot"]
  authorPatterns: ["claude", "ai-factory"]
  checkCoAuthor: true

lint:
  enabled: true
  required: true
  timeout: 60000
  tools:
    - name: eslint
      command: "npx eslint . --format json"
      enabled: true
    - name: prettier
      command: "npx prettier --check ."
      enabled: true
  failureThreshold: 0

test:
  enabled: true
  required: true
  timeout: 300000
  command: "npm test"
  minPassPercentage: 100

mergeBlocking:
  enabled: true
  requiredChecks: []
  overrideUsers: []
  requireOverrideReason: true

branchProtection:
  enabled: false
  branches: ["main", "master", "develop"]
  requirePullRequestReviews: true
  requiredApprovingReviews: 1
  dismissStaleReviews: true

github:
  statusContext: "ai-factory/pr-review"
  syncBranchProtection: false
```

## Programmatic Configuration

You can also load and use configuration programmatically:

```typescript
import {
  loadConfig,
  getDetectionConfig,
  getLintConfig,
  getTestConfig,
  validateConfig,
} from "@factory/pr-review";

// Load complete config
const config = loadConfig("/path/to/repo");

// Load specific sections
const detectionConfig = getDetectionConfig("/path/to/repo");
const lintConfig = getLintConfig("/path/to/repo");

// Validate config before using
import { validateConfig } from "@factory/pr-review";

const result = validateConfig(userConfig);
if (!result.valid) {
  console.error("Invalid config:", result.errors);
}
```

## Best Practices

1. **Start with defaults**: Only override what you need to change.
2. **Test incrementally**: Enable one check at a time to ensure it works.
3. **Use `required: false` initially**: Run checks in advisory mode first.
4. **Monitor override usage**: Track who overrides blocks and why.
5. **Version control your config**: Track changes to review criteria over time.
6. **Document custom tools**: Add comments explaining custom lint/test commands.
7. **Set appropriate timeouts**: Balance thoroughness with developer experience.
8. **Use branch patterns**: Only protect critical branches to allow experimentation.

## Troubleshooting

### Lint checks not running
- Verify `lint.enabled` is `true`
- Check that lint tools are installed (`npx eslint --version`)
- Increase `lint.timeout` if tools are timing out
- Check tool output format matches expectations

### Test checks failing unexpectedly
- Verify test command works locally: `npm test`
- Check `test.timeout` is sufficient for your test suite
- Review test output format compatibility
- Ensure CI environment has required dependencies

### Branch protection not working
- Verify `branchProtection.enabled` is `true`
- Check GitHub token has admin permissions
- Verify branch names match `branchProtection.branches`
- Check GitHub API rate limits

### Configuration not loading
- Verify file is at `.ai/pr-review.yml` (not `.yaml`)
- Check YAML syntax: `yamllint .ai/pr-review.yml`
- Review validation errors in logs
- Ensure file is committed to repository

## API Endpoints

The orchestrator provides API endpoints for configuration management:

- `GET /api/pr-reviews/config` - Get current configuration
- `PUT /api/pr-reviews/config` - Update configuration
- `POST /api/pr-reviews/config/validate` - Validate configuration

See the dashboard UI at `/pr-reviews/config` for a user-friendly configuration editor.
