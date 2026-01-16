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
