# Plan: Fix PR Creation Flow

## Goal
Fix the `createPullRequest` function in `packages/worker/src/setup.ts` to correctly detect unpushed commits instead of uncommitted changes.

## Problem
The current implementation checks for uncommitted changes using `git status --porcelain`, but Ralph already commits his work. This causes the function to return early with "No changes to commit" when there are actually committed but unpushed changes.

## Files to Modify
- `packages/worker/src/setup.ts` - Main fix
- `packages/worker/src/setup.test.ts` - Add/update tests (create if needed)

## Implementation
1. Replace the `git status --porcelain` check with `git rev-list --count origin/HEAD..HEAD`
2. Skip the commit step if no uncommitted changes (Ralph already committed)
3. Only push and create PR if there are unpushed commits
4. Add better logging for each step

## Exit Criteria
- [ ] Function correctly detects unpushed commits
- [ ] Tests pass
- [ ] Type checks pass
- [ ] Worker can successfully push Ralph's commits and create PRs
