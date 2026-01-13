# Plan: Build Lint Integration

## Goal
Implement lint checking integration for the PR review system, including configurable lint rules, result reporting, and blocking mechanisms.

## Context
Phases 1 and 2 are complete:
- Phase 1: PR review system architecture designed
- Phase 2: Core PR review functionality implemented (detector, tracker, aggregator, service)

Now we need to implement lint integration (Phase 3):
1. Set up pre-commit lint hooks
2. Configure lint rules and standards
3. Implement lint result reporting
4. Add lint failure blocking mechanism

## Approach

### 1. Define Base Check Interface
Create abstraction for all check types:
- `BaseCheck` abstract class with standard interface
- `run()`: Execute the check
- `getName()`: Return check name
- `isRequired()`: Check if required or optional
- `timeout`: Maximum execution time

### 2. Implement LintRunner
Low-level lint execution:
- Support ESLint, Prettier, Biome
- Execute lint commands via child_process
- Parse lint output (JSON for ESLint, text for others)
- Handle timeouts and errors
- Return structured violations

### 3. Implement LintCheck
High-level check orchestration:
- Extends BaseCheck
- Uses LintRunner to execute lints
- Converts violations to CheckResult
- Configurable via pr-review.yml
- Supports multiple lint tools
- Respects failureThreshold

### 4. Configuration System
Load configuration from `.ai/pr-review.yml`:
```yaml
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
  failureThreshold: 0  # 0 = any violation fails
```

### 5. Result Reporting
Map lint violations to CheckResult:
- status: "success" | "failure" | "error"
- summary: Human-readable message
- details: Full violation list with file/line/rule
- startedAt, completedAt timestamps
- Store in pr_review_checks table via ReviewTracker

### 6. Blocking Mechanism
- LintCheck returns failure if violations >= threshold
- ResultAggregator uses failure to block merge (already implemented)
- Override mechanism available (already implemented)

## Files to Create

### Core Implementation
- `packages/pr-review/src/checks/base-check.ts` - Base interface
- `packages/pr-review/src/checks/lint-check.ts` - LintCheck implementation
- `packages/pr-review/src/checks/index.ts` - Export all checks
- `packages/pr-review/src/lint-runner.ts` - Execute lint tools
- `packages/pr-review/src/config.ts` - Load pr-review.yml

### Configuration
- `.ai/pr-review.example.yml` - Example configuration

### Tests
- `packages/pr-review/tests/base-check.test.ts` - Base class tests
- `packages/pr-review/tests/lint-runner.test.ts` - Lint execution tests
- `packages/pr-review/tests/lint-check.test.ts` - LintCheck tests
- `packages/pr-review/tests/config.test.ts` - Config loading tests

## Files to Modify
- `packages/pr-review/src/service.ts` - Integrate LintCheck
- `packages/pr-review/package.json` - Add yaml parser, lint tools as devDeps

## Implementation Steps

1. **Base Check Interface** (30 min)
   - Define abstract class
   - Document interface contract
   - Add CheckResult type to shared if needed

2. **Configuration Loader** (30 min)
   - Install yaml parser
   - Implement loadConfig()
   - Default config if file missing
   - Validate config schema

3. **LintRunner** (1 hour)
   - Implement ESLint JSON parsing
   - Implement Prettier text parsing
   - Add timeout handling
   - Error handling for missing tools

4. **LintCheck** (1 hour)
   - Extend BaseCheck
   - Load configuration
   - Use LintRunner
   - Format results
   - Handle disabled state

5. **Integration** (30 min)
   - Add LintCheck to ReviewService
   - Wire up configuration
   - Test end-to-end flow

6. **Testing** (1.5 hours)
   - Mock child_process.spawn
   - Test all lint tools
   - Test error cases
   - Test configuration loading

## Exit Criteria
- [ ] BaseCheck abstract class defined
- [ ] Configuration loads from .ai/pr-review.yml
- [ ] LintRunner executes ESLint and Prettier
- [ ] LintCheck implements BaseCheck interface
- [ ] Violations reported in structured format
- [ ] Merge blocked when violations >= threshold
- [ ] 25+ unit tests passing
- [ ] Package builds with `bun run build`
- [ ] Types compile with no errors

## Notes
- Don't actually run lint tools in tests; mock the execution
- Use child_process.spawn with timeout support
- ESLint provides JSON output; Prettier outputs text
- Consider Biome as future enhancement
- Autofix capability out of scope for now
