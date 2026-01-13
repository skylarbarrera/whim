# Phase 5.2: Worker Config and Dockerfile

## Goal
Create Claude Code configuration files and Dockerfile for the worker package.

## Files to Create

1. **`packages/worker/.claude/CLAUDE.md`** - Worker instructions telling Claude how to work through SPEC.md
2. **`packages/worker/.claude/mcp.json`** - MCP server configuration (playwright, context7)
3. **`packages/worker/.claude/settings.json`** - Claude Code settings
4. **`packages/worker/Dockerfile`** - Container build for worker

## Key Requirements

### CLAUDE.md
- Tell Claude it's "Ralph" running autonomously
- Must emit `[RALPH:*]` events for worker parsing (see ralph.ts pattern)
- Work through SPEC.md checkboxes
- Report iterations, file edits, stuck states, completion

### MCP Servers
- playwright: Browser automation for E2E testing
- context7: Library documentation lookup

### Dockerfile
- Base image with Node.js
- Install: git, curl, gh CLI, Claude Code CLI
- Copy and build worker package
- Copy Claude config into image
- Entry point runs the worker

## Tests
- Existing tests should pass
- Type check should pass

## Exit Criteria
- [ ] All 4 files created
- [ ] `bun test` passes in worker package
- [ ] `bun tsc --noEmit` passes
- [ ] Committed with clear message
