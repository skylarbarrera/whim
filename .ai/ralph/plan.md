# Plan: Pass GH_TOKEN properly to gh command

## Goal
Ensure the GitHub CLI (`gh`) command receives authentication tokens reliably in containerized environments.

## Problem
The current implementation passes `GH_TOKEN` via environment variable only:
```typescript
const prResult = await exec("gh", prArgs, {
  cwd: repoDir,
  env: { GH_TOKEN: githubToken },
});
```

This may not work reliably because:
1. The `exec` helper merges `process.env` with the passed env, but only sets `GH_TOKEN`
2. Some containerized environments may strip or not propagate env vars properly
3. The `gh` CLI also looks for `GITHUB_TOKEN` as a fallback

## Solution
1. Pass both `GH_TOKEN` and `GITHUB_TOKEN` environment variables (for redundancy)
2. Preserve `GH_HOST` if set (for GitHub Enterprise scenarios)
3. Log that token is being provided (without revealing the token)
4. Add a token validation step before attempting PR creation

## Files to Modify
- `packages/worker/src/setup.ts` - Update `createPullRequest` function

## Tests
- `packages/worker/src/__tests__/setup.test.ts` - Add test for token passing

## Exit Criteria
- [ ] Both `GH_TOKEN` and `GITHUB_TOKEN` are passed to `gh` command
- [ ] Token presence is logged (masked)
- [ ] Tests verify token behavior
