# Learnings

## PR Review System Architecture Design - 2026-01-13

### Designing a Composable Review System

When designing a PR review system for AI-generated code:

1. **Separation of Concerns**: Keep detection, checking, aggregation, and reporting as distinct modules
   - Detector: Identifies AI-generated PRs
   - Checks: Pluggable modules for lint, test, typecheck, etc.
   - Aggregator: Combines results to determine merge status
   - Reporter: Communicates results to GitHub

2. **Plugin Architecture**: Use base interfaces for extensibility
   - Define a `Check` interface with `run()` method
   - Each check type implements the interface
   - Easy to add new checks without modifying core
   - Configuration controls which checks run

3. **Database-First Design**: Plan schema before implementation
   - Two tables: `pr_reviews` (lifecycle) and `pr_review_checks` (individual checks)
   - Enums for status values ensure consistency
   - Foreign keys maintain referential integrity
   - Indexes on frequently queried columns

4. **Configuration-Driven Behavior**: Use YAML for flexibility
   - Per-repository overrides via `.ai/pr-review.yml`
   - Define which checks are required vs optional
   - Configure check-specific settings (timeouts, thresholds)
   - Supports different rules for different projects

5. **Integration Points**: Document all touch points early
   - GitHub Actions for execution environment
   - Worker triggers via repository_dispatch events
   - Orchestrator API for state management
   - Database for persistence
   - Dashboard for monitoring
   - GitHub API for reporting

6. **Comprehensive Types**: Define interfaces upfront
   - Use TypeScript for type safety
   - Share types across packages via @factory/shared
   - Include API request/response types
   - Document with JSDoc comments

7. **Emergency Overrides**: Plan for exceptions
   - Track override user, reason, and timestamp
   - Require admin role for overrides
   - Maintain audit trail
   - Allow merge despite check failures for critical hotfixes

### GitHub Integration Best Practices

1. **Use Repository Dispatch**: Best way to trigger workflows from external systems
   - Native GitHub integration
   - Automatic retries via Actions
   - Visible in Actions tab for debugging
   - No need to expose orchestrator publicly

2. **Status API vs Checks API**:
   - Status API: Simple pass/fail, shown in PR UI
   - Checks API: Detailed results with annotations
   - Use both for comprehensive feedback

3. **Branch Protection**: Enforce merge blocking
   - Configure required status checks
   - Context must match reported status
   - Prevents merging on check failures

### Documentation Strategy

1. **Architecture Document**: High-level design with diagrams
   - System components and responsibilities
   - Data flow and interactions
   - Key design decisions and trade-offs

2. **Integration Document**: Detailed implementation guide
   - Code examples for each integration point
   - API endpoint specifications
   - Configuration examples
   - Error handling patterns

3. **Database Schema**: Inline documentation
   - COMMENT ON TABLE/COLUMN for context
   - Clear naming conventions (snake_case)
   - Index documentation (why each index exists)

### Lessons Learned

1. **Design Before Code**: Thorough design prevents rework
   - Identify all components and interfaces
   - Document integration points
   - Define database schema
   - Get architectural approval before implementation

2. **Type Safety First**: Add types to shared package early
   - Ensures consistency across packages
   - Catches errors at compile time
   - Serves as documentation

3. **Think About Monitoring**: Plan observability from the start
   - What metrics to track
   - What logs to emit
   - What alerts to configure
   - Dashboard widgets needed

4. **Plan for Failure**: Design error handling upfront
   - Transient vs permanent failures
   - Retry strategies
   - Fallback mechanisms
   - User-friendly error messages

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

### Interactive Spec Creation Wrapper

Created `scripts/create-spec.sh` to provide a better UX for manual spec creation:

**Features:**
- Prerequisite checks (Claude CLI, git repo, API key)
- Wraps `/create-spec` skill with helpful prompts
- Handles output path configuration
- Shows next steps after spec generation
- Provides clear error messages

**Design Decision:**
Instead of integrating interactive spec creation into the factory API (complex streaming),
we provide a local wrapper script. This approach:
- Leverages Ralph's existing `/create-spec` skill
- Maintains separation between spec creation and execution
- Simpler to implement and maintain
- Works with any repo before submission to factory
- Provides better terminal UX than HTTP streaming

