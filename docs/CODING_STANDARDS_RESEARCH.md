# Coding Standards & Conventions Research

How AI coding agents handle code quality, linting, and conventions enforcement.

## Comparison Summary

| Tool | Convention System | Linting | How It Works |
|------|------------------|---------|--------------|
| **Open SWE** | Customizable (fork & modify) | ✅ Reviewer agent runs formatters/linters | Multi-agent: Programmer writes → Reviewer runs tests/formatters → reflects before PR |
| **SWE-agent** | YAML config | ✅ Built into edit function | Linter integrated into editor - invalid edits rejected, agent retries. 15% performance boost from linting |
| **Aider** | `CONVENTIONS.md` file | ✅ Auto-runs linter after changes | Load conventions via `--read CONVENTIONS.md`. Linter errors sent back to LLM for self-fix |
| **GitHub Copilot** | `.github/copilot-instructions.md` + `agents.md` | ✅ Runs CI checks | Per-path instructions, agent-specific rules, custom agents for docs/tests/security |
| **Sweep AI** | Config file | ✅ JetBrains static analysis | Stores lint/test commands, code style prefs, naming conventions in config |

---

## Open SWE (LangChain)

**Source**: [LangChain Blog](https://www.blog.langchain.com/introducing-open-swe-an-open-source-asynchronous-coding-agent/), [GitHub](https://github.com/langchain-ai/open-swe)

### Architecture
Open SWE uses a multi-agent architecture with dedicated Planner and Reviewer components:
- **Planner**: Researches the codebase to form a robust strategy first
- **Programmer**: Writes code, runs tests/linters, searches external docs as needed, iterating on errors
- **Reviewer**: Checks for common errors, runs tests and formatters, and reflects on the changes before ever opening a PR

### Customization
Because it's open source and built on LangGraph, teams can:
- Add new tools (e.g., internal APIs, custom linters)
- Adjust the multi-agent logic
- Fine-tune prompts to match house style, test conventions, and architectural guidelines

### Example Use Case
> "Add CI check to ensure commit messages follow Conventional Commits across monorepo."
>
> The Planner drafts steps to modify CI config, add a linter/hook, and update docs and tests.

### Key Insight
MIT-licensed, so teams can fork, swap in their own LLM keys, and add proprietary linters or internal API calls without waiting for vendor roadmaps.

---

## SWE-agent (Princeton)

**Source**: [arXiv Paper](https://arxiv.org/pdf/2405.15793), [GitHub](https://github.com/SWE-agent/SWE-agent)

### Lint-on-Edit Architecture
Similar to how humans use syntax highlighting to notice format errors in an IDE, SWE-agent integrates a code linter into the edit function to alert the agent of mistakes it may have introduced.

**How it works:**
1. Agent makes an edit
2. Linter runs immediately
3. Select errors shown to agent along with file contents before/after
4. **Invalid edits are discarded** - agent asked to retry
5. Only clean edits are applied

### Performance Impact
> "This intervention improves performance considerably (without linting, 15.0% ↓3.0)"

### Guardrails for Error Recovery
A prominent failure mode occurs when models repeatedly edit the same code snippet. The usual suspect is an agent introducing a syntax error (incorrect indentation, extra parenthesis) via an errant edit.

SWE-agent adds an intervention to the edit logic that lets a modification apply **only if it does not produce major errors**.

### Key Insight
Preventing errors is better than fixing them. Rejecting bad edits before they're applied prevents cascading failures.

---

## Aider

**Source**: [Aider Conventions Docs](https://aider.chat/docs/usage/conventions.html), [GitHub](https://github.com/Aider-AI/aider)

### Convention Files
The easiest way to specify coding conventions is to create a markdown file and include it in the chat:

```markdown
# CONVENTIONS.md

- Use TypeScript strict mode
- Prefer functional components over class components
- Use named exports, not default exports
- All functions must have JSDoc comments
```

**Loading conventions:**
```bash
# One-time
aider --read CONVENTIONS.md

# Or in .aider.conf.yml
read: CONVENTIONS.md

# Multiple files
read: [CONVENTIONS.md, STYLE_GUIDE.md]
```

Best practice: Load with `/read` so it's marked read-only and cached if prompt caching is enabled.

### Lint-then-Fix Loop
Aider can automatically lint and test your code every time it makes changes:

1. Edit applied
2. Linter/tests run
3. Errors sent back to LLM
4. LLM attempts fix
5. Repeat until clean or human intervention

> "When linters fail or tests break, agentic tools like Aider read the error output, diagnose the issue, modify code, and retry—autonomously, in a loop, until success."

### AGENTS.md Standard
There's an emerging "Agent Rules" initiative proposing a unified standard:
- Single `AGENTS.md` file in project root
- Shared natural language rules
- Minimalist spec inspired by SemVer, EditorConfig, and Conventional Commits

### Key Insight
Convention files are simple, flexible, and work with prompt caching. Natural language rules are easier to maintain than complex config.

---

## GitHub Copilot Agent

**Source**: [GitHub Docs](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot), [GitHub Blog](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/)

### Custom Instructions Files

**Main instructions file:**
```
.github/copilot-instructions.md
```

Contains:
- How to build and test the project
- Coding standards and conventions
- Project-specific context

**Per-path instructions:**
```
.github/instructions/frontend.instructions.md
.github/instructions/backend.instructions.md
```

Use `applyTo` property to specify paths:
```yaml
---
applyTo: "src/frontend/**"
---
Use React functional components with hooks.
```

### Agent-Specific Instructions (Nov 2025)
Target instructions for specific agents:
```yaml
---
excludeAgent: "code-review"  # Hide from code review
excludeAgent: "coding-agent"  # Hide from coding agent
---
```

### Custom Agents (agents.md)
Define specialized agents in `agents.md`:
- `@docs-agent` for technical writing
- `@test-agent` for quality assurance
- `@security-agent` for security analysis

Each agent has:
- Persona definition
- Tech stack context
- Project file structure
- Workflows and commands

### Repository Structure
```
.github/
├── copilot-instructions.md      # Main instructions
├── instructions/
│   ├── frontend.instructions.md  # Per-path rules
│   └── backend.instructions.md
└── agents/                       # Custom agents
    └── test-agent.md

AGENTS.md                         # Root-level (works with other AI tools)
```

### Key Insight
Per-path instructions allow different conventions for different parts of the codebase. Custom agents create specialized reviewers.

---

## Sweep AI

**Source**: [Sweep Docs](https://docs.sweep.dev/), [GitHub](https://github.com/sweepai/sweep)

### Configuration
Sweep uses a config file storing:
- Frequently used commands (build, test, lint)
- Code style preferences
- Naming conventions
- Formatting rules

### Linting Approach
- Integrated agent searches codebase, edits code, runs tests/checks
- Uses JetBrains internal static analysis tools
- Can use terminal to run git, edit files, use PyCharm linter

### Platform Focus
Now focused on JetBrains IDEs:
- IntelliJ IDEA
- PyCharm
- WebStorm
- Rider
- GoLand

### Key Insight
Deep IDE integration allows using existing static analysis tools rather than building custom linting.

---

## Key Patterns

### Pattern 1: Convention Files
**Used by**: Aider, GitHub Copilot, Sweep

Simple markdown files with natural language rules:
```markdown
# Conventions

- Use TypeScript strict mode
- Prefer composition over inheritance
- All public functions need tests
```

**Pros**: Easy to write, easy to maintain, works with prompt caching
**Cons**: Relies on LLM following instructions (not enforced)

### Pattern 2: Lint-on-Edit Rejection
**Used by**: SWE-agent

Linter runs immediately after each edit. Invalid edits rejected before applied.

**Pros**: Prevents cascading errors, 15% performance improvement
**Cons**: More complex implementation, may slow down iteration

### Pattern 3: Lint-then-Fix Loop
**Used by**: Aider, Open SWE

Edit applied → linter runs → errors sent to LLM → LLM fixes → repeat.

**Pros**: Simpler implementation, self-healing
**Cons**: May take multiple iterations, errors can cascade

### Pattern 4: Multi-Agent Review
**Used by**: Open SWE, GitHub Copilot

Separate reviewer agent runs after programmer agent.

**Pros**: Separation of concerns, specialized review
**Cons**: Additional latency, more complex orchestration

### Pattern 5: Per-Path Rules
**Used by**: GitHub Copilot

Different conventions for different directories.

**Pros**: Frontend and backend can have different rules
**Cons**: More files to maintain

---

## Recommendations for Whim

Based on this research, Whim could adopt:

| Pattern | Implementation | Priority |
|---------|----------------|----------|
| **Convention file** | `.whim/conventions.md` loaded into Ralph context | High |
| **Lint-on-edit rejection** | Block commits with lint errors in worker | Medium |
| **Multi-agent review** | Verification worker (already planned) | Already in spec |
| **Per-path rules** | Different conventions for monorepo packages | Low |

### Proposed Convention File Location
```
target-repo/
├── .whim/
│   └── config.yml          # Verification settings (existing)
│   └── conventions.md      # Coding standards (new)
```

### Convention File Format
```markdown
# Project Conventions

## Language & Style
- TypeScript strict mode required
- Use ESLint + Prettier defaults
- Prefer functional patterns

## Testing
- All new functions need unit tests
- Use Vitest for testing
- Aim for 80% coverage on new code

## Git
- Conventional commits required
- One logical change per commit

## Architecture
- Keep components under 200 lines
- Use dependency injection for services
```

---

## Sources

- [Open SWE - LangChain Blog](https://www.blog.langchain.com/introducing-open-swe-an-open-source-asynchronous-coding-agent/)
- [Open SWE - GitHub](https://github.com/langchain-ai/open-swe)
- [SWE-agent Paper](https://arxiv.org/pdf/2405.15793)
- [SWE-agent - GitHub](https://github.com/SWE-agent/SWE-agent)
- [Aider Conventions Docs](https://aider.chat/docs/usage/conventions.html)
- [Aider - GitHub](https://github.com/Aider-AI/aider)
- [GitHub Copilot Custom Instructions](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot)
- [How to Write a Great agents.md](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/)
- [Sweep AI Docs](https://docs.sweep.dev/)
- [Sweep AI - GitHub](https://github.com/sweepai/sweep)
