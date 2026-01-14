# Claude Coding Standards for Ralph Projects

This file defines coding standards and preferences for AI agents working in Ralph loops.

## Language Preferences

### Default: TypeScript
- Use TypeScript by default for all new projects unless requirements explicitly state otherwise
- Prefer strict mode: `"strict": true` in tsconfig.json
- Use modern ES6+ syntax (async/await, destructuring, arrow functions)

### When to use Python
- Data science, ML, or scientific computing projects
- When SPEC explicitly requires Python
- When existing codebase is Python
- For CLI tools where Python stdlib is sufficient

### When to use other languages
- Follow the existing codebase language
- Respect SPEC requirements
- Go for systems programming or high-performance needs
- Rust for systems-level safety requirements

## Code Style

### Comments
- **NO comments unless absolutely necessary**
- Code should be self-documenting through clear naming
- Only add comments for:
  - Complex algorithms that aren't immediately obvious
  - Edge cases and gotchas
  - Public API documentation (JSDoc/docstrings)
  - "Why" not "what" - explain reasoning, not mechanics

**Bad:**
```typescript
// Get the user name
const userName = user.name;

// Loop through items
for (const item of items) {
  // Process the item
  processItem(item);
}
```

**Good:**
```typescript
const userName = user.name;

for (const item of items) {
  processItem(item);
}
```

**Acceptable comment:**
```typescript
// Use binary search instead of linear - dataset can be 100k+ items
const index = binarySearch(sortedItems, target);

// Edge case: API returns null instead of empty array for new users
const orders = response.orders ?? [];
```

### Naming Conventions
- Use descriptive, meaningful names
- Prefer `getUserById` over `get` or `fetchUser`
- Boolean variables: `isLoading`, `hasPermission`, `canEdit`
- Avoid abbreviations unless widely known (`id`, `url`, `api` are fine)

### Function Size
- Keep functions small and focused (< 50 lines ideal)
- One responsibility per function
- Extract complex logic into named helper functions

### Error Handling
- Use proper error handling, don't swallow errors silently
- TypeScript: Return types with explicit error types
- Python: Raise specific exceptions, not generic Exception
- Log errors with context before re-throwing

## Testing Standards

### Coverage Requirements
- Aim for **80% minimum** code coverage
- 100% coverage for:
  - Core business logic
  - Utility functions
  - Security-critical code
  - Public APIs

### Testing Strategy
- Write tests BEFORE marking a feature complete
- Unit tests for individual functions/classes
- Integration tests for workflows
- E2E tests for critical user paths

### Test Structure
```typescript
describe('UserService', () => {
  describe('getUserById', () => {
    it('returns user when found', async () => {
      // Arrange
      const userId = '123';
      const expectedUser = { id: userId, name: 'Alice' };

      // Act
      const user = await userService.getUserById(userId);

      // Assert
      expect(user).toEqual(expectedUser);
    });

    it('throws NotFoundError when user does not exist', async () => {
      await expect(userService.getUserById('nonexistent'))
        .rejects.toThrow(NotFoundError);
    });
  });
});
```

## Architecture Patterns

### Keep It Simple
- Don't over-engineer
- Avoid premature abstraction
- Three similar lines > one premature abstraction
- Build for current requirements, not hypothetical future

### File Organization
```
src/
├── models/          # Data models/types
├── services/        # Business logic
├── controllers/     # Request handlers (if web app)
├── utils/           # Pure utility functions
├── config/          # Configuration
└── index.ts         # Entry point

tests/
├── unit/
├── integration/
└── e2e/
```

### Separation of Concerns
- Models: Data structures only
- Services: Business logic, orchestration
- Controllers: Input validation, response formatting
- Utils: Pure functions, no side effects

## Git Commit Standards

### Commit Messages
Follow conventional commits:

```
type(scope): brief description

Longer explanation if needed.

- Bullet points for multiple changes
- Reference issue numbers: #123
```

**Types:**
- `feat:` New feature
- `fix:` Bug fix
- `refactor:` Code change that neither fixes bug nor adds feature
- `test:` Adding or updating tests
- `docs:` Documentation only changes
- `chore:` Maintenance tasks

**Examples:**
```
feat(auth): add JWT token refresh mechanism

fix(api): handle null response from user service

refactor(utils): extract duplicate validation logic

test(user-service): add tests for edge cases
```

### Commit Size
- **One logical change per commit**
- Commits should be atomic and revertable
- If you can't describe it in one line, it's probably too big

