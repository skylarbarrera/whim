# Phase 6: Intake Package

## Goal
Implement the intake package that polls GitHub for issues with a specific label, generates specs from them using Claude, and submits work items to the orchestrator.

## Files to Create
- `packages/intake/package.json` - Package config with @octokit/rest, @anthropic-ai/sdk
- `packages/intake/tsconfig.json` - TypeScript config extending root
- `packages/intake/src/github.ts` - GitHubAdapter class (poll, addLabel, removeLabel)
- `packages/intake/src/spec-gen.ts` - SpecGenerator class (generate: issue → SPEC.md)
- `packages/intake/src/index.ts` - Main entry: poll → generate → submit → update labels
- `packages/intake/Dockerfile` - Docker build config

## Tests
- `packages/intake/src/github.test.ts` - GitHubAdapter tests (mocked Octokit)
- `packages/intake/src/spec-gen.test.ts` - SpecGenerator tests (mocked Anthropic)
- `packages/intake/src/index.test.ts` - Integration tests

## Exit Criteria
- [ ] All source files created with proper types
- [ ] Tests pass with `bun test`
- [ ] Type check passes with `bun run typecheck`
- [ ] Dockerfile builds successfully
- [ ] SPEC.md checkbox marked
