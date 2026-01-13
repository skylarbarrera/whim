---
name: ralph-iterate
description: Execute one Ralph iteration - load context, explore codebase, plan implementation, write code with tests, review changes, and commit. Use this skill to run a single autonomous coding iteration following the Ralph protocol.
context: fork
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, TodoWrite, LSP
---

# Ralph Iteration Protocol

Execute ONE complete Ralph iteration: read SPEC, plan, implement, test, review, commit.

**For coding standards** (language, style, testing, git, security), see `ralph.md`.

## Claude Code Native Features

This skill leverages Claude Code's native capabilities:

| Feature | Tool | When Used |
|---------|------|-----------|
| **Codebase Exploration** | `Task(Explore)` | Step 2 - understand code before planning |
| **Progress Tracking** | `TodoWrite` | Steps 1-6 - track sub-task completion |
| **Code Review** | `Task(general-purpose)` | Step 5 - pre-commit review |
| **Iteration Validation** | Stop Hook | After Step 6 - verify iteration complete |

## Creating SPECs

When a user asks to create a new SPEC, use **AskUserQuestion** to gather requirements before writing.

### Question Batches

**Batch 1: Technical Foundation**
```typescript
AskUserQuestion({
  questions: [
    {
      question: "What language and framework should we use?",
      header: "Stack",
      multiSelect: false,
      options: [
        { label: "TypeScript/Node.js (Recommended)", description: "Modern JS with type safety" },
        { label: "Python", description: "Great for data, ML, scripting" },
        { label: "Go", description: "Fast, good for systems" },
        { label: "Rust", description: "Memory-safe systems programming" }
      ]
    },
    {
      question: "What type of application?",
      header: "Type",
      multiSelect: false,
      options: [
        { label: "CLI tool", description: "Command-line application" },
        { label: "Web API", description: "REST/GraphQL backend" },
        { label: "Library", description: "Reusable package" },
        { label: "Full-stack", description: "Frontend + backend" }
      ]
    }
  ]
})
```

**Batch 2: Feature Scope**
- Core features (multiSelect: true)
- Authentication needed?
- External integrations?

**Batch 3: Quality Gates**
- Testing level (unit only / unit+integration / full)
- Documentation needs

### Interview Flow

1. Ask Batch 1 → understand technical constraints
2. Ask Batch 2 → scope features based on architecture
3. Ask Batch 3 → set quality expectations
4. Generate SPEC → create structured tasks
5. **STOP** → wait for user approval before implementing

### After SPEC Creation - CHECKPOINT

**CRITICAL: After creating a SPEC, STOP and wait for explicit user confirmation.**

Do NOT automatically proceed to implementation (Step 1: Load Context).

After writing SPEC.md:
1. Show the user a summary of what was created (task count, major milestones)
2. Ask: "The SPEC is ready. Would you like to review it first, or should I start the first iteration?"
3. Wait for explicit confirmation ("start", "begin", "yes", "proceed")

**Only proceed to implementation after the user confirms.**

Users may want to:
- Review and edit the SPEC
- Adjust task priorities
- Add more requirements
- Run `ralph run` manually later

## Writing SPECs

Optimize for **iteration efficiency**. Each checkbox = one Ralph iteration.

### Batch Related Tasks

```markdown
# BAD - 4 iterations
- [ ] Create UserModel.ts
- [ ] Create UserService.ts
- [ ] Create UserController.ts
- [ ] Create user.test.ts

# GOOD - 1 iteration
- [ ] Create User module (Model, Service, Controller) with tests
```

**Batch when:**
- Same directory or tightly coupled files
- Similar structure (4 similar components = 1 task)
- Tests go with implementation

**Don't batch when:**
- Different areas of codebase
- Complex logic needing focus
- Independent failure modes

## Step 1: Load Context

### 1.1 Read SPEC.md

Find the next incomplete task:
- Look for the first unchecked checkbox: `- [ ]`
- Skip checked items: `- [x]`
- A batched checkbox counts as ONE task (e.g., "Create components A, B, C" = 1 task)

```
Read SPEC.md → Find first `- [ ]` → This is your task for this iteration
```

