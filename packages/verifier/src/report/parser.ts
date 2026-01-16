/**
 * Output Parser
 *
 * Parses agent output to extract structured verification results.
 */

import type {
  SpecCompliance,
  CodeReview,
  CodeIssue,
  IssueCategory,
  IssueSeverity,
} from './schema.js';

/**
 * Agent review output shape (from JSON).
 */
interface AgentReviewOutput {
  specCompliance?: {
    status?: string;
    requirementsChecked?: number;
    requirementsMet?: number;
    missingRequirements?: string[];
    scopeCreep?: string[];
    notes?: string[];
  };
  codeReview?: {
    status?: string;
    issues?: Array<{
      file?: string;
      line?: number;
      severity?: string;
      category?: string;
      message?: string;
      suggestion?: string;
    }>;
    suggestions?: string[];
  };
  summary?: string;
}

/**
 * Agent endpoint detection output shape.
 */
interface AgentEndpointOutput {
  endpoints?: Array<{
    method?: string;
    path?: string;
    description?: string;
  }>;
}

/**
 * Detected endpoint.
 */
export interface DetectedEndpoint {
  method: string;
  path: string;
  description?: string;
}

/**
 * Parsed review result.
 */
export interface ParsedReview {
  specCompliance: SpecCompliance;
  codeReview: CodeReview;
  summary: string;
}

/**
 * Extract JSON from agent output.
 *
 * Tries multiple strategies:
 * 1. Look for [VERIFIER:COMPLETE] JSON
 * 2. Look for ```json ... ``` blocks
 * 3. Look for raw JSON object
 */
function extractJson(output: string): unknown | null {
  // Strategy 1: [VERIFIER:COMPLETE] format
  const verifierMatch = output.match(/\[VERIFIER:COMPLETE\]\s*(\{[\s\S]*\})/);
  if (verifierMatch?.[1]) {
    try {
      return JSON.parse(verifierMatch[1]);
    } catch {
      // Continue to next strategy
    }
  }

  // Strategy 2: ```json blocks
  const jsonBlockMatch = output.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlockMatch?.[1]) {
    try {
      return JSON.parse(jsonBlockMatch[1]);
    } catch {
      // Continue to next strategy
    }
  }

  // Strategy 3: Raw JSON object (find first { and last })
  const firstBrace = output.indexOf('{');
  const lastBrace = output.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(output.slice(firstBrace, lastBrace + 1));
    } catch {
      // Give up
    }
  }

  return null;
}

/**
 * Validate and normalize spec compliance status.
 */
function normalizeSpecStatus(status: string | undefined): SpecCompliance['status'] {
  const valid = ['pass', 'partial', 'fail', 'skipped'];
  if (status && valid.includes(status)) {
    return status as SpecCompliance['status'];
  }
  return 'skipped';
}

/**
 * Validate and normalize review status.
 */
function normalizeReviewStatus(status: string | undefined): CodeReview['status'] {
  const valid = ['pass', 'needs_work', 'fail'];
  if (status && valid.includes(status)) {
    return status as CodeReview['status'];
  }
  return 'pass';
}

/**
 * Validate and normalize severity.
 */
function normalizeSeverity(severity: string | undefined): IssueSeverity {
  const valid = ['error', 'warning', 'info'];
  if (severity && valid.includes(severity)) {
    return severity as IssueSeverity;
  }
  return 'warning';
}

/**
 * Validate and normalize category.
 */
function normalizeCategory(category: string | undefined): IssueCategory {
  const valid = ['security', 'bugs', 'performance', 'quality', 'api_contract'];
  if (category && valid.includes(category)) {
    return category as IssueCategory;
  }
  return 'quality';
}

/**
 * Parse code issues from agent output.
 */