**Usage:**
```bash
# From project directory
./scripts/create-spec.sh

# Then submit to factory
curl -X POST http://localhost:3002/api/work \
  -H "Content-Type: application/json" \
  -d '{"repo":"owner/repo","spec":"...","priority":"medium"}'
```

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

## Core PR Review Implementation - 2026-01-13

### Implementing Composable Review Systems

When building a PR review system with multiple components:

1. **Interface-Driven Design**: Define clear interfaces for dependencies
   - `DatabaseClient` interface allows testing without real database
   - Enables dependency injection for better testability
   - Makes components reusable in different contexts

2. **Type Alignment**: Ensure enum values match across the stack
   - ReviewStatus uses "failed" but CheckStatus uses "failure"
   - Document the difference: review-level vs check-level status
   - Use find-and-replace carefully; context matters

3. **Confidence-Based Detection**: Multi-signal approach is more robust
   - Co-author check: 0.7 confidence (strongest signal)
   - Branch pattern: 0.2 confidence (medium signal)
   - Labels: 0.1 confidence (weakest signal)
   - Threshold of 0.5 requires at least one strong indicator
   - Cap total confidence at 1.0

4. **Aggregation Logic**: Clear rules for merge blocking
   - Block if ANY required check failed
   - Block if ANY required check still pending/running
   - Allow merge if optional checks fail
   - Generate actionable summaries for users

5. **Database Abstraction Pattern**:
   - Define minimal interface needed (`query`, `queryOne`, `execute`)
   - Use snake_case in DB, camelCase in application
   - Add index signatures to row types for TypeScript
   - Helper function for case conversion

6. **TypeScript Paths in Monorepos**:
   - Add `paths` to tsconfig.json for workspace dependencies
   - Format: `"@factory/shared": ["../shared/src"]`
   - Needed when building individual packages
   - Works with project references

7. **Test Structure for Multi-Component Systems**:
   - Test each component in isolation first
   - Mock dependencies for unit tests
   - Integration tests verify component coordination
   - Keep mocks simple; focus on behavior not implementation

### Testing Without Runtime

When test runner not available (bun, jest, etc.):

1. **Write tests anyway** - They document expected behavior
2. **Structure matters** - Use describe/it pattern
3. **Type checking validates** - Tests must compile
4. **Tests will run in CI** - Factory worker has bun installed
5. **Mock external dependencies** - Database, APIs, file system

### Common Pitfalls

1. **Enum Value Mismatch**:
   - Problem: Using "passed" when enum defines "success"
   - Solution: Check shared types first, use exact values
   - Tool: grep for enum/type definitions

2. **Workspace Dependencies**:
   - Problem: TypeScript can't find @factory/shared
   - Solution: Add paths mapping in tsconfig.json
   - Alternative: Build shared package first

3. **Database Row Types**:
   - Problem: TypeScript error "Index signature missing"
   - Solution: Add `[key: string]: unknown` to row interfaces
   - Reason: rowToCamelCase needs Record<string, unknown>

### Design Patterns

**Service Layer Pattern**:
- Service coordinates multiple components
- Each component has single responsibility
- Service configurable via dependency injection
- Makes system testable and maintainable

**Result Pattern**:
- Return rich result objects, not just boolean
- Include reasons, confidence scores, details
- Makes debugging easier
- Enables better user feedback

**Builder Pattern for Tests**:
- Create helper functions like `createContext()`
- Accept partial overrides for test-specific values
- Reduces test boilerplate
- Makes tests more readable


## Implementing Lint Integration for PR Review - 2026-01-13

### Building a Composable Check System

When implementing checks (lint, test, typecheck) for PR review:

1. **Abstract Base Class Pattern**:
   - Define BaseCheck with standard interface: run(), getName(), isRequired()
   - Include common functionality: timeout handling, error recovery, status management
   - Use Template Method pattern: `run()` calls abstract `runCheck()`
   - Benefits: Consistent behavior, reduced boilerplate, easy to add new check types

