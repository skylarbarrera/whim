# Using Ralph

Ralph is an autonomous AI coding loop. You write a SPEC, Ralph works through it task by task.

## Quick Start

1. **Create a SPEC.md** with your project requirements and tasks
2. **Run Ralph**: `ralph run` or `ralph run -n 5` for multiple iterations

## Project Structure

Ralph expects this structure:

```
your-project/
├── .claude/
│   └── ralph.md      # Coding standards (auto-created)
├── .ai/ralph/
│   ├── plan.md       # Current task plan (Ralph writes this)
│   └── index.md      # Commit history (Ralph appends here)
├── SPEC.md            # YOUR requirements (you write this)
├── STATE.txt      # Progress log (Ralph updates this)
└── src/              # Your code
```

## Writing a SPEC

Your SPEC.md should have checkboxes for tasks:

```markdown
# My Project

## Overview
Brief description of what you're building.

## Tasks

### Phase 1: Setup
- [ ] Initialize project with TypeScript and testing
- [ ] Set up database models (User, Post, Comment)

### Phase 2: Core Features
- [ ] Create authentication endpoints (register, login, logout)
- [ ] Build CRUD API for posts with tests

### Phase 3: Polish
- [ ] Add input validation and error handling
- [ ] Write API documentation
```

**Tips:**
- Batch related tasks: "Create components (Header, Footer, Nav)" not 3 separate tasks
- Include tests with implementation: "Create auth service with tests"
- Be specific: "Add JWT authentication" not "Add auth"

## Commands

```bash
ralph run              # Run one iteration
ralph run -n 5         # Run 5 iterations
ralph run --help       # See all options
```

## The Loop

Each iteration, Ralph:
1. Reads SPEC.md to find the next incomplete task
2. Writes a plan to .ai/ralph/plan.md
3. Implements the task with tests
4. Commits changes
5. Updates STATE.txt and .ai/ralph/index.md

## Tips

- **Clean git state**: Ralph requires no uncommitted changes before running
- **One task per iteration**: Don't expect multiple checkboxes done at once
- **Check STATE.txt**: See what's been done if you're unsure
- **Edit SPEC anytime**: Add/remove/reorder tasks between runs