## Performance Considerations

### Do Optimize
- Database queries (use indexes, avoid N+1)
- API response times (< 200ms ideal)
- Bundle sizes for web apps
- Memory leaks in long-running processes

### Don't Optimize Prematurely
- Micro-optimizations before profiling
- Complex caching before measuring benefit
- Over-engineering for hypothetical scale

### When to Profile
- After implementing a feature, before optimizing
- When performance issues are reported
- For critical paths (hot loops, frequent API calls)

## Security Best Practices

### Always Validate
- Validate ALL user input
- Sanitize data before DB queries
- Use parameterized queries (never string concatenation)
- Validate file uploads (type, size, content)

### Never Commit
- API keys, secrets, passwords
- `.env` files with real credentials
- Private keys or certificates
- Personal or sensitive data

### Authentication & Authorization
- Use established libraries (Passport.js, Auth0, etc.)
- Never roll your own crypto
- Implement rate limiting
- Use HTTPS only in production

## Dependencies

### When to Add Dependencies
- Established, well-maintained libraries for complex problems
- Security-critical functionality (auth, crypto)
- Significant time savings vs. implementation cost

### When NOT to Add Dependencies
- Simple utilities you can write in 10 lines
- Poorly maintained packages (old, few contributors)
- Dependencies with dependencies with dependencies
- For functionality already in stdlib

### Check Before Adding
```bash
# Check package stats
npm info <package>

# Check for vulnerabilities
npm audit

# Check bundle size impact
npx bundlephobia <package>
```

## Ralph-Specific Guidelines

### Required Reading
Before starting work in a Ralph loop:
- **Always read:** `SPEC.md` - Project requirements and task list
- **Read if needed:** `STATE.txt` - Check if unsure what's already done
- **Read if needed:** `.ai/ralph/index.md` - Last 3-5 commits for context

Lazy load context. SPEC has the tasks; only read progress/index if you need to verify state.

### Integration Verification

When building code that integrates with existing systems:

1. **Read existing code first** - Don't assume API shapes or response formats
2. **Check shared types** - Use existing type definitions, don't create duplicates
3. **Verify at runtime** - Test against real endpoints when possible

**Example:**
```
SPEC says: "Add client for /api/status"

WRONG: Assume response is { workers: [], status: "ok" }
RIGHT: Read the server code to find actual response type
```

Common integration mistakes:
- Building against imagined APIs that don't match the real server
- Creating new types when shared types already exist
- Assuming request/response shapes without reading existing handlers

**Before implementing any integration:**
```bash
# Find the actual endpoint handler
grep -r "app.get('/api/status" src/

# Find existing types
grep -r "interface.*Response" src/types/
```

### Creating SPECs (Interactive)

When a user wants to create a new SPEC, **interview them** to gather requirements before writing it:

1. **Ask clarifying questions** about:
   - What they're building and the core use case
   - Target users and how they'll interact with it
   - Technology preferences (or recommend based on project)
   - Must-have vs nice-to-have features
   - Any constraints (time, dependencies, existing code)

2. **Dig into details:**
   - Edge cases and error handling needs
   - Authentication/authorization requirements
   - Data storage and persistence
   - External integrations or APIs
   - Testing expectations

3. **Generate the SPEC** once you have enough context to create specific, actionable tasks.

**Example interview flow:**
```
User: I want a CLI tool for managing dotfiles
You: What operations should it support? (backup, restore, sync across machines?)
User: Backup and restore, plus linking dotfiles to a git repo
You: Should it handle conflicts when restoring? (overwrite, skip, prompt?)
User: Prompt the user
You: Any specific dotfiles it must support, or auto-discover from home directory?
...
[Generate SPEC after gathering sufficient detail]
```

**Important:** When starting a new project, replace the existing SPEC.md entirely. Each SPEC represents one project or feature set.

### Understanding Tasks

**One checkbox = one iteration.** Complete ALL sub-bullets before marking the checkbox done.

```markdown
# This is ONE task (one iteration):
- [ ] Implement user authentication
  - Create User model with password hashing
  - Add /auth/register and /auth/login endpoints
  - Create JWT middleware
  - Write tests for all auth flows
```

When you see a task with sub-bullets:
1. Implement everything listed in the sub-bullets
2. Write tests for the functionality
3. Only mark the checkbox `[x]` when ALL sub-items are complete

### Writing SPECs

