---
name: create-spec
description: Create a SPEC.md through structured interview and LLM review. Use this when starting a new project or feature.
context: fork
allowed-tools: Read, Write, Edit, AskUserQuestion, Task
---

# Create SPEC Skill

Create a well-structured SPEC.md through guided interview and quality review.

## Workflow

```
Interview → Generate → Review → Finalize
```

## Step 1: Interview

Use **AskUserQuestion** to gather requirements in batches. Don't generate the spec until you have enough context.

### Batch 1: Project Foundation

```typescript
AskUserQuestion({
  questions: [
    {
      question: "What type of project is this?",
      header: "Type",
      multiSelect: false,
      options: [
        { label: "CLI tool", description: "Command-line application" },
        { label: "Web API", description: "REST/GraphQL backend" },
        { label: "Library", description: "Reusable package" },
        { label: "Full-stack", description: "Frontend + backend" }
      ]
    },
    {
      question: "What language/framework?",
      header: "Stack",
      multiSelect: false,
      options: [
        { label: "TypeScript/Node.js (Recommended)", description: "Modern JS with types" },
        { label: "Python", description: "Great for data, ML, scripting" },
        { label: "Go", description: "Fast, good for systems" },
        { label: "Rust", description: "Memory-safe systems" }
      ]
    }
  ]
})
```

### Batch 2: Core Requirements

Ask about:
- Primary use case (what problem does it solve?)
- Target users (who will use this?)
- Core features (what must it do?)
- External integrations (APIs, databases, services?)

### Batch 3: Quality & Constraints

Ask about:
- Testing expectations (unit only / unit+integration / full)
- Auth requirements (none / basic / OAuth / custom)
- Performance constraints (if any)
- Timeline/priority (MVP vs full feature set)

### Interview Tips

- Ask follow-up questions if answers are vague
- Dig into edge cases: "What happens when X fails?"
- Clarify scope: "Is Y a must-have or nice-to-have?"
- Don't proceed until you understand the core requirements

## Step 2: Generate SPEC

Write `SPEC.md` following these rules:

### Structure

```markdown
# Project Name

Brief description (1-2 sentences).

## Goal
What this project achieves when complete.

## Tasks

### Phase 1: Foundation
- [ ] Task description
  - Deliverable 1
  - Deliverable 2

### Phase 2: Core Features
- [ ] Another task
  - Deliverable 1
```

### Task Rules

**Each checkbox = one Ralph iteration.** Batch related work.

```markdown
# BAD - 4 iterations
- [ ] Create UserModel.ts
- [ ] Create UserService.ts
- [ ] Create UserController.ts
- [ ] Create user.test.ts

# GOOD - 1 iteration
- [ ] Create User module (Model, Service, Controller) with tests
```

### What SPECs Must NOT Include

SPECs describe **requirements**, not solutions.

**Never include:**
- Code snippets or implementation examples
- File:line references (e.g., `auth.ts:42`)
- Shell commands (`npm install X`, `git log`)
- Root cause analysis ("The bug is because...")
- "Technical Notes" or "Fix Approach" sections
- Implementation instructions

**Sub-bullets are deliverables, not instructions:**

```markdown
# BAD - prescribes HOW
- [ ] Fix auth bug
  - Use `bcrypt.compare()` instead of `===`
  - Add try/catch at line 50

# GOOD - describes WHAT
- [ ] Fix auth bug
  - Password comparison should be timing-safe
  - Handle comparison errors gracefully
```

## Step 3: Review with LLM

After generating the spec, spawn a review agent to check for violations:

```typescript
Task({
  subagent_type: 'general-purpose',
  description: 'Review SPEC.md',
  prompt: `Review SPEC.md for convention violations.

Check for these anti-patterns:
1. Code snippets (any \`\`\` blocks with implementation code)
2. File:line references (e.g., setup.ts:150)
3. Shell commands in tasks (npm, git, docker, etc.)
4. "Technical Notes" or "Fix Approach" sections
5. Implementation instructions ("Use X to...", "Change line Y")

For each violation found:
- Quote the problematic line
- Explain why it's a violation
- Suggest a requirement-focused alternative

Respond with:
- PASS: No violations found
- FAIL: List each violation with fix suggestion`
})
```

### If Review Fails

1. Fix each violation the reviewer identified
2. Re-run the review
3. Only proceed when review passes

## Step 4: Finalize

After review passes:

1. Confirm with user: "SPEC is ready. Review it or start first iteration?"
2. Wait for explicit approval
3. Do NOT auto-start implementation

```markdown
✓ SPEC.md created with X tasks across Y phases
✓ Passed convention review

Ready to proceed? Say "start" to begin first iteration.
```

## Quick Reference

| Do | Don't |
|----|-------|
| Describe outcomes | Prescribe implementation |
| Use deliverable sub-bullets | Use instruction sub-bullets |
| Batch related tasks | Split tiny tasks |
| Keep it scannable | Add code examples |
| Run LLM review | Skip validation |
