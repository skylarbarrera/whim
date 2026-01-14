# AI PR Review Integration

## Executive Summary

Add AI-powered code review to AI Factory that analyzes pull requests for spec alignment and code quality, posting findings as advisory PR comments. This completes the feedback loop where AI-generated code gets AI review before human merge.

## Problem Statement

AI Factory creates PRs from GitHub issues but provides no quality feedback before human review. Humans must manually verify that:
- Implementation matches the original SPEC.md requirements
- Code follows quality patterns (complexity, naming, potential bugs)

This creates review burden and risks merged PRs that drift from requirements.

## Success Criteria

- [x] Every AI-generated PR receives an AI review comment within 60 seconds of worker completion
- [x] Review comment clearly shows spec alignment assessment
- [x] Review comment identifies code quality concerns
- [x] Reviews can be retriggered manually via GitHub Actions
- [ ] Review history is visible in dashboard

## User Journey

### Primary Flow (Automatic)
1. Worker completes implementation
2. Worker generates diff of changes
3. Worker calls Claude API with diff + SPEC.md
4. Claude returns structured review findings
5. Worker posts findings as single PR comment
6. Worker creates PR (continues regardless of review outcome)
7. Human sees review comment when viewing PR

### Retrigger Flow (Manual)
1. Human pushes changes to PR branch
2. Human goes to Actions tab → "AI Review" workflow
3. Human clicks "Run workflow" → selects PR branch
4. Action fetches diff + SPEC, calls Claude API
5. Action posts new review comment to PR

## Functional Requirements

### Must Have (P0)

#### AI Review Function
- Accept inputs: git diff, SPEC.md content
- Call Claude API (Anthropic SDK)
- Model: configurable via env var, default `claude-sonnet-4-20250514`
- Return structured findings:
  ```typescript
  interface ReviewFindings {
    specAlignment: {
      score: 'aligned' | 'partial' | 'misaligned';
      summary: string;
      gaps: string[];      // Requirements not implemented
      extras: string[];    // Things implemented not in spec
    };
    codeQuality: {
      score: 'good' | 'acceptable' | 'needs-work';
      summary: string;
      concerns: Array<{
        file: string;
        line?: number;
        issue: string;
        suggestion: string;
      }>;
    };
    overallSummary: string;
  }
  ```

#### Worker Integration
- Location: `packages/worker/src/review.ts` (new file)
- Called after implementation, before PR creation
- Generates diff: `git diff origin/main...HEAD`
- Reads SPEC.md from workspace
- Posts comment via GitHub API (`gh pr comment` or Octokit)
- Records review in database (pr_reviews table)
- Continues to PR creation regardless of review success/failure

#### GitHub Action for Retrigger
- File: `.github/workflows/ai-review.yml`
- Trigger: `workflow_dispatch` with branch input
- Steps:
  1. Checkout PR branch
  2. Generate diff vs main
  3. Read SPEC.md
  4. Call review function
  5. Post comment to PR

#### PR Comment Format
```markdown
## AI Review

### Spec Alignment: {score}
{summary}

**Gaps:** {list or "None"}
**Unexpected additions:** {list or "None"}

### Code Quality: {score}
{summary}

{concerns as list with file:line references}

---
*Reviewed by AI Factory • [Retrigger review](link-to-action)*
```

### Should Have (P1)

#### Database Tracking
- Use existing `pr_reviews` table schema
- Record: PR number, review timestamp, findings JSON, model used
- Link to work_item via `work_item_id`

#### Dashboard Integration
- Keep existing dashboard pages from PR #9
- Display review history per PR
- Show spec alignment and quality scores

### Nice to Have (P2)

#### Review Caching
- Don't re-review if diff hasn't changed
- Store diff hash, skip if matches

#### Configurable Review Focus
- ENV vars or config to adjust review prompt
- e.g., `REVIEW_FOCUS=security` for security-heavy review

## Technical Architecture

### New Components

```
packages/worker/src/review.ts     # AI review function
packages/worker/src/prompts/      # Review prompt templates
.github/workflows/ai-review.yml   # Retrigger action
```

### Modified Components

```
packages/worker/src/index.ts      # Add review step before PR creation
packages/worker/src/setup.ts      # Call review, post comment
```

### Data Flow

```
Worker completes implementation
         ↓
    git diff origin/main...HEAD
         ↓
    Read SPEC.md from workspace
         ↓
    POST /v1/messages (Claude API)
         ↓
    Parse response → ReviewFindings
         ↓
    Format as markdown comment
         ↓
    gh pr comment (if PR exists) OR store for after PR creation
         ↓
    INSERT INTO pr_reviews
         ↓
    Continue to PR creation
```

### Claude API Prompt Structure

```
System: You are a code reviewer for AI-generated pull requests.
Analyze the diff against the specification and provide structured feedback.

User:
## Specification (SPEC.md)
{spec_content}

## Git Diff
{diff_content}

## Instructions
1. Assess spec alignment: Are all requirements implemented? Any extras?
2. Review code quality: Complexity, naming, potential bugs, patterns
3. Be specific with file:line references where possible
4. Output as JSON matching the ReviewFindings schema
```

## Cleanup Tasks

### Delete from `packages/pr-review/`
- `src/checks/` directory (lint-check.ts, test-check.ts, base-check.ts)
- `src/lint-runner.ts`
- `src/test-runner.ts`
- `src/merge-guardian.ts` (no merge blocking)
- `src/branch-protection.ts` (not needed)
- Related test files

### Keep from `packages/pr-review/`
- `src/tracker.ts` - review tracking
- `src/detector.ts` - AI PR detection (for retrigger filtering)
- `src/github-status.ts` - posting comments
- `src/config.ts` - may adapt for review config
- Database migration (002_pr_reviews.sql)
- Dashboard pages

### Fix
- `src/detector.ts` line 25: Change `Claude Sonnet 4.5` → `Claude Opus 4.5`

## Non-Functional Requirements

- **Latency**: Review should complete in <30 seconds (Sonnet typical)
- **Reliability**: If review fails, PR creation continues (no blocking)
- **Cost**: ~$0.01-0.05 per review (Sonnet with typical diff size)
- **Observability**: Log review duration, model used, success/failure

## Out of Scope

- Merge blocking based on review results
- Automated lint/test/typecheck (use standard GitHub Actions)
- AI approval or "Request Changes" status
- Multi-round review conversations
- Review of non-AI PRs

## Open Questions for Implementation

1. **Comment timing**: Post comment before or after PR creation? (Before requires PR to exist, after is simpler)
2. **Diff size limits**: What if diff exceeds Claude context? Truncate or chunk?
3. **SPEC.md location**: Always in repo root, or check work_item.spec from DB?

## Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...        # Already exists in worker

# New
AI_REVIEW_MODEL=claude-sonnet-4-20250514  # Default model
AI_REVIEW_ENABLED=true                     # Kill switch
```

## Acceptance Criteria

- [x] Worker posts AI review comment on every PR it creates
- [x] Review comment shows spec alignment assessment with score
- [x] Review comment shows code quality concerns with file references
- [x] Manual retrigger works via GitHub Actions workflow dispatch
- [x] Review records appear in database
- [ ] Dashboard shows review history
- [ ] Unused lint/test runner code is removed from pr-review package
- [ ] Detection pattern fixed (Opus not Sonnet)