When generating a SPEC, optimize for **iteration efficiency**. Each checkbox = one Ralph iteration (~3 min), so structure matters.

**Batch by default.** Group related tasks under one checkbox:

```markdown
# BAD - 4 iterations (12 min)
- [ ] Create ThoughtItem.tsx
- [ ] Create ToolActivityItem.tsx
- [ ] Create CommitItem.tsx
- [ ] Create PhaseIndicator.tsx

# GOOD - 1 iteration (4 min)
- [ ] Create activity feed components (ThoughtItem, ToolActivityItem, CommitItem, PhaseIndicator)
```

**Batch when:**
- Same file or same directory
- Similar structure (4 similar components = 1 task)
- Tightly coupled (interface + implementation)
- Style/config changes across files

**Don't batch when:**
- Different areas of codebase
- Complex logic needing focus
- Tasks where one failure shouldn't block others

**Always include tests with implementation:**
```markdown
# BAD - tests as separate task
- [ ] Create usePulse.ts hook
- [ ] Create usePulse.test.ts

# GOOD - tests included
- [ ] Create usePulse.ts hook with tests
```

**Task naming:**
- Start with verb: Create, Add, Update, Fix, Refactor
- Be specific about scope: "Create activity feed components" not "Build UI"
- Include file hints when helpful

**Include verification steps:**

```markdown
## Phase 2: Core Features
- [ ] Implement authentication system
  - POST /auth/register - create user with hashed password
  - POST /auth/login - validate credentials, return JWT
  - POST /auth/logout - invalidate token
  - Middleware for protected routes
  - Tests for all auth flows

  **Verify:**
  - `curl -X POST localhost:3000/auth/register -d '{"email":"test@test.com","password":"test123"}'` → 201
  - `curl -X POST localhost:3000/auth/login -d '{"email":"test@test.com","password":"test123"}'` → returns JWT
  - Use JWT on protected route → 200

- [ ] Build posts API with full CRUD
  - GET/POST/PUT/DELETE endpoints
  - Authorization (only author can edit/delete)
  - Pagination for list endpoint
  - Tests for all operations

  **Verify:**
  - `curl localhost:3000/posts` → 200 with array
  - Create post with valid JWT → 201
  - Edit post as non-author → 403
```

### Verification Steps

Each task should include a **Verify:** section with concrete checks to run before marking complete.

**Good verification steps:**
- API calls with expected response codes
- CLI commands with expected output
- Database queries to confirm data was written
- File existence checks

**Verification format:**
```
**Verify:**
- `<command>` → <expected result>
- `<command>` → <expected result>
```

**Examples:**
```markdown
**Verify:**
- `npm test` → all tests pass
- `curl localhost:3000/health` → 200
- `ls dist/` → contains index.js
- `node dist/cli.js --version` → prints version number
```

If verification can't run (server not available, etc.), note this in the commit and leave the checkbox unchecked.

### The Loop

Each iteration, Ralph:
1. Reads SPEC.md to find the next incomplete task
2. Writes a plan to `.ai/ralph/plan.md`
3. Implements the task with tests
4. **Runs verification steps from the Verify section**
5. **Only marks checkbox if verification passes**
6. Commits changes
7. Updates STATE.txt and `.ai/ralph/index.md`

### Memory System (.ai/ralph/)

Ralph uses commit-anchored memory to maintain context efficiently.

**Two files:**

1. **`.ai/ralph/plan.md`** - Current task plan (overwritten each iteration)
   - Written BEFORE implementation starts
   - Defines scope, files, tests, exit criteria
   - Prevents scope creep

2. **`.ai/ralph/index.md`** - Commit history log (append-only)
   - Written AFTER each successful commit
   - One entry per commit, keyed by SHA
   - 5-7 lines max per entry

**Planning Phase (MANDATORY):**

Before implementing any task:
1. Read SPEC.md, STATE.txt, and last 3 entries from index.md
2. Write plan to `.ai/ralph/plan.md` using this format:
```markdown
## Goal
One sentence describing what this iteration accomplishes.

## Files
- src/feature.ts - add new function
- tests/feature.test.ts - unit tests

## Tests
- Test scenario 1
- Test scenario 2

## Exit Criteria
- Function works with valid input
- Tests pass with 80%+ coverage
- Changes committed
```

**Memory Index Format:**

After committing, append to `.ai/ralph/index.md`:
```markdown
## abc1234 — Add user authentication
- files: src/auth.ts, tests/auth.test.ts
- tests: 12 passing
- notes: Used bcrypt for password hashing
- next: Add password reset endpoint
```

