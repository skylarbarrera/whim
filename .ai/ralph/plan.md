# Task 1: Update Ralph Repository Integration

## Goal
Pull latest changes from Ralph repo (v0.3.0), integrate updated spec tooling, and test headless spec creation functionality.

## Current State
- Ralph is installed via `git clone` in worker Dockerfile (line 63-66)
- Ralph v0.3.0 includes:
  - Headless mode (`--headless` flag) with JSON events
  - Autonomous spec generation (`ralph spec "description"`)
  - Interactive spec creation skill (`/create-spec`)
  - Spec validator and LLM review capabilities
- Intake service uses Anthropic SDK directly for spec generation
- Worker calls `ralph init` and `ralph run` successfully

## Implementation Plan

### 1. Document Ralph v0.3.0 Integration
- Ralph is already at latest version (pulled from git on Docker build)
- Document new capabilities in README/docs
- No code changes needed for Ralph version itself

### 2. Integrate Ralph Spec Tooling in Intake Service
Create a new `RalphSpecGenerator` class that:
- Wraps `ralph spec --headless` CLI command
- Parses JSON event output
- Falls back to Anthropic SDK on failure
- Add as alternative to current SpecGenerator

### 3. Add Interactive Spec Creation Documentation
- Document `/create-spec` skill for manual use
- Add examples of both autonomous and interactive flows
- Update factory README with workflow options

### 4. Test Integration
- Test ralph spec generation with real GitHub issue
- Verify JSON event parsing
- Ensure fallback works
- Integration test with orchestrator

## Files to Modify/Create
- `packages/intake/src/ralph-spec-gen.ts` (NEW) - Ralph CLI wrapper
- `packages/intake/src/ralph-spec-gen.test.ts` (NEW) - Tests
- `packages/intake/src/index.ts` - Add RalphSpecGenerator option
- `README.md` - Document new spec creation flows
- `.ai/learnings.md` - Document Ralph v0.3.0 capabilities

## Exit Criteria
- [x] Ralph repository is at latest version (v0.3.0)
- [ ] Ralph spec tooling integrated in intake service
- [ ] Tests pass for Ralph spec generation
- [ ] Documentation updated
- [ ] Both spec generation methods work (Ralph + Anthropic SDK)