function parseCodeIssues(issues: AgentReviewOutput['codeReview']): CodeIssue[] {
  if (!issues?.issues || !Array.isArray(issues.issues)) {
    return [];
  }

  return issues.issues
    .filter((issue) => issue.file && issue.message)
    .map((issue) => ({
      file: issue.file!,
      line: issue.line,
      severity: normalizeSeverity(issue.severity),
      category: normalizeCategory(issue.category),
      message: issue.message!,
      suggestion: issue.suggestion,
    }));
}

/**
 * Group issues by category.
 */
function groupByCategory(issues: CodeIssue[]): CodeReview['issuesByCategory'] {
  const result: CodeReview['issuesByCategory'] = {
    security: [],
    bugs: [],
    performance: [],
    quality: [],
    api_contract: [],
  };

  for (const issue of issues) {
    result[issue.category].push(issue);
  }

  return result;
}

/**
 * Count issues by severity.
 */
function countBySeverity(issues: CodeIssue[]): CodeReview['counts'] {
  const counts = { errors: 0, warnings: 0, info: 0 };

  for (const issue of issues) {
    switch (issue.severity) {
      case 'error':
        counts.errors++;
        break;
      case 'warning':
        counts.warnings++;
        break;
      case 'info':
        counts.info++;
        break;
    }
  }

  return counts;
}

/**
 * Parse agent review output.
 *
 * @param output - Raw agent output string
 * @returns Parsed review result
 */
export function parseReviewOutput(output: string): ParsedReview {
  const json = extractJson(output) as AgentReviewOutput | null;

  // Default values for when parsing fails
  const defaultResult: ParsedReview = {
    specCompliance: {
      status: 'skipped',
      requirementsChecked: 0,
      requirementsMet: 0,
      missingRequirements: [],
      scopeCreep: [],
      scopeCreepIsBlocking: false,
      notes: ['Failed to parse agent output'],
    },
    codeReview: {
      status: 'pass',
      issuesByCategory: {
        security: [],
        bugs: [],
        performance: [],
        quality: [],
        api_contract: [],
      },
      counts: { errors: 0, warnings: 0, info: 0 },
      issues: [],
      suggestions: [],
    },
    summary: 'Verification completed but output parsing failed. Manual review recommended.',
  };

  if (!json) {
    return defaultResult;
  }

  // Parse spec compliance
  const specCompliance: SpecCompliance = {
    status: normalizeSpecStatus(json.specCompliance?.status),
    requirementsChecked: json.specCompliance?.requirementsChecked ?? 0,
    requirementsMet: json.specCompliance?.requirementsMet ?? 0,
    missingRequirements: json.specCompliance?.missingRequirements ?? [],
    scopeCreep: json.specCompliance?.scopeCreep ?? [],
    scopeCreepIsBlocking: false,
    notes: json.specCompliance?.notes ?? [],
  };

  // Parse code review
  const issues = parseCodeIssues(json.codeReview);
  const codeReview: CodeReview = {
    status: normalizeReviewStatus(json.codeReview?.status),
    issuesByCategory: groupByCategory(issues),
    counts: countBySeverity(issues),
    issues,
    suggestions: json.codeReview?.suggestions ?? [],
  };

  return {
    specCompliance,
    codeReview,
    summary: json.summary ?? 'Verification completed.',
  };
}

/**
 * Parse endpoint detection output.
 *
 * @param output - Raw agent output string
 * @returns Array of detected endpoints
 */
export function parseEndpointOutput(output: string): DetectedEndpoint[] {
  const json = extractJson(output) as AgentEndpointOutput | null;

  if (!json?.endpoints || !Array.isArray(json.endpoints)) {
    return [];
  }

  return json.endpoints
    .filter((ep) => ep.method && ep.path)
    .map((ep) => ({
      method: ep.method!.toUpperCase(),
      path: ep.path!,
      description: ep.description,
    }));
}

/**
 * Agent critique output shape (from JSON).
 */
interface AgentCritiqueOutput {
  filteredIssues?: Array<{
    file?: string;
    line?: number;
    severity?: string;
    category?: string;
    message?: string;
    suggestion?: string;
  }>;
  removedIssues?: Array<{
    originalMessage?: string;
    reason?: string;
  }>;
  summary?: {
    originalCount?: number;
    filteredCount?: number;
    removedCount?: number;
  };
}