**Hard Rules:**
- No commit = no index entry
- Plan must exist before coding starts
- Keep summaries concise (context window optimization)
- Read index.md only for last 3-5 commits (not entire history)

### Task Completion Criteria
A task is ONLY complete when:
- [ ] Code is written and works
- [ ] Tests are written and passing
- [ ] No linting errors
- [ ] Documentation updated (if public API)
- [ ] Changes committed with clear message

**A task is NOT complete if:**
- Code contains `// TODO:` or `// FIXME:` comments
- Implementation is stubbed or placeholder
- Tests don't pass or are skipped
- Functions throw "not implemented" errors

**If you can't implement something:**
1. Leave the checkbox unchecked
2. Document the blocker in STATE.txt
3. Move to the next task or create a sub-task for the blocker

**Example of incomplete code (don't mark as done):**
```typescript
async function processPayment(amount: number): Promise<void> {
  // TODO: implement payment processing
  throw new Error('Not implemented');
}
```

### Progress Updates
When updating `STATE.txt`, be specific:
```
✅ 2024-01-08: Implemented user authentication with JWT
  - Added login/register endpoints
  - Created User model with bcrypt password hashing
  - Tests: 15 passing (auth.test.ts)
  - Commit: feat(auth): add JWT authentication
```

### Error Recovery
If a task fails:
1. Document the error in STATE.txt
2. Don't mark task as complete
3. Create a new task to fix the blocker
4. If blocked on external factor, note it and move to next task

## Code Review Checklist

Before committing, verify:
- [ ] Code works (manual test + automated tests)
- [ ] Tests pass with good coverage
- [ ] No linting errors
- [ ] No commented-out code
- [ ] No console.log/print statements (use proper logging)
- [ ] No TODO comments (convert to tasks)
- [ ] Error handling is present
- [ ] Security vulnerabilities checked
- [ ] Performance is acceptable
- [ ] Commit message is clear

## Anti-Patterns to Avoid

### Don't Do This
- ❌ Catch and ignore errors without logging
- ❌ Use `any` type in TypeScript
- ❌ Mutate function parameters
- ❌ Write god functions (> 100 lines)
- ❌ Nest callbacks > 3 levels deep
- ❌ Copy-paste code instead of extracting function
- ❌ Skip tests "to save time"
- ❌ Commit broken code
- ❌ Push directly to main without PR (in team settings)

### Do This Instead
- ✅ Log errors with context, then throw/return
- ✅ Use specific types (string, number, CustomType)
- ✅ Return new values, don't mutate
- ✅ Extract into smaller, named functions
- ✅ Use async/await or Promises
- ✅ Extract to shared utility function
- ✅ Write tests first or immediately after
- ✅ Fix before committing
- ✅ Use feature branches + PR for review

## Tools and Linters

### Recommended Setup

**TypeScript:**
```json
{
  "extends": "@typescript-eslint/recommended",
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/explicit-function-return-type": "warn",
    "no-console": "warn"
  }
}
```

**Python:**
```ini
[tool:pytest]
testpaths = tests
python_files = test_*.py
python_functions = test_*
addopts = --cov=src --cov-report=html --cov-report=term

[mypy]
strict = true
warn_return_any = true
warn_unused_configs = true
```

### Run Before Every Commit
```bash
# TypeScript
npm run lint
npm run type-check
npm test

# Python
pylint src/
mypy src/
pytest --cov=src --cov-fail-under=80
```

## Tips

- **Write verify steps**: Tasks without verification may be marked complete without actually working
- **Test locally first**: If verification needs a running server, start it before Ralph runs
- **Keep verify steps simple**: One command, one expected result
- **Fail fast**: Put the most likely-to-fail verification first

## Philosophical Principles

1. **Simplicity over cleverness** - Code is read more than written
2. **Explicit over implicit** - Make intentions clear
3. **Working over perfect** - Ship working code, iterate
4. **Tested over untested** - Tests are documentation that code works
5. **Documented over undocumented** - Future you will thank present you
6. **Consistent over innovative** - Follow existing patterns in codebase

---

When in doubt, prioritize:
1. **Working code** - Does it work?
2. **Tested code** - How do we know it works?
3. **Readable code** - Can others understand it?
4. **Maintainable code** - Can it be changed safely?
5. **Performant code** - Is it fast enough?

In that order.
