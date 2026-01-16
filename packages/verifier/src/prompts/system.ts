/**
 * Verifier Agent System Prompts
 *
 * Prompts for the AI agent to perform verification tasks.
 */

/**
 * System prompt for the verifier agent.
 */
export const VERIFIER_SYSTEM_PROMPT = `You are a verification agent for Whim AI Software Factory.

## Your Mission
Thoroughly verify a PR before it can be merged. You must be rigorous -
catching issues now prevents production bugs.

## Review Categories

When reviewing code, organize findings by category:
- **Security**: secrets, injection, XSS, auth bypass (severity: error)
- **Bugs**: null access, race conditions, resource leaks (severity: error)
- **Performance**: N+1 queries, memory leaks, blocking ops (severity: warning)
- **Quality**: duplication, complexity, naming (severity: info)
- **API Contract**: breaking changes, missing validation (severity: varies)

## Self-Critique

Before reporting findings, review them:
1. Is this a real issue or false positive?
2. Would a senior engineer agree this is worth flagging?
3. Is this actionable? Can the author fix it?
4. Is this the right severity level?

Filter out:
- Style nitpicks (unless configured)
- Issues in unchanged code
- Suggestions requiring major refactoring
- False positives from missing context

## Output Format

Output your findings as JSON in this exact format:
\`\`\`json
{
  "specCompliance": {
    "status": "pass|partial|fail|skipped",
    "requirementsChecked": <number>,
    "requirementsMet": <number>,
    "missingRequirements": ["..."],
    "scopeCreep": ["..."],
    "notes": ["..."]
  },
  "codeReview": {
    "status": "pass|needs_work|fail",
    "issues": [
      {
        "file": "path/to/file.ts",
        "line": <number or null>,
        "severity": "error|warning|info",
        "category": "security|bugs|performance|quality|api_contract",
        "message": "description",
        "suggestion": "optional fix suggestion"
      }
    ],
    "suggestions": ["general suggestions..."]
  },
  "summary": "one paragraph overall summary"
}
\`\`\`

## Rules
- Report ALL findings - good and bad
- Be specific about file and line numbers
- Include actionable suggestions when possible
- Don't report issues in unchanged code (focus on PR diff)
`;

/**
 * Build a prompt for spec compliance + code review.
 */
export function buildReviewPrompt(params: {
  specContent: string | null;
  diff: string;
  testResults: { status: string; output: string };
  typeResults: { status: string; output: string };
  integrationResults?: { status: string; output: string };
}): string {
  const { specContent, diff, testResults, typeResults, integrationResults } = params;

  let prompt = `## Task: Verify this PR

### Test Results
Status: ${testResults.status}
${testResults.output ? `Output:\n${testResults.output.slice(0, 2000)}` : ''}

### Type Check Results
Status: ${typeResults.status}
${typeResults.output ? `Output:\n${typeResults.output.slice(0, 2000)}` : ''}

`;

  if (integrationResults) {
    prompt += `### Integration Results
Status: ${integrationResults.status}
${integrationResults.output ? `Output:\n${integrationResults.output.slice(0, 2000)}` : ''}

`;
  }

  if (specContent) {
    prompt += `### SPEC.md
${specContent}

`;
  } else {
    prompt += `### SPEC.md
No SPEC.md found - skip spec compliance check (set status to "skipped").

`;
  }

  prompt += `### PR Diff
${diff.slice(0, 50000)}

### Instructions

1. If SPEC.md exists, check all requirements are implemented
2. Review the diff for security issues, bugs, performance problems, and code quality
3. Self-critique your findings - filter false positives
4. Output your findings as JSON (see Output Format in system prompt)

Be thorough but efficient. Focus on the actual changes in the diff.`;

  return prompt;
}

/**
 * Build a prompt for integration endpoint detection.
 */
export function buildEndpointDetectionPrompt(diff: string): string {
  return `## Task: Detect API Endpoints Changed

Analyze this PR diff and identify any API endpoints that were added or modified.

### PR Diff
${diff.slice(0, 30000)}

### Instructions

Look for:
- Express/Fastify/Hono route definitions (app.get, app.post, router.get, etc.)
- Next.js API routes (pages/api/*.ts, app/api/*.ts)
- tRPC procedure definitions
- GraphQL resolvers

Output a JSON array of endpoints that should be tested:

\`\`\`json
{
  "endpoints": [
    {
      "method": "GET|POST|PUT|DELETE|PATCH",
      "path": "/api/example",
      "description": "what this endpoint does"
    }
  ]
}
\`\`\`

If no API endpoints were changed, output:
\`\`\`json
{
  "endpoints": []
}
\`\`\`
`;
}

/**
 * Build a prompt for self-critique of findings.
 *
 * This is Phase 4 (CRITIQUE) - a separate AI call to review and filter findings.
 */