### 1.2 Check STATE.txt (if needed)

Read `STATE.txt` when:
- Unsure if a task was partially completed
- Need to understand blockers from previous iterations
- Want to verify what was done vs what SPEC shows

Look for:
- ✅ entries (completed work)
- ⚠️ entries (blockers or issues)
- Last completion timestamp

### 1.3 Read Recent Context

Read **last 3-5 entries** from `.ai/ralph/index.md`:
- Extract file patterns (what files were recently changed)
- Note "next:" hints (what the previous iteration recommended)
- Understand recent architectural decisions

**Don't read the entire index** — only recent entries to stay context-efficient.

### 1.4 Break Down with TodoWrite

If the task has **3+ steps**, use TodoWrite to track sub-tasks:

```typescript
TodoWrite({
  todos: [
    {
      content: "Read existing auth code",
      activeForm: "Reading existing auth code",
      status: "pending"
    },
    {
      content: "Create login endpoint",
      activeForm: "Creating login endpoint",
      status: "pending"
    },
    {
      content: "Add input validation",
      activeForm: "Adding input validation",
      status: "pending"
    },
    {
      content: "Write unit tests",
      activeForm: "Writing unit tests",
      status: "pending"
    }
  ]
})
```

**Required fields:**
- `content`: Imperative form (what to do)
- `activeForm`: Present continuous (what's happening)
- `status`: "pending" | "in_progress" | "completed"

**Skip TodoWrite when:**
- Task is atomic (single file, single change)
- Task is documentation-only
- Task can be completed in under 3 steps

## Step 2: Explore (if needed)

Before writing your plan, spawn parallel exploration agents to understand unfamiliar parts of the codebase. This is faster than reading files sequentially and helps you make better architectural decisions.

### 2.1 When to Explore

**Explore when:**
- Working in a new area of the codebase
- Task involves multiple interconnected modules
- Unsure about existing patterns or conventions
- Need to understand how similar features were implemented

**Skip when:**
- Working on files you've modified recently
- Simple changes to isolated functions
- Task specifies exact file paths in SPEC
- Documentation-only changes

### 2.2 Spawn Parallel Agents

Use the Task tool with `subagent_type='Explore'` to spawn agents that search the codebase in parallel. **Send all Task calls in a single message** to run them concurrently:

```typescript
// Example: Exploring for an authentication feature
// Spawn all agents in ONE message (parallel execution)

Task({
  subagent_type: 'Explore',
  description: 'Find auth patterns',
  prompt: 'Find how authentication is implemented. Look for middleware, JWT handling, session management. Report file paths and key patterns.'
})

Task({
  subagent_type: 'Explore',
  description: 'Find test patterns',
  prompt: 'Find testing patterns for API endpoints. Look for test setup, mocking strategies, assertion patterns. Report examples I can follow.'
})

Task({
  subagent_type: 'Explore',
  description: 'Find error handling',
  prompt: 'Find error handling patterns. Look for custom error classes, error middleware, response formatting. Report the conventions used.'
})
```

### 2.3 What to Explore

Tailor your exploration prompts to your task:

| Need | Prompt Focus |
|------|--------------|
| **Architecture** | "How is [feature] structured? What files/modules are involved?" |
| **Patterns** | "What patterns are used for [X]? Show me examples." |
| **Dependencies** | "What does [module] depend on? What depends on it?" |
| **Conventions** | "What naming/file structure conventions are used?" |
| **Similar features** | "How is [existing similar feature] implemented?" |

### 2.4 Using Exploration Results

Once all agents complete:

1. **Wait for completion** — don't proceed until all agents return
2. **Extract file paths** — incorporate discovered paths into your plan's Files section
3. **Follow patterns** — use patterns the agents identify (don't invent new ones)
4. **Note concerns** — document any blockers or risks in your plan
5. **Update sub-tasks** — add/remove TodoWrite items based on findings

```
Exploration Results → Informs Plan → Guides Implementation
```

## Step 3: Plan

Write your plan to `.ai/ralph/plan.md` **before writing any code**. The plan is your contract for this iteration — it defines scope, prevents creep, and provides a clear completion target.

### 3.1 Write the Goal

The Goal is a **single sentence** that describes what this iteration accomplishes. It should be:
- **Specific**: Name the feature, component, or fix
- **Completable**: Something achievable in one iteration
- **Verifiable**: You can objectively confirm it's done

**Good goals:**
```markdown
## Goal
Add JWT token refresh endpoint that returns a new access token when given a valid refresh token.
```

```markdown
## Goal
Fix race condition in WebSocket reconnection that causes duplicate message handlers.
```

**Bad goals (too vague):**
```markdown
## Goal
Improve authentication.  ← What specifically? Add? Fix? Refactor?
```

```markdown
## Goal
Work on the API.  ← Which endpoint? What change?
```

### 3.2 List the Files

List every file you plan to create or modify with a brief note about what changes:

```markdown
## Files
- src/auth/refresh.ts - create token refresh endpoint
- src/auth/middleware.ts - add refresh token validation
- src/auth/types.ts - add RefreshTokenPayload type
- tests/auth/refresh.test.ts - unit tests for refresh flow
```

**Guidelines:**
- **Be explicit** — list actual file paths, not "auth files"
- **Include tests** — every implementation file should have a corresponding test file
- **Note the action** — "create", "modify", "add", "fix", "remove"
- **Use exploration results** — if Step 2 found patterns in specific files, reference them

If you're unsure which files need changes, your exploration in Step 2 was incomplete. Go back and explore more before planning.

### 3.3 Define the Tests

List specific test scenarios that prove your implementation works. These become your acceptance criteria:

```markdown
## Tests
- Returns new access token when refresh token is valid
- Returns 401 when refresh token is expired
- Returns 401 when refresh token is revoked
- Returns 400 when refresh token is malformed
- Rotates refresh token on successful refresh (one-time use)
```

**Guidelines:**
- **Cover happy path** — at least one test for the success case
- **Cover error cases** — invalid input, edge cases, failures
- **Be specific** — "handles errors" is not a test; "returns 404 when user not found" is
- **Match existing patterns** — look at how similar features are tested in the codebase

**Skip when:**
- Task is documentation-only
- Task is configuration/setup (no logic to test)
- Existing tests already cover the change

### 3.4 Set Exit Criteria

Exit criteria are the **checkboxes you must check** before committing. They combine your goal, tests, and any additional requirements:

```markdown
## Exit Criteria
- Refresh endpoint returns new tokens for valid requests
- All 5 test scenarios pass
- Type checking passes (`npm run type-check`)
- No new linting errors
- Changes committed with conventional message
```

**Standard exit criteria (include most of these):**
- Feature/fix works as described in Goal
- Tests pass with good coverage (80%+ for new code)
- Type checking passes (if TypeScript)
- No linting errors
- Changes committed

**Additional criteria (when applicable):**
- Documentation updated (for public APIs)
- Migration added (for database changes)
- Environment variables documented (for new config)

### Complete Plan Example

```markdown
## Goal
Add JWT token refresh endpoint that returns a new access token when given a valid refresh token.

## Files
- src/auth/refresh.ts - create token refresh endpoint
- src/auth/middleware.ts - add refresh token validation helper
- src/auth/types.ts - add RefreshTokenPayload interface
- tests/auth/refresh.test.ts - unit tests

## Tests
- Returns new access token when refresh token is valid
- Returns 401 when refresh token is expired
- Returns 401 when refresh token is revoked
- Returns 400 when refresh token is malformed
- Rotates refresh token on successful refresh

## Exit Criteria
- Refresh endpoint works for valid requests
- All 5 test scenarios pass
- Type checking passes
- Changes committed
```

### After Writing the Plan

1. **Review scope** — Is this achievable in one iteration? If not, split the task.
2. **Update TodoWrite** — Add sub-tasks based on your Files list if not done in Step 1.
3. **Proceed to implementation** — Only start coding after the plan is written.

## Step 4: Implement

Now execute your plan. Write the code, write the tests, and verify everything works before proceeding to review.

### 4.1 Write the Code

Follow your plan's Files section. For each file:

1. **Read first** — Understand existing code before modifying
2. **Follow patterns** — Match the codebase's style, conventions, and architecture
3. **Keep it simple** — Don't over-engineer or add features beyond the plan
4. **Update TodoWrite** — Mark sub-task as `in_progress` when you start

```typescript
// Before starting a sub-task:
TodoWrite({
  todos: [
    { content: "Create login endpoint", activeForm: "Creating login endpoint", status: "in_progress" },
    { content: "Add input validation", activeForm: "Adding input validation", status: "pending" },
    // ...
  ]
})
```

**Implementation order:**
1. Types/interfaces first (if TypeScript)
2. Core logic
3. Integration points (exports, routes, etc.)
4. Tests (or write alongside — see 4.2)

**Avoid:**
- Adding comments unless truly necessary (code should be self-documenting)
- Creating new patterns when existing patterns work
- Scope creep — if you discover something outside the plan, note it for the next iteration

### 4.2 Write the Tests

Write tests that match your plan's Tests section. Each test scenario becomes a test case.

**Test structure:**
```typescript
describe('RefreshToken', () => {
  describe('refresh', () => {
    it('returns new access token when refresh token is valid', async () => {
      // Arrange - set up test data
      const refreshToken = createValidRefreshToken();

      // Act - call the function
      const result = await refresh(refreshToken);

      // Assert - verify the outcome
      expect(result.accessToken).toBeDefined();
      expect(result.expiresIn).toBe(3600);
    });

    it('returns 401 when refresh token is expired', async () => {
      const expiredToken = createExpiredRefreshToken();

      await expect(refresh(expiredToken))
        .rejects.toThrow(UnauthorizedError);
    });
  });
});
```

**Guidelines:**
- **One assertion per test** (when practical) — easier to debug failures
- **Descriptive names** — test name should describe the scenario
- **Cover the plan** — every test in your Tests section should become a real test
- **Match existing patterns** — look at how similar features are tested

**Update TodoWrite after writing tests:**
```typescript
TodoWrite({
  todos: [
    { content: "Create login endpoint", activeForm: "Creating login endpoint", status: "completed" },
    { content: "Add input validation", activeForm: "Adding input validation", status: "completed" },
    { content: "Write unit tests", activeForm: "Writing unit tests", status: "in_progress" },
    // ...
  ]
})
```

### 4.3 Run Tests

Run the full test suite to verify your implementation:

```bash
# Standard commands (use project-specific if different)
npm test                    # Run all tests
npm test -- --coverage      # Run with coverage report
npm test -- path/to/file    # Run specific test file
```

**What to check:**
- All tests pass (especially your new ones)
- No regressions in existing tests
- Coverage meets requirements (80%+ for new code)

**If tests fail:**
1. Read the error message carefully
2. Fix the failing test or implementation
3. Re-run tests
4. Don't proceed until all tests pass

### 4.4 Run Type Check

For TypeScript projects, verify types before proceeding:

```bash
npm run type-check          # or: npx tsc --noEmit
```

**Common type errors and fixes:**

| Error | Fix |
|-------|-----|
| `Property does not exist` | Add the property to the interface or check for typos |
| `Type X is not assignable to Y` | Fix the type mismatch or add proper type casting |
| `Cannot find module` | Check import path or add missing dependency |
| `Argument of type X is not assignable` | Update function signature or caller |

**Don't proceed with type errors.** They often indicate real bugs.

### 4.5 Handle Failures

If tests or type checking fail repeatedly:

1. **Don't force it** — Repeated failures signal a deeper issue
2. **Check your plan** — Did you miss something in the Files section?
3. **Revisit exploration** — Maybe you need more context
4. **Scope down** — Can you complete a smaller portion of the task?

**If blocked:**
```typescript
// Update TodoWrite to reflect the blocker
TodoWrite({
  todos: [
    { content: "Create login endpoint", activeForm: "Creating login endpoint", status: "completed" },
    { content: "Fix type error in auth middleware", activeForm: "Fixing type error", status: "in_progress" },
    // Don't mark as completed if you can't finish it
  ]
})
```

If you can't complete the task:
- Don't commit partial/broken code
- Document the blocker in STATE.txt
- Stop the iteration — the next iteration will pick it up

### Implementation Checklist

Before proceeding to Review:

- [ ] All planned files created/modified
- [ ] Code follows existing patterns
- [ ] Tests written for all planned scenarios
- [ ] `npm test` passes
- [ ] `npm run type-check` passes (TypeScript)
- [ ] TodoWrite sub-tasks marked as completed

## Step 5: Review

Before committing, spawn a review agent to catch bugs, verify patterns, and ensure quality. This step prevents shipping broken code and helps maintain codebase consistency.

### 5.1 When to Review

**Review when:**
- You wrote more than 20 lines of new code
- You modified existing business logic
- You added or changed API endpoints
- You made security-relevant changes (auth, validation, encryption)
- You're uncertain about your implementation approach

**Skip when:**
- Task is documentation-only
- Changes are config/setup files only
- Changes are purely stylistic (formatting, renaming)
- You only deleted code without adding anything new

### 5.2 Spawn Review Agent

Use the Task tool with `subagent_type='general-purpose'` to spawn a review agent. Provide context about the task and list the files you changed:

```typescript
Task({
  subagent_type: 'general-purpose',
  description: 'Review code changes',
  prompt: `Review the following code changes for: [TASK DESCRIPTION]

## Files Changed
- [file1.ts] - [what was changed]
- [file2.ts] - [what was changed]
- [file.test.ts] - [tests added]

## Review Checklist
Please check for:
1. **Bugs** - Logic errors, off-by-one, null handling, race conditions
2. **Test coverage** - Are edge cases tested? Any missing scenarios?
3. **Patterns** - Does the code follow existing codebase patterns?
4. **Security** - Input validation, injection risks, auth bypasses
5. **Performance** - N+1 queries, unnecessary loops, memory leaks

## Response Format
Respond with ONE of:
- **CRITICAL**: Must-fix issues that would cause bugs or security problems
- **SUGGESTIONS**: Optional improvements (style, naming, minor optimizations)
- **APPROVED**: Code is ready to commit

If CRITICAL, list each issue with file:line and a brief fix description.`
})
```

**Customize the prompt for your task:**
- For API changes, emphasize validation and error handling
- For database changes, emphasize migrations and query performance
- For auth changes, emphasize security review
- For UI changes, emphasize user experience and accessibility

### 5.3 Handle Review Feedback

The review agent will respond with one of three outcomes:

| Response | Action |
|----------|--------|
| **CRITICAL** | **Must fix** - Address every critical issue before committing |
| **SUGGESTIONS** | **Optional** - Address if quick (<5 min), otherwise note for future |
| **APPROVED** | **Proceed** - Move to Step 6 (Commit) |

**Handling CRITICAL feedback:**

1. **Read the issues** - Each critical issue should include file:line and description
2. **Fix in priority order** - Security > Bugs > Breaking changes
3. **Re-run tests** - Ensure fixes didn't break anything
4. **Re-run type check** - Ensure fixes don't introduce type errors
5. **Request re-review** - Spawn another review agent to verify fixes

```typescript
// After fixing critical issues, re-review:
Task({
  subagent_type: 'general-purpose',
  description: 'Re-review fixes',
  prompt: `Re-review after fixing critical issues.

## Original Issues (now fixed)
- [Issue 1]: Fixed by [change]
- [Issue 2]: Fixed by [change]

## Files Changed
- [file1.ts] - [original change + fix]

Verify fixes are correct. Respond: CRITICAL, SUGGESTIONS, or APPROVED.`
})
```

**Handling SUGGESTIONS:**

Suggestions are optional but valuable:
- Address if the fix is quick (< 5 minutes)
- Skip if the suggestion is stylistic preference
- Note valuable suggestions in your commit message or index.md for future iterations

### 5.4 Review Flow Example

```
Implementation Complete
         │
         ▼
┌─────────────────────┐
│  Spawn Review Agent │
└─────────────────────┘
         │
         ▼
    ┌─────────┐
    │ RESULT? │
    └─────────┘
         │
    ┌────┼────┬────────────┐
    │    │    │            │
    ▼    │    ▼            ▼
CRITICAL │  SUGGESTIONS  APPROVED
    │    │    │            │
    ▼    │    ▼            ▼
  Fix    │  Optional    Proceed
 Issues  │   Fixes      to Commit
    │    │    │            │
    ▼    │    ▼            │
Re-review│  Proceed        │
    │    │    │            │
    └────┴────┴────────────┘
                   │
                   ▼
            Step 6: Commit
```

### 5.5 Update TodoWrite

After review completes, update your sub-tasks:

```typescript
TodoWrite({
  todos: [
    { content: "Write implementation code", activeForm: "Writing code", status: "completed" },
    { content: "Write unit tests", activeForm: "Writing tests", status: "completed" },
    { content: "Run tests and type check", activeForm: "Running verification", status: "completed" },
    { content: "Code review", activeForm: "Reviewing code", status: "completed" },
    { content: "Commit changes", activeForm: "Committing", status: "pending" }
  ]
})
```

### Review Checklist

Before proceeding to Commit:

- [ ] Review agent spawned with appropriate context
- [ ] All CRITICAL issues addressed
- [ ] Tests still pass after any fixes
- [ ] Type check still passes after any fixes
- [ ] Response is APPROVED or SUGGESTIONS-only

## Step 6: Commit

After your implementation passes review, commit your changes and update the tracking files. This step completes the iteration and leaves a clean trail for the next one.

### 6.1 Stage Your Changes

Stage only the files listed in your plan. Don't stage unrelated changes:

```bash
# Stage specific files (preferred)
git add src/auth/refresh.ts src/auth/types.ts tests/auth/refresh.test.ts

# Or stage all tracked changes if you're certain
git add -A
```

**Pre-stage checklist:**
- [ ] Only files from your plan's Files section
- [ ] No temporary files, logs, or build artifacts
- [ ] No `.env` files or secrets
- [ ] No unintended formatting changes in other files

**Check what you're committing:**
```bash
git status        # See staged files
git diff --staged # Review staged changes
```

### 6.2 Write the Commit Message

Use [Conventional Commits](https://www.conventionalcommits.org/) format. Always use a HEREDOC for proper multi-line formatting:

```bash
git commit -m "$(cat <<'EOF'
type(scope): brief description

Longer explanation if needed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

**Commit types:**
| Type | Use for |
|------|---------|
| `feat` | New feature or functionality |
| `fix` | Bug fix |
| `refactor` | Code change that doesn't add feature or fix bug |
| `test` | Adding or updating tests |
| `docs` | Documentation only |
| `chore` | Maintenance tasks, dependency updates |

**Examples:**
```
feat(auth): add JWT token refresh endpoint
fix(api): handle null response from user service
refactor(utils): extract validation into shared module
test(auth): add edge case tests for token expiry
docs(readme): add API documentation
```

**Scope guidelines:**
- Use the feature area or module name: `auth`, `api`, `ui`, `db`
- Keep it lowercase and short (1-2 words)
- Be consistent with existing commits in the repo

### 6.3 Update index.md

After committing, append an entry to `.ai/ralph/index.md`. This creates a searchable history of what each iteration accomplished.

**Get your commit SHA:**
```bash
git log -1 --format='%h'  # Short SHA (7 chars)
```

**Entry format:**
```markdown
## {sha} — {commit message}
- files: {list of changed files}
- tests: {test count} passing
- notes: {key decisions, patterns used, gotchas}
- next: {logical follow-up task or recommendation}
```

**Example entry:**
```markdown
## a1b2c3d — feat(auth): add JWT token refresh endpoint
- files: src/auth/refresh.ts, src/auth/types.ts, tests/auth/refresh.test.ts
- tests: 8 passing
- notes: Used existing JWT library, added refresh token rotation for security
- next: Add token revocation endpoint for logout
```

**Guidelines:**
- **Keep it concise** — 5-7 lines max per entry
- **files**: List actual filenames, not directories
- **tests**: Include count (get from `npm test` output)
- **notes**: Capture decisions future iterations need to know
- **next**: Suggest what should come next (helps the next iteration)

### 6.4 Update SPEC.md

Check off the completed task in `SPEC.md`:

```markdown
# Before
- [ ] Add JWT token refresh endpoint with tests

# After
- [x] Add JWT token refresh endpoint with tests
```

**Rules:**
- Only check off tasks that are **fully complete**
- One checkbox = one iteration (don't check multiple)
- If you couldn't complete the task, leave it unchecked

### 6.5 Update STATE.txt

Append a completion record to `STATE.txt`:

```markdown
✅ YYYY-MM-DD: {Brief description of what was done}
  - {Key detail 1}
  - {Key detail 2}
  - Tests: {count} passing
  - Commit: {sha} {commit message}
```

**Example:**
```markdown
✅ 2026-01-12: Added JWT token refresh endpoint
  - Created refresh.ts with token validation and rotation
  - Added RefreshTokenPayload interface to types.ts
  - Tests: 8 passing (refresh.test.ts)
  - Commit: a1b2c3d feat(auth): add JWT token refresh endpoint
```

**If task was blocked:**
```markdown
⚠️ 2026-01-12: JWT token refresh - BLOCKED
  - Issue: Existing JWT library doesn't support refresh tokens
  - Attempted: Custom implementation but hit type conflicts
  - Next: Evaluate alternative JWT libraries
```

### 6.6 Update TodoWrite

Complete all sub-tasks:

```typescript
TodoWrite({
  todos: [
    { content: "Write implementation code", activeForm: "Writing code", status: "completed" },
    { content: "Write unit tests", activeForm: "Writing tests", status: "completed" },
    { content: "Run tests and type check", activeForm: "Running verification", status: "completed" },
    { content: "Code review", activeForm: "Reviewing code", status: "completed" },
    { content: "Commit changes", activeForm: "Committing", status: "completed" }
  ]
})
```

**After updating:**
- All sub-tasks should be `completed`
- The TodoWrite list shows the user the iteration is done
- Clear the list for the next iteration (or let the next iteration reset it)

### Commit Checklist

Before considering this iteration complete:

- [ ] All planned files are staged
- [ ] No unintended files staged (run `git status`)
- [ ] Commit message follows conventional format
- [ ] Commit message uses HEREDOC (no escaping issues)
- [ ] `.ai/ralph/index.md` has new entry with correct SHA
- [ ] `SPEC.md` task is checked off: `- [x]`
- [ ] `STATE.txt` has completion record
- [ ] TodoWrite sub-tasks marked completed

### Commit Flow Example

```
Tests Pass + Review Approved
           │
           ▼
┌────────────────────────┐
│  git add [files]       │
│  git status (verify)   │
└────────────────────────┘
           │
           ▼
┌────────────────────────┐
│  git commit with       │
│  HEREDOC message       │
└────────────────────────┘
           │
           ▼
┌────────────────────────┐
│  Get SHA: git log -1   │
│  Append to index.md    │
└────────────────────────┘
           │
           ▼
┌────────────────────────┐
│  Update SPEC.md        │
│  - [ ] → - [x]         │
└────────────────────────┘
           │
           ▼
┌────────────────────────┐
│  Update STATE.txt      │
│  ✅ completion record  │
└────────────────────────┘
           │
           ▼
┌────────────────────────┐
│  TodoWrite: all        │
│  status: "completed"   │
└────────────────────────┘
           │
           ▼
      ITERATION DONE
```

## Hard Rules

- ONE task per iteration (batched checkbox = one task)
- Plan BEFORE coding
- Tests MUST pass before commit
- No commit = no index entry
- Mark SPEC task complete only after commit

## Hooks Configuration

Ralph uses a **Stop hook** to validate iteration completion. Configure in `.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "type": "prompt",
        "promptFile": "scripts/validate-iteration.md"
      }
    ]
  }
}
```

**What the hook validates:**
1. Task implemented (code changes made)
2. Tests pass (`npm test`)
3. Type check passes (`npm run type-check`)
4. Commit made with conventional message
5. `index.md` updated with new entry
6. `SPEC.md` task checked off
7. `STATE.txt` has completion record

**If validation fails:** Fix the issue before the next iteration starts.
