# Whim Rebrand Plan

## Goal
Rename the project from "AI Factory" / "factory" to "whim" across all code, configuration, documentation, and infrastructure.

## Approach
This is a comprehensive find-and-replace operation across multiple file types. I'll work systematically through each category:
1. Package names in package.json files
2. Import statements in TypeScript files
3. Docker configuration (compose files, container names, volumes, networks)
4. Documentation (markdown files)
5. Environment variables and comments

## Files to Modify

### Package Configuration
- Root `package.json`
- `packages/shared/package.json`
- `packages/worker/package.json`
- `packages/orchestrator/package.json`
- `packages/intake/package.json`
- `packages/dashboard/package.json`

### TypeScript Files
All `.ts` and `.tsx` files with imports from `@factory/*`

### Docker Configuration
- `docker/docker-compose.yml`
- Any Dockerfiles with factory references
- `packages/orchestrator/src/workers.ts` (worker image reference)

### Documentation
- `README.md`
- `SPEC.md`
- `STATE.txt`
- Files in `thoughts/` directory
- `.env.example`

## Tests
1. `bun install` - verify workspace resolution
2. `bun run build` - verify compilation
3. `bun test` - verify tests pass
4. `grep -ri "factory"` - verify only Ralph/external references remain

## Exit Criteria
All 6 checkboxes in SPEC.md Success Criteria section are marked complete:
- All references to "factory" variants replaced with "whim"
- Package namespace changed from @factory/* to @whim/*
- Docker images/containers renamed from factory-* to whim-*
- Documentation reflects new branding
- Project builds and runs successfully after rename
- No broken imports or references
