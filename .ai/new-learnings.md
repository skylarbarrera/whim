# Learnings

## Ralph v0.3.0 Integration - 2026-01-13

### Ralph Spec Generation Capabilities

**Ralph v0.3.0** introduces powerful spec creation tooling that can be integrated into the factory:

1. **Headless Spec Generation** (`ralph spec --headless`)
   - Autonomous spec creation from text descriptions
   - Outputs JSON events for programmatic integration
   - Includes automatic validation against Ralph conventions
   - Returns structured data: task count, validation status, violations

2. **Interactive Spec Creation** (`/create-spec` skill in Claude Code)
   - Guided interview process for requirements gathering
   - Asks about project type, stack, features, constraints
   - Generates spec with LLM review to catch anti-patterns
   - Only proceeds after passing validation checks

3. **Spec Validation** (built-in)
   - Checks for code snippets (forbidden in SPECs)
   - Detects file:line references
   - Flags shell commands in task descriptions
   - Identifies implementation instructions vs requirements

### Integration Pattern

Created `RalphSpecGenerator` class in intake service:
- Spawns `ralph spec --headless` as child process
- Parses JSON event stream from stdout
- Extracts generated SPEC.md file on success
- Provides same interface as Anthropic SDK spec generator
- Enables switching via `USE_RALPH_SPEC` environment variable

**Benefits:**
- Better spec quality through built-in validation
- Consistent spec format across all issues
- Reduced API costs (uses Claude Code CLI instead of SDK)
- Fallback option if Ralph spec generation fails

**Trade-offs:**
- Requires Ralph CLI to be installed (already in worker Docker image)
- Slightly longer generation time due to validation step
- Creates temporary files in work directory

### Configuration

```env
# Use Ralph CLI for spec generation (recommended)
USE_RALPH_SPEC=true

# Or fall back to Anthropic SDK
USE_RALPH_SPEC=false
ANTHROPIC_API_KEY=your_key_here
```

### Testing Notes

- Unit tests for RalphSpecGenerator cover formatting and branch generation
- Full integration requires Ralph CLI and Claude Code authentication
- Fallback to Anthropic SDK ensures system remains operational

---

## Integration Testing - 2026-01-13 (Phase 10)

### Issues Found and Fixed

#### 1. Bun Version Mismatch in Dockerfiles
- **Problem**: `--frozen-lockfile` flag in Dockerfiles caused build failures due to version mismatch between local bun (1.2.15) and docker bun (1.3.6)
- **Solution**:
  - Removed `--frozen-lockfile` from all Dockerfiles
  - Copy lockfile from builder stage (not host) to production stage
  - This ensures lockfile consistency within the Docker build

#### 2. Missing curl in bun-slim Image
- **Problem**: `oven/bun:1-slim` does not include curl, but orchestrator Dockerfile had a health check using curl
- **Solution**: Added `apt-get update && apt-get install -y curl` in the production stage of orchestrator Dockerfile

#### 3. Missing Root tsconfig.json in Docker Build
- **Problem**: Package tsconfigs extend root `../../tsconfig.json` but this wasn't copied to Docker build context
- **Solution**: Added `tsconfig.json` to the COPY statement for root package files in all Dockerfiles

#### 4. Port Conflicts with Host Services
- **Problem**: Default ports (5432, 6379, 3000) conflicted with existing services running on host
- **Solution**: Changed docker-compose port mappings:
  - postgres: 5433:5432
  - redis: 6380:6379
  - orchestrator: 3002:3000
  - dashboard: 3003:3001

### Verification Results

#### Build Verification
- ✅ `bun install` completes successfully
- ✅ `bun run build` builds all 5 packages without errors
- ✅ Docker images build successfully:
  - docker-orchestrator
  - docker-intake

#### Service Verification
- ✅ postgres container starts and becomes healthy
- ✅ redis container starts and becomes healthy
- ✅ orchestrator container starts and becomes healthy
- ✅ `/health` endpoint returns `{"status":"ok"}`
- ✅ `/api/status` returns correct system status

#### API Flow Verification
- ✅ POST `/api/work` creates work items correctly
- ✅ GET `/api/queue` returns queue status
- ✅ GET `/api/workers` shows spawned workers
- ✅ GET `/api/metrics` returns factory metrics
- ✅ GET `/api/work/:id` returns work item details
- ✅ POST `/api/work/:id/cancel` validates state properly

### Limitations

1. **Worker Execution**: Full worker execution requires:
   - Docker socket mount (`/var/run/docker.sock`)
   - Built worker image with Claude Code CLI
   - Valid GitHub credentials
   - This was not tested in integration as it requires external dependencies

2. **Intake Service**: Not fully tested as it requires:
   - Valid `GITHUB_TOKEN`
   - Valid `ANTHROPIC_API_KEY`
   - Configured `REPOS` environment variable

3. **Dashboard**: Not built/tested as it requires the `--profile with-dashboard` flag and depends on orchestrator being accessible

### Recommendations for Production

1. Pin specific bun version in Dockerfiles to avoid lockfile issues
2. Consider adding health checks to intake and dashboard services
3. Set up CI/CD to run integration tests with mock services
4. Document required environment variables clearly
