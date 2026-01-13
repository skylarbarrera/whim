# Ralph Coding Standards

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

### Iteration Protocol

For the full iteration protocol (loading context, exploring codebase, planning, implementing, reviewing, and committing), use the `/ralph-iterate` skill. It contains detailed guidance for:
- Creating SPECs with structured interviews
- Using Task(Explore) agents for codebase understanding
- Writing plans to `.ai/ralph/plan.md`
- Code review before committing
- Tracking progress with TodoWrite
- Updating tracking files (index.md, STATE.txt)

## Anti-Patterns to Avoid

### Don't Do This
- Catch and ignore errors without logging
- Use `any` type in TypeScript
- Mutate function parameters
- Write god functions (> 100 lines)
- Nest callbacks > 3 levels deep
- Copy-paste code instead of extracting function
- Skip tests "to save time"
- Commit broken code
- Push directly to main without PR (in team settings)

### Do This Instead
- Log errors with context, then throw/return
- Use specific types (string, number, CustomType)
- Return new values, don't mutate
- Extract into smaller, named functions
- Use async/await or Promises
- Extract to shared utility function
- Write tests first or immediately after
- Fix before committing
- Use feature branches + PR for review

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
