# Plan: Design PR Review System Architecture

## Goal
Design a composable PR review system specifically for AI-generated pull requests, including automated lint and testing hooks that block merging on failure.

## Context
The AI Software Factory automatically generates code changes through Ralph instances. We need a review system that:
1. Detects AI-generated PRs
2. Runs automated checks (lint, tests)
3. Blocks merging on failures
4. Provides clear feedback
5. Is composable and configurable

## Approach

### 1. PR Detection Strategy
AI-generated PRs can be identified by:
- Commit messages containing "Co-Authored-By: Claude Sonnet 4.5"
- Branch name patterns (e.g., `ai/issue-*`)
- Labels applied by the intake service
- Metadata in PR description

### 2. Review Workflow
```
GitHub Issue → Intake → Orchestrator → Worker (Ralph) → PR Created
                                                            ↓
                                              PR Review System Triggered
                                                            ↓
                                    [Detect AI-generated] → Apply label
                                                            ↓
                                         [Run automated checks]
                                    ┌─────────────┬────────────┐
                                    ↓             ↓            ↓
                                 Lint         Tests      Code Quality
                                    ↓             ↓            ↓
                                [Collect results and report]
                                    ↓
                    [Block merge if failures] OR [Allow merge if pass]
```

### 3. Composable Architecture
Use a modular design with:
- **Core**: PR detection, status tracking, result aggregation
- **Checks**: Pluggable check modules (lint, test, quality)
- **Reporters**: Feedback mechanisms (GitHub status, comments)
- **Config**: YAML-based rules and check selection

### 4. Integration Points
- **GitHub Actions**: Main execution environment
- **GitHub Status API**: Report check results
- **GitHub Checks API**: Create detailed check runs
- **Worker**: Post-PR creation hook to trigger review
- **Orchestrator**: Track review status in database

## Files to Create/Modify

### New Package: `packages/pr-review`
- `package.json` - Package config
- `tsconfig.json` - TypeScript config
- `src/detector.ts` - AI PR detection logic
- `src/tracker.ts` - Review status tracking
- `src/aggregator.ts` - Result aggregation
- `src/checks/base.ts` - Base check interface
- `src/checks/lint.ts` - Lint check implementation
- `src/checks/test.ts` - Test check implementation
- `src/reporters/github-status.ts` - GitHub status reporter
- `src/config.ts` - Configuration loading
- `src/index.ts` - Main entry point

### GitHub Actions Workflows
- `.github/workflows/pr-review.yml` - Main workflow
- `.github/workflows/lint.yml` - Lint job
- `.github/workflows/test.yml` - Test job

### Database Schema
- Add `pr_reviews` table to migrations
- Add `pr_review_checks` table for individual check results

### Shared Types
- Update `packages/shared/src/types.ts` with PR review types

### Worker Integration
- Update `packages/worker/src/index.ts` to trigger review after PR creation

## Tests
- Unit tests for each module
- Integration tests for workflow
- Mock GitHub API responses

## Exit Criteria
- [ ] Architecture document created
- [ ] Component interfaces defined
- [ ] Integration points documented
- [ ] Database schema designed
- [ ] All sub-bullets of task completed

## Notes
- Use GitHub Actions for execution (already in CI/CD)
- Keep checks composable and configurable
- Support emergency override mechanism
- Maintain audit trail of decisions
