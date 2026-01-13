# Task 3: Build Core Review Orchestrator

## Goal
Implement the core review orchestrator that executes review steps sequentially or in parallel, aggregates results, and integrates with GitHub PR status checks.

## Files to Create/Modify

### New Files
1. `packages/review-system/src/orchestrator/executor.ts` - ReviewExecutor class
   - Sequential and parallel step execution
   - Step group coordination
   - Error handling and recovery

2. `packages/review-system/src/orchestrator/aggregator.ts` - ResultAggregator class
   - Collect results from multiple steps
   - Determine overall review status
   - Group results by file/type

3. `packages/review-system/src/orchestrator/github-status.ts` - GitHubStatusReporter class
   - Post status checks to GitHub
   - Update check runs with results
   - Create check annotations for findings

4. `packages/review-system/src/orchestrator/orchestrator.ts` - ReviewOrchestrator class
   - Main orchestration logic
   - Load configuration
   - Execute workflow
   - Report results

5. `packages/review-system/src/orchestrator/index.ts` - Module exports

### Test Files
6. `packages/review-system/src/__tests__/executor.test.ts` - Executor tests
7. `packages/review-system/src/__tests__/aggregator.test.ts` - Aggregator tests
8. `packages/review-system/src/__tests__/github-status.test.ts` - GitHub integration tests
9. `packages/review-system/src/__tests__/orchestrator.test.ts` - Orchestrator tests

### Modified Files
10. `packages/review-system/src/index.ts` - Export orchestrator module

## Implementation Details

### ReviewExecutor
- executeSequential(steps, context): Execute steps one by one
- executeParallel(steps, context): Execute steps concurrently
- executeGroup(group, context): Execute step group based on mode
- evaluateCondition(condition, context): Check if step should run
- Handle step timeouts
- Stop on blocking step failure (configurable)

### ResultAggregator
- addResult(stepType, result): Add step result
- getOverallStatus(): Pass if all pass, fail if any fail
- getBlockingFailures(): List blocking failures
- groupByFile(): Group messages by file path
- groupBySeverity(): Group by error/warning/info
- getSummary(): Return aggregated summary

### GitHubStatusReporter
- createCheckRun(pr, workflow): Create GitHub check run
- updateCheckRun(runId, status, results): Update with results
- createAnnotations(results): Convert messages to annotations
- postCommitStatus(sha, status): Post commit status (legacy)
- Handle API rate limiting
- Graceful error handling

### ReviewOrchestrator
- loadConfig(path): Load workflow configuration
- runReview(pr, config): Execute complete review workflow
- buildContext(pr): Build ReviewContext from PR info
- executeWorkflow(workflow, context): Run all step groups
- reportResults(pr, results): Post to GitHub + return summary
- Integration point with AI detection

## Tests
- Sequential execution order
- Parallel execution concurrency
- Conditional step execution
- Result aggregation logic
- GitHub API integration (mocked)
- Error handling and recovery
- Timeout handling
- Blocking vs non-blocking steps

## Exit Criteria
- All orchestrator classes implemented
- Sequential and parallel execution working
- Results properly aggregated
- GitHub status checks posting correctly
- At least 30 tests passing
- Package builds successfully
- All type checks pass

## Notes
- Use Promise.all() for parallel execution
- Use Promise.allSettled() to handle partial failures
- GitHub Check Runs API preferred over commit status
- Support both organization and repository configs
- Log all step executions for debugging
