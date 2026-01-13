# Plan: Implement Lint Validation Hook

## Goal
Create a lint validation review step that checks code quality using ESLint, Prettier, and other linting tools. This step should run as part of the review system, provide actionable error reports, and support multiple linters.

## Files to Create/Modify

### New Files
1. `packages/review-system/src/steps/lint-step.ts`
   - LintStep class implementing ReviewStep interface
   - Support for ESLint, Prettier, and generic linters
   - Parse lint output and convert to ReviewMessages
   - Configure severity mapping (error/warning)

2. `packages/review-system/src/steps/index.ts`
   - Export LintStep and other step implementations

3. `packages/review-system/src/__tests__/lint-step.test.ts`
   - Test lint detection and reporting
   - Test ESLint output parsing
   - Test Prettier output parsing
   - Test file filtering and patterns
   - Test error handling

### Existing Files to Modify
1. `packages/review-system/package.json`
   - Add dev dependencies: eslint, prettier (for testing)

2. `packages/review-system/src/index.ts`
   - Export steps module

## Implementation Steps

1. **Create LintStep class**
   - Implement ReviewStep interface (initialize, execute, cleanup, validateConfig)
   - Support multiple linters: eslint, prettier, custom commands
   - Run linters on changed files only (filter by context.changedFiles)
   - Parse stdout/stderr from linter commands
   - Convert lint errors/warnings to ReviewMessages with file/line/severity
   - Include fix suggestions when available

2. **ESLint integration**
   - Run: `eslint --format json [files]`
   - Parse JSON output format
   - Extract: filePath, line, column, message, severity, ruleId
   - Map severity: 2=error, 1=warning, 0=info

3. **Prettier integration**
   - Run: `prettier --check [files]`
   - Parse output for unparsed files
   - Generate "needs formatting" messages
   - Support --write for auto-fix

4. **Configuration**
   - linters: Array of linter configs (type, command, args, filePatterns)
   - autoFix: boolean (run fix commands like eslint --fix)
   - failOn: "error" | "warning" (minimum severity to fail step)
   - timeout: number (per-linter timeout)

5. **Result formatting**
   - Group errors by file
   - Include line numbers and columns
   - Add actionable suggestions (e.g., "Run: eslint --fix src/foo.ts")
   - Count total errors/warnings

6. **Testing**
   - Mock file system with test files
   - Mock linter command execution
   - Test ESLint JSON parsing with real examples
   - Test Prettier output parsing
   - Test file filtering (only run on changed files)
   - Test severity mapping
   - Test timeout handling
   - Test error cases (linter not found, invalid config)

## Tests to Write

1. **Basic lint detection**
   - Detect ESLint errors in files
   - Detect Prettier formatting issues
   - Pass when no issues found

2. **Output parsing**
   - Parse ESLint JSON format correctly
   - Parse Prettier output correctly
   - Handle empty output

3. **File filtering**
   - Only lint changed files from context
   - Apply file patterns (*.ts, *.js, etc.)
   - Skip excluded patterns

4. **Severity handling**
   - Map ESLint severity correctly
   - Fail on errors by default
   - Continue on warnings

5. **Configuration validation**
   - Reject invalid linter types
   - Reject invalid failOn values
   - Require command for custom linters

6. **Error handling**
   - Handle missing linter binaries
   - Handle invalid JSON output
   - Handle linter crashes
   - Handle timeouts

## Exit Criteria

- [ ] LintStep class implements all ReviewStep interface methods
- [ ] ESLint integration works with JSON output parsing
- [ ] Prettier integration detects formatting issues
- [ ] Only changed files are linted (respects context.changedFiles)
- [ ] Lint errors/warnings converted to ReviewMessages with correct severity
- [ ] Configuration validates linter setup
- [ ] At least 20 tests covering all scenarios
- [ ] Package builds successfully with no type errors
- [ ] Tests pass with `bun test`
