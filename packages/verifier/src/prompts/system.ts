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
