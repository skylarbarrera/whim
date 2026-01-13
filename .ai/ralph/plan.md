# Iteration 1: Build Testing Integration

## Goal
Implement test integration for the PR review system, following the same composable pattern established with the lint integration. This includes test runner infrastructure, test check implementation, configuration support, and blocking mechanism integration.

## Files to Create/Modify
- `packages/pr-review/src/checks/test-runner.ts` - Test execution infrastructure
- `packages/pr-review/src/checks/test-check.ts` - TestCheck class extending BaseCheck
- `packages/pr-review/src/config.ts` - Add test configuration types and defaults
- `packages/pr-review/example.pr-review.yml` - Update with test configuration examples
- `packages/pr-review/tests/test-runner.test.ts` - Unit tests for test runner
- `packages/pr-review/tests/test-check.test.ts` - Unit tests for TestCheck
- `packages/pr-review/tests/config.test.ts` - Update with test config tests
- `packages/pr-review/src/index.ts` - Export TestCheck

## Implementation Steps

1. **Create TestRunner** (similar to LintRunner)
   - Support multiple test frameworks (Jest, Vitest, Bun test, npm test)
   - Parse test output for all supported frameworks
   - Extract test counts (passed, failed, skipped)
   - Collect failure details (test names, error messages, stack traces)
   - Handle timeouts gracefully
   - Return structured TestRunResult

2. **Create TestCheck** (extending BaseCheck)
   - Configure test commands via YAML
   - Execute tests using TestRunner
   - Aggregate results from multiple test commands
   - Generate human-readable summaries
   - Store results via ReviewTracker
   - Support failure thresholds (e.g., allow skipped tests)

3. **Update Configuration System**
   - Add TestConfig interface
   - Add test command configuration
   - Add timeout and threshold settings
   - Update example YAML with test section
   - Deep merge test config with defaults

4. **Integration with ReviewService**
   - TestCheck is already composable via runCheck() method
   - No changes needed to service - design is composable

5. **Add Comprehensive Tests**
   - TestRunner: parsing for each framework, timeout handling
   - TestCheck: success/failure scenarios, threshold logic
   - Config: test configuration loading and merging

## Test Strategy
- Unit tests for TestRunner with mocked child_process
- Unit tests for TestCheck with mocked TestRunner
- Test all supported test framework output formats
- Verify configuration loading and merging
- Verify failure blocking mechanism via ResultAggregator

## Exit Criteria
- [ ] TestRunner created and handles Jest, Vitest, Bun test, npm test
- [ ] TestCheck extends BaseCheck and integrates with ReviewTracker
- [ ] Configuration system supports test commands and settings
- [ ] Example YAML updated with test configuration
- [ ] 20+ unit tests added covering all scenarios
- [ ] All tests pass with `bun test`
- [ ] Package builds successfully with `bun run build`
- [ ] All 4 sub-bullets in SPEC.md completed

## Integration Points
- Uses BaseCheck (already exists)
- Uses ReviewTracker (already exists)
- Uses ResultAggregator (already exists, handles blocking)
- Uses ConfigLoader (already exists)
- Follows exact same pattern as LintCheck

## Technical Notes
- Reuse patterns from existing LintRunner and LintCheck
- Test output parsing needs to handle different formats
- Jest: JSON reporter, TAP format, or default format
- Vitest: JSON reporter or default format
- Bun test: Default format
- npm test: Delegates to package.json test script
- Timeout should be longer for tests (default 5 minutes vs 2 minutes for lint)