/**
 * Critique filter reason.
 */
export type CritiqueFilterReason = 'false_positive' | 'not_actionable' | 'out_of_scope' | 'too_minor' | 'wrong_severity';

/**
 * Parsed critique result.
 */
export interface ParsedCritique {
  filteredIssues: CodeIssue[];
  removedIssues: Array<{
    originalMessage: string;
    reason: CritiqueFilterReason;
  }>;
  originalCount: number;
  filteredCount: number;
}

/**
 * Validate and normalize critique filter reason.
 */
function normalizeCritiqueReason(reason: string | undefined): CritiqueFilterReason {
  const valid: CritiqueFilterReason[] = ['false_positive', 'not_actionable', 'out_of_scope', 'too_minor', 'wrong_severity'];
  if (reason && valid.includes(reason as CritiqueFilterReason)) {
    return reason as CritiqueFilterReason;
  }
  return 'false_positive';
}

/**
 * Parse critique phase output.
 *
 * @param output - Raw agent output string
 * @param originalIssues - Original issues that were critiqued
 * @returns Parsed critique result
 */
export function parseCritiqueOutput(output: string, originalIssues: CodeIssue[]): ParsedCritique {
  const json = extractJson(output) as AgentCritiqueOutput | null;

  // Default: keep all original issues if parsing fails
  if (!json) {
    return {
      filteredIssues: originalIssues,
      removedIssues: [],
      originalCount: originalIssues.length,
      filteredCount: originalIssues.length,
    };
  }

  // Parse filtered issues
  const filteredIssues: CodeIssue[] = [];
  if (json.filteredIssues && Array.isArray(json.filteredIssues)) {
    for (const issue of json.filteredIssues) {
      if (issue.file && issue.message) {
        filteredIssues.push({
          file: issue.file,
          line: issue.line,
          severity: normalizeSeverity(issue.severity),
          category: normalizeCategory(issue.category),
          message: issue.message,
          suggestion: issue.suggestion,
        });
      }
    }
  }

  // Parse removed issues
  const removedIssues: ParsedCritique['removedIssues'] = [];
  if (json.removedIssues && Array.isArray(json.removedIssues)) {
    for (const removed of json.removedIssues) {
      if (removed.originalMessage) {
        removedIssues.push({
          originalMessage: removed.originalMessage,
          reason: normalizeCritiqueReason(removed.reason),
        });
      }
    }
  }

  return {
    filteredIssues,
    removedIssues,
    originalCount: json.summary?.originalCount ?? originalIssues.length,
    filteredCount: json.summary?.filteredCount ?? filteredIssues.length,
  };
}

/**
 * Agent browser check output shape (from JSON).
 */
interface AgentBrowserOutput {
  pagesChecked?: string[];
  issues?: Array<{
    page?: string;
    type?: string;
    message?: string;
    screenshot?: string;
  }>;
  status?: string;
  screenshots?: string[];
}

/**
 * Parsed browser check result.
 */
export interface ParsedBrowserCheck {
  status: 'pass' | 'warnings' | 'fail';
  pagesChecked: string[];
  issues: Array<{
    page: string;
    type: 'console_error' | 'render' | 'a11y' | 'interaction';
    message: string;
    screenshot?: string;
  }>;
  screenshots?: string[];
}

/**
 * Validate and normalize browser check status.
 */
function normalizeBrowserStatus(status: string | undefined): ParsedBrowserCheck['status'] {
  const valid = ['pass', 'warnings', 'fail'];
  if (status && valid.includes(status)) {
    return status as ParsedBrowserCheck['status'];
  }
  return 'pass';
}

/**
 * Validate and normalize browser issue type.
 */
