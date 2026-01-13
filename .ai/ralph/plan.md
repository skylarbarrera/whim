# Task: Initialize Bun monorepo

## Goal
Initialize the Bun monorepo with `package.json` as the foundation for the AI Software Factory project.

## Files to Create
- `package.json` - Root package.json with workspaces config, scripts, and metadata

## Implementation Details

### package.json
- name: `ai-software-factory`
- private: true (monorepo root)
- workspaces: ["packages/*"]
- scripts for build, test, lint

## Tests
- Verify `bun install` works
- Verify workspace structure is recognized

## Exit Criteria
- [ ] `package.json` exists with proper monorepo config (workspaces field)
- [ ] `bun install` succeeds
- [ ] Workspace structure is recognized
