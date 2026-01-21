# Verify Skill

AI-driven verification for Whim work items. Runs tests and validates PR changes.

## Usage

```
/verify [--pr <number>] [--comment]
```

## Arguments

- `--pr <number>`: PR number to verify (required for --comment)
- `--comment`: Post results as a PR comment via `gh pr comment`

## Workflow

1. **Read Configuration**
   - Load `.whim/config.yml` from repo root
   - Determine project type (web, api, cli, library, monorepo)
   - Check which verification types are enabled (browser, unit, api)

2. **Analyze Changes**
   - Run `git diff main...HEAD` to understand what changed
   - Identify affected packages in monorepos
   - Determine which tests are relevant

3. **Run Unit Tests**
   - If `verification.unit: true` (default)
   - Execute test command based on project setup (vitest, jest, bun test)
   - Capture pass/fail counts and error output

4. **Run Browser Tests** (web projects)
   - If `verification.browser: true` and project type is `web`
   - Use agent-browser for AI-driven browser testing
   - Navigate the app, verify UI changes work correctly
   - No brittle selectors - AI interprets the page semantically

5. **Run API Tests** (api projects)
   - If `verification.api: true` and project type is `api`
   - Test API endpoints affected by changes
   - Verify request/response contracts

6. **Report Results**
   - Output structured summary:
     ```
     [VERIFY:RESULT] {"passed": true, "tests": {"unit": {"run": 10, "passed": 10}, "browser": {"run": 3, "passed": 3}}}
     ```
   - If `--comment` flag: post summary to PR via `gh pr comment --pr <N>`

## Configuration

The skill reads `.whim/config.yml`:

```yaml
type: web  # web | api | cli | library | monorepo

verification:
  enabled: true
  browser: true   # Run browser tests (web projects)
  unit: true      # Run unit tests
  api: false      # Run API tests (api projects)
```

### Monorepo Configuration

```yaml
type: monorepo

packages:
  - path: apps/web
    type: web
    verification:
      browser: true
      unit: true
  - path: apps/api
    type: api
    verification:
      api: true
      unit: true
```

## Output Format

The skill outputs a structured result for the worker to parse:

```
[VERIFY:RESULT] {"passed": boolean, "summary": "string", "tests": {...}}
```

### Success Example
```
[VERIFY:RESULT] {"passed": true, "summary": "All 15 tests passed", "tests": {"unit": {"run": 12, "passed": 12}, "browser": {"run": 3, "passed": 3}}}
```

### Failure Example
```
[VERIFY:RESULT] {"passed": false, "summary": "2 unit tests failed", "tests": {"unit": {"run": 12, "passed": 10, "failed": 2, "errors": ["test_auth: expected 200, got 401"]}}}
```

## Exit Codes

- `0`: All tests passed
- `1`: One or more tests failed
- `2`: Configuration error or missing dependencies

## Requirements

- Claude Code with ANTHROPIC_API_KEY
- GitHub CLI (`gh`) for --comment flag
- Test framework installed (vitest, jest, or bun test)
- For browser tests: agent-browser or playwright

## Notes

- This skill is AI-driven: it interprets test requirements intelligently rather than following brittle scripts
- Browser tests use semantic understanding of the page, not CSS selectors
- The skill adapts to different project structures and test frameworks
- For monorepos, only affected packages are tested based on git diff analysis