function normalizeBrowserIssueType(type: string | undefined): ParsedBrowserCheck['issues'][0]['type'] {
  const valid = ['console_error', 'render', 'a11y', 'interaction'];
  if (type && valid.includes(type)) {
    return type as ParsedBrowserCheck['issues'][0]['type'];
  }
  return 'render';
}

/**
 * Parse browser check output from agent.
 *
 * @param output - Raw agent output string
 * @returns Parsed browser check result
 */
export function parseBrowserOutput(output: string): ParsedBrowserCheck {
  const json = extractJson(output) as AgentBrowserOutput | null;

  // Default values for when parsing fails
  if (!json) {
    return {
      status: 'fail',
      pagesChecked: [],
      issues: [{
        page: 'unknown',
        type: 'render',
        message: 'Failed to parse browser check output',
      }],
    };
  }

  // Parse issues
  const issues: ParsedBrowserCheck['issues'] = [];
  if (json.issues && Array.isArray(json.issues)) {
    for (const issue of json.issues) {
      if (issue.page && issue.message) {
        issues.push({
          page: issue.page,
          type: normalizeBrowserIssueType(issue.type),
          message: issue.message,
          screenshot: issue.screenshot,
        });
      }
    }
  }

  // Determine status based on issues if not provided
  let status = normalizeBrowserStatus(json.status);
  if (!json.status && issues.length > 0) {
    // Auto-determine: console_error = warnings, render/a11y/interaction = fail
    const hasRenderIssues = issues.some((i) => i.type === 'render' || i.type === 'a11y' || i.type === 'interaction');
    status = hasRenderIssues ? 'fail' : 'warnings';
  }

  return {
    status,
    pagesChecked: json.pagesChecked ?? [],
    issues,
    screenshots: json.screenshots,
  };
}

/**
 * Extract events from agent output stream.
 *
 * Looks for [VERIFIER:*] patterns.
 */
export function extractEvents(
  output: string
): Array<{ type: string; data: Record<string, unknown> }> {
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  const pattern = /\[VERIFIER:(\w+)\]\s*(\{[^}]*\})?/g;

  let match;
  while ((match = pattern.exec(output)) !== null) {
    const type = match[1];
    let data: Record<string, unknown> = {};

    if (match[2]) {
      try {
        data = JSON.parse(match[2]);
      } catch {
        // Ignore parse errors
      }
    }

    events.push({ type: type!, data });
  }

  return events;
}

/**
 * Agent temp test output shape (from JSON).
 */
interface AgentTempTestOutput {
  tests?: Array<{
    filename?: string;
    description?: string;
    content?: string;
    expectedToPass?: boolean;
  }>;
  coverageGaps?: string[];
  skippedReason?: string | null;
}

/**
 * Generated test file.
 */
export interface GeneratedTest {
  filename: string;
  description: string;
  content: string;
  expectedToPass: boolean;
}

/**
 * Parsed temp test generation result.
 */
export interface ParsedTempTests {
  tests: GeneratedTest[];
  coverageGaps: string[];
  skippedReason: string | null;
}

/**
 * Parse temp test generation output from agent.
 *
 * @param output - Raw agent output string
 * @returns Parsed temp test result
 */
export function parseTempTestOutput(output: string): ParsedTempTests {
  const json = extractJson(output) as AgentTempTestOutput | null;

  // Default values for when parsing fails
  if (!json) {
    return {
      tests: [],
      coverageGaps: [],
      skippedReason: 'Failed to parse agent output',
    };
  }

  // Parse tests
  const tests: GeneratedTest[] = [];
  if (json.tests && Array.isArray(json.tests)) {
    for (const test of json.tests) {
      if (test.filename && test.content) {
        tests.push({
          filename: test.filename,
          description: test.description ?? 'Generated integration test',
          content: test.content,
          expectedToPass: test.expectedToPass ?? true,
        });
      }
    }
  }

  return {
    tests,
    coverageGaps: json.coverageGaps ?? [],
    skippedReason: json.skippedReason ?? null,
  };
}
