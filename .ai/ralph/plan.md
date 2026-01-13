# Plan: Implement Automated Testing Hook

## Goal
Create a test execution review step that runs unit tests, integration tests, and validates test coverage as part of the PR review system. This step should provide detailed test failure reports and coverage information.

## Files to Create/Modify

### New Files
1. `packages/review-system/src/steps/test-step.ts`
   - TestStep class implementing ReviewStep interface
   - Support for multiple test runners (Jest, Vitest, Bun, Mocha, custom)
   - Parse test output and convert to ReviewMessages
   - Test coverage validation
   - Test suite execution with timeout handling

2. `packages/review-system/src/__tests__/test-step.test.ts`
   - Test execution scenarios
   - Test output parsing for different runners
   - Test coverage validation
   - Error handling
   - Timeout scenarios

### Existing Files to Modify
1. `packages/review-system/src/steps/index.ts`
   - Export TestStep class

2. `packages/review-system/package.json`
   - Add dev dependencies for testing (if needed)

## Implementation Steps

1. **Create TestStep class**
   - Implement ReviewStep interface (initialize, execute, cleanup, validateConfig)
   - Support multiple test runners: jest, vitest, bun, mocha, custom
   - Run tests on commit-level (all affected tests)
   - Parse stdout/stderr from test commands
   - Convert test failures to ReviewMessages with file/line/test name
   - Include stack traces and error details
   - Track test counts: run, passed, failed, skipped

2. **Test runner integration**
   - Jest: `npm test -- --json` or `jest --json`
   - Vitest: `vitest run --reporter=json`
   - Bun: `bun test --reporter json`
   - Mocha: `mocha --reporter json`
   - Custom: configurable command with output parser

3. **Output parsing**
   - Parse JSON output from test runners
   - Extract: test name, file path, line number, error message, stack trace
   - Handle different JSON formats per runner
   - Fallback to text parsing if JSON unavailable

4. **Coverage validation**
   - Run with coverage flags (--coverage)
   - Parse coverage reports (lcov, json-summary)
   - Check against thresholds: lines, functions, branches, statements
   - Generate coverage messages if below threshold
   - Support coverage config from project (jest.config, vitest.config)

5. **Configuration**
   - runner: "jest" | "vitest" | "bun" | "mocha" | "custom"
   - command: string (custom command override)
   - args: string[] (additional arguments)
   - testScript: string (package.json script name, default: "test")
   - coverage: boolean (enable coverage checking)
   - coverageThresholds: { lines, functions, branches, statements }
   - timeout: number (test suite timeout in ms)
   - failOn: "error" | "failure" (fail on test errors only or any failure)

6. **Result formatting**
   - Group failures by test file
   - Include test names and error messages
   - Add stack traces for debugging
   - Show test counts: X passed, Y failed, Z total
   - Coverage summary: X% lines, Y% branches, etc.
   - Actionable suggestions (e.g., "Fix failing test: should validate input")

7. **Testing**
   - Mock test command execution
   - Test Jest output parsing
   - Test Vitest output parsing
   - Test Bun output parsing
   - Test coverage threshold validation
   - Test timeout handling
   - Test error scenarios (test runner not found, invalid config)

## Tests to Write

1. **Basic test execution**
   - Detect test failures
   - Pass when all tests pass
   - Count test results correctly

2. **Output parsing**
   - Parse Jest JSON format correctly
   - Parse Vitest JSON format correctly
   - Parse Bun output correctly
   - Handle text output as fallback

3. **Test failure reporting**
   - Extract test name and file
   - Include error messages
   - Include stack traces
   - Format as ReviewMessages

4. **Coverage validation**
   - Parse coverage reports
   - Check against thresholds
   - Generate coverage warnings
   - Pass when coverage meets thresholds

5. **Configuration validation**
   - Reject invalid runner types
   - Reject invalid failOn values
   - Validate coverage thresholds

6. **Error handling**
   - Handle missing test runner
   - Handle invalid JSON output
   - Handle test suite crashes
   - Handle timeouts

7. **Test runner detection**
   - Auto-detect runner from package.json
   - Use configured test script
   - Fallback to npm test

## Exit Criteria

- [ ] TestStep class implements all ReviewStep interface methods
- [ ] Support for Jest, Vitest, Bun test runners
- [ ] Test failures converted to ReviewMessages with file/line/test name
- [ ] Test coverage validation with configurable thresholds
- [ ] Detailed test failure reports with stack traces
- [ ] Configuration validates test setup
- [ ] At least 20 tests covering all scenarios
- [ ] Package builds successfully with no type errors
- [ ] Tests pass with `bun test`