export function buildCritiquePrompt(params: {
  issues: Array<{
    file: string;
    line?: number;
    severity: string;
    category: string;
    message: string;
    suggestion?: string;
  }>;
  diff: string;
}): string {
  const { issues, diff } = params;

  if (issues.length === 0) {
    return ''; // No critique needed if no issues
  }

  return `## Task: Self-Critique Code Review Findings

You are reviewing findings from an initial code review. Your job is to filter out false positives
and ensure only actionable, accurate findings remain.

### Original Findings (${issues.length} issues)

\`\`\`json
${JSON.stringify(issues, null, 2)}
\`\`\`

### PR Diff (for reference)

${diff.slice(0, 30000)}

### Self-Critique Checklist

For EACH finding, evaluate:

1. **Is this a real issue or false positive?**
   - Does the code actually have this problem?
   - Is there context you might be missing?

2. **Would a senior engineer agree this is worth flagging?**
   - Is this actually problematic or just stylistic?
   - Is it severe enough to mention?

3. **Is this actionable?**
   - Can the author fix it?
   - Is the suggestion concrete?

4. **Is this the right severity level?**
   - error = must fix before merge
   - warning = should fix
   - info = nice to have

### What to Filter Out

- Style nitpicks (spacing, naming preferences)
- Issues in UNCHANGED code (only review the diff)
- Suggestions requiring major refactoring
- False positives from missing broader context
- Duplicates or overlapping issues

### Output Format

\`\`\`json
{
  "filteredIssues": [
    // Only issues that pass the self-critique checklist
    // Use same format as input issues
  ],
  "removedIssues": [
    {
      "originalMessage": "the issue that was removed",
      "reason": "false_positive|not_actionable|out_of_scope|too_minor|wrong_severity"
    }
  ],
  "summary": {
    "originalCount": ${issues.length},
    "filteredCount": <number>,
    "removedCount": <number>
  }
}
\`\`\`

Be rigorous but fair. Keep issues that are genuinely worth fixing.`;
}

/**
 * Build a prompt for browser check instructions.
 */
export function buildBrowserCheckPrompt(params: {
  port: number;
  pages: string[];
}): string {
  const { port, pages } = params;

  return `## Task: Verify UI in Browser

You have access to agent-browser CLI. Verify the UI:

### Pages to Check
${pages.map((p) => `- http://localhost:${port}${p}`).join('\n')}

### Steps

1. For each page:
   - Run: agent-browser open http://localhost:${port}<page>
   - Run: agent-browser snapshot -i (get interactive elements)
   - Check that key elements exist (use refs like @e1, @e2)
   - Note any console errors
   - Verify the page renders correctly

2. Report any issues found

### Output Format

\`\`\`json
{
  "pagesChecked": ["/", "/dashboard"],
  "issues": [
    {
      "page": "/",
      "type": "console_error|render|a11y|interaction",
      "message": "description of issue"
    }
  ],
  "status": "pass|warnings|fail"
}
\`\`\`

Do NOT close the browser - cleanup happens after.`;
}

/**
 * Build a prompt for temporary test generation.
 *
 * The AI will generate integration tests targeting coverage gaps in the PR.
 * Tests are written to .whim/tmp-tests/ and deleted after verification.
 */
export function buildTempTestPrompt(params: {
  diff: string;
  existingTests: string[];
  projectType: 'node' | 'python' | 'go';
  testFramework?: string;
}): string {
  const { diff, existingTests, projectType, testFramework } = params;

  const frameworkGuide = {
    node: {
      framework: testFramework ?? 'vitest',
      extension: '.test.ts',
      imports: `import { describe, it, expect } from '${testFramework ?? 'vitest'}';`,
      runCommand: 'npx vitest run',
    },
    python: {
      framework: testFramework ?? 'pytest',
      extension: '_test.py',
      imports: 'import pytest',
      runCommand: 'pytest',
    },
    go: {
      framework: 'testing',
      extension: '_test.go',
      imports: 'import "testing"',
      runCommand: 'go test',
    },
  }[projectType];

  return `## Task: Generate Integration Tests for Coverage Gaps

You are generating temporary integration tests to verify the PR changes work correctly.
These tests target functionality NOT covered by existing tests.

### Changed Code (PR Diff)
${diff.slice(0, 40000)}

### Existing Test Coverage
${existingTests.length > 0 ? existingTests.map((t) => `- ${t}`).join('\n') : 'No existing tests found for changed files.'}

### Test Framework
- Framework: ${frameworkGuide.framework}
- File extension: ${frameworkGuide.extension}
- Import template: \`${frameworkGuide.imports}\`

### Instructions

1. **Identify coverage gaps**: What changed code paths are NOT tested by existing tests?
2. **Generate focused tests**: Write 1-3 integration tests targeting these gaps
3. **Test real behavior**: Don't mock everything - test actual integration points
4. **Be minimal**: Only test what's actually changed and uncovered

### What to Test (Priority Order)

1. **API endpoints**: If endpoints were added/changed, test they return correct responses
2. **Data transformations**: If functions transform data, test edge cases
3. **Error handling**: If error paths were added, test they throw correctly
4. **Integration points**: If code connects systems, test the connection works

### What NOT to Test

- Code already covered by existing tests
- Pure utility functions (unit tests exist)
- Code outside the PR diff
- External services (mock only external APIs)

### Output Format

Generate test files that can be written to .whim/tmp-tests/:

\`\`\`json
{
  "tests": [
    {
      "filename": "example${frameworkGuide.extension}",
      "description": "what this test verifies",
      "content": "full test file content here",
      "expectedToPass": true
    }
  ],
  "coverageGaps": [
    "description of gap 1",
    "description of gap 2"
  ],
  "skippedReason": null
}
\`\`\`

If there are no meaningful coverage gaps (existing tests are sufficient), output:
\`\`\`json
{
  "tests": [],
  "coverageGaps": [],
  "skippedReason": "Existing tests adequately cover the changed code"
}
\`\`\`

### Rules

- Tests must be self-contained (can run independently)
- Tests must be fast (< 10 seconds each)
- Include setup/teardown if needed
- Use clear, descriptive test names
- Output valid ${frameworkGuide.framework} test syntax`;
}
