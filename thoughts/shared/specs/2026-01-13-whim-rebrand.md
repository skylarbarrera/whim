# Whim Rebrand Specification

## Executive Summary

Rename the project from "AI Factory" / "factory" to "whim" across all code, configuration, documentation, and infrastructure. This establishes a consistent brand identity.

## Problem Statement

The project currently uses inconsistent naming:
- `factory`, `ai-factory`, `Factory`, `AI Factory`, `AI Software Factory`
- Package namespace `@factory/*`
- Docker images/containers named `factory-*`

This creates confusion and doesn't reflect the intended brand. The GitHub repo is already named `whim`, creating a mismatch.

## Success Criteria

- [ ] All references to "factory" variants replaced with "whim"
- [ ] Package namespace changed from `@factory/*` to `@whim/*`
- [ ] Docker images/containers renamed from `factory-*` to `whim-*`
- [ ] Documentation reflects new branding
- [ ] Project builds and runs successfully after rename
- [ ] No broken imports or references

## Scope

### In Scope

| Category | From | To |
|----------|------|-----|
| Package names | `@factory/shared`, `@factory/worker`, etc. | `@whim/shared`, `@whim/worker`, etc. |
| Docker images | `factory-worker:latest` | `whim-worker:latest` |
| Container names | `factory-orchestrator`, `factory-postgres` | `whim-orchestrator`, `whim-postgres` |
| Volume names | `factory-postgres-data`, `factory-redis-data` | `whim-postgres-data`, `whim-redis-data` |
| Network name | `factory-network` | `whim-network` |
| Documentation | "AI Factory", "Factory" | "Whim", "whim" |
| Comments/strings | "factory" references | "whim" references |
| File paths | Any with "factory" | Corresponding "whim" |

### Out of Scope (Preserve)

- **Ralph**: Keep all Ralph references unchanged (separate tool identity)
- **External services**: GitHub, Anthropic, etc. references unchanged
- **Git history**: No rewriting history

## Technical Requirements

### Package Renaming

```json
// Before (package.json)
{
  "name": "@factory/shared",
  "dependencies": {
    "@factory/shared": "workspace:*"
  }
}

// After
{
  "name": "@whim/shared",
  "dependencies": {
    "@whim/shared": "workspace:*"
  }
}
```

**Packages to rename:**
- `@factory/shared` → `@whim/shared`
- `@factory/worker` → `@whim/worker`
- `@factory/orchestrator` → `@whim/orchestrator`
- `@factory/intake` → `@whim/intake`
- `@factory/dashboard` → `@whim/dashboard`

### Docker Configuration

**docker-compose.yml changes:**
```yaml
# Container names
container_name: whim-orchestrator  # was factory-orchestrator
container_name: whim-postgres      # was factory-postgres
container_name: whim-redis         # was factory-redis
container_name: whim-intake        # was factory-intake
container_name: whim-dashboard     # was factory-dashboard

# Volumes
volumes:
  whim-postgres-data:    # was factory-postgres-data
  whim-redis-data:       # was factory-redis-data

# Network
networks:
  default:
    name: whim-network   # was factory-network
```

**Dockerfile image references:**
```dockerfile
# Worker spawning (in orchestrator)
workerImage: "whim-worker:latest"  # was factory-worker:latest
```

### Environment Variables

Check and update any `FACTORY_*` environment variables to `WHIM_*` if they exist.

### Import Statements

All TypeScript imports need updating:
```typescript
// Before
import { WorkItem } from "@factory/shared";

// After
import { WorkItem } from "@whim/shared";
```

### Documentation

Update all markdown files:
- README.md
- SPEC.md
- STATE.txt
- Any docs in `thoughts/` directory
- Code comments referencing "factory"

## Implementation Plan

### Phase 1: Package Names
1. Update all `package.json` files with new names
2. Update all import statements in `.ts` files
3. Run `bun install` to update lockfile

### Phase 2: Docker Configuration
1. Update `docker-compose.yml` (container names, volumes, network)
2. Update Dockerfiles (image names)
3. Update `workers.ts` (worker image reference)
4. Update any env files with container references

### Phase 3: Documentation
1. Search and replace in markdown files
2. Update comments in source code
3. Update error messages and log strings

### Phase 4: Verification
1. Run `bun install` - verify workspace resolution
2. Run `bun run build` - verify compilation
3. Run `bun test` - verify tests pass
4. Start Docker stack - verify containers start
5. Test end-to-end flow

## Files to Modify

### Definite Changes
- `package.json` (root)
- `packages/*/package.json` (all packages)
- `docker/docker-compose.yml`
- `docker/docker-compose.dev.yml` (if exists)
- `packages/orchestrator/src/workers.ts`
- `README.md`
- `SPEC.md`
- `STATE.txt`
- `.env.example`

### Search Patterns
```bash
# Find all "factory" references (case-insensitive)
grep -ri "factory" --include="*.ts" --include="*.json" --include="*.yml" --include="*.md"

# Exclude node_modules and dist
grep -ri "factory" --include="*.ts" --include="*.json" --include="*.yml" --include="*.md" \
  --exclude-dir=node_modules --exclude-dir=dist
```

## Rollback Plan

If issues are discovered:
1. `git checkout .` to revert all changes
2. `bun install` to restore lockfile
3. Rebuild Docker images with old names

## Acceptance Criteria

- [ ] `grep -ri "factory" --include="*.ts" --include="*.json" --include="*.yml"` returns only Ralph-related or external references
- [ ] `bun install` completes without errors
- [ ] `bun run build` completes without errors
- [ ] `docker compose build` completes without errors
- [ ] `docker compose up` starts all services
- [ ] Worker containers spawn with correct image name
- [ ] All tests pass

## Open Questions

None - this is a straightforward mechanical refactoring.