2. **Separation of Execution from Orchestration**:
   - LintRunner: Low-level tool execution, output parsing, error handling
   - LintCheck: High-level orchestration, configuration, result formatting
   - Service: Check lifecycle management, database updates, merge status calculation
   - This separation makes each component testable and reusable

3. **Configuration-Driven Behavior**:
   - Use YAML for user-facing configuration (.ai/pr-review.yml)
   - Provide sensible defaults for zero-config experience
   - Deep merge user config with defaults (don't overwrite entire sections)
   - Validate config gracefully with fallbacks (log warning, use defaults)

4. **Tool Output Parsing Strategy**:
   - ESLint: Use --format json for structured output, parse as JSON
   - Prettier: Parse text output (list of files needing formatting)
   - Generic: Regex pattern for file:line:column:message format
   - Always provide structured CheckError/CheckWarning output
   - Store raw stdout/stderr for debugging

5. **Timeout Handling**:
   - Use Promise.race with setTimeout for timeout logic
   - Send SIGTERM on timeout for graceful shutdown
   - Track timeout state to differentiate from normal exit
   - Include timeout duration in error messages

6. **TypeScript Without Node Types**:
   - If @types/node not available, use @ts-ignore on imports
   - Add type annotations to event handlers (data: any, err: Error, code: number | null)
   - Include DOM lib for setTimeout/clearTimeout/console
   - Declare minimal Node.js globals if needed (process.env)
   - Use --skipLibCheck to ignore missing type definitions

7. **Testing Async Child Processes**:
   - Mock child_process.spawn with EventEmitter
   - Emit events asynchronously with setTimeout
   - Mock stdout/stderr as EventEmitters
   - Test timeout by not emitting close event
   - Test errors by emitting error event

8. **Failure Thresholds**:
   - Allow configurable number of violations before failing
   - Default to 0 (strict: any violation fails)
   - Useful for legacy codebases with existing violations
   - Document threshold behavior clearly

9. **Service Integration Pattern**:
   - Service doesn't know about specific check implementations
   - Pass BaseCheck instance to service.runCheck()
   - Service handles status updates and merge recalculation
   - Check implementations focus on execution logic
   - Clean separation of concerns

10. **Progressive Enhancement**:
    - Start with core functionality (lint checks)
    - Design for extensibility (BaseCheck interface)
    - Add more check types later (test, typecheck, security)
    - Configuration format supports future additions
    - Database schema already includes check_type enum

### Common Pitfalls

1. **Forgetting to Return Updated Record**:
   - Problem: tracker.updateCheck() returned void
   - Solution: Use RETURNING * in UPDATE query
   - Benefit: Service gets updated record without extra query

2. **Hardcoding Check Types**:
   - Problem: Service creates checks for specific types
   - Solution: Pass BaseCheck instances, service is generic
   - Benefit: Easy to add new check types without modifying service

3. **Incomplete Configuration Merging**:
   - Problem: User config replaces entire default config
   - Solution: Deep merge at property level (e.g., merge tools array)
   - Benefit: Users can override specific settings

4. **Ignoring Tool Exit Codes**:
   - Problem: ESLint exits 1 on violations (not an error)
   - Solution: Check tool name and treat exit 1 as success for ESLint
   - Benefit: Violations are reported without marking tool as failed

### Design Decisions

**Why Abstract Class vs Interface?**
- Abstract class allows shared implementation (timeout, error handling)
- Interface would require duplicating logic in each check type
- Template Method pattern works best with abstract classes

**Why YAML vs JSON/TypeScript Config?**
- YAML is more user-friendly (no quotes, comments supported)
- Non-developers can edit easily
- Industry standard for CI/CD configs

**Why Not Run Checks Automatically?**
- Service creates check records but doesn't execute them
- Execution happens externally (GitHub Actions, worker, etc.)
- Service just coordinates status updates and merge blocking
- Allows flexibility in execution environment

**Why Store Both Summary and Details?**
- Summary for PR status UI (one line)
- Details for full report (all violations, markdown formatted)
- Enables both quick glance and deep dive

