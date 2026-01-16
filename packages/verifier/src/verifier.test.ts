/**
 * Verifier Tests
 */

import { describe, it, expect } from 'bun:test';
import { loadConfig, DEFAULT_CONFIG, validateConfig } from './config.js';
import { parseReviewOutput, parseEndpointOutput, parseBrowserOutput, extractEvents } from './report/parser.js';
import type { VerificationReport } from './report/schema.js';

describe('Config', () => {
  describe('loadConfig', () => {
    it('should return default config when file not found', () => {
      const config = loadConfig('/nonexistent/path');
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('should have sensible defaults', () => {
      expect(DEFAULT_CONFIG.enabled).toBe(true);
      expect(DEFAULT_CONFIG.harness).toBe('claude');
      expect(DEFAULT_CONFIG.required.specCheck).toBe(true);
      expect(DEFAULT_CONFIG.required.codeReview).toBe(true);
      expect(DEFAULT_CONFIG.required.testRun).toBe(true);
      expect(DEFAULT_CONFIG.required.typeCheck).toBe(true);
    });
  });

  describe('validateConfig', () => {
    it('should accept valid config', () => {
      const errors = validateConfig(DEFAULT_CONFIG);
      expect(errors).toEqual([]);
    });

    it('should reject invalid port', () => {
      const config = { ...DEFAULT_CONFIG, build: { ...DEFAULT_CONFIG.build, port: -1 } };
      const errors = validateConfig(config);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('port'))).toBe(true);
    });

    it('should reject negative cost budget', () => {
      const config = { ...DEFAULT_CONFIG, budget: { ...DEFAULT_CONFIG.budget, maxCostUsd: -1 } };
      const errors = validateConfig(config);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('maxCostUsd'))).toBe(true);
    });
  });
});

describe('Parser', () => {
  describe('parseReviewOutput', () => {
    it('should parse valid JSON output', () => {
      const output = `
Here is my review:

\`\`\`json
{
  "specCompliance": {
    "status": "pass",
    "requirementsChecked": 5,
    "requirementsMet": 5,
    "missingRequirements": [],
    "scopeCreep": [],
    "notes": []
  },
  "codeReview": {
    "status": "pass",
    "issues": [],
    "suggestions": ["Consider adding more tests"]
  },
  "summary": "All checks passed"
}
\`\`\`
      `;

      const result = parseReviewOutput(output);
      expect(result.specCompliance.status).toBe('pass');
      expect(result.specCompliance.requirementsChecked).toBe(5);
      expect(result.codeReview.status).toBe('pass');
      expect(result.summary).toBe('All checks passed');
    });

    it('should parse issues with all fields', () => {
      const output = `
\`\`\`json
{
  "specCompliance": { "status": "skipped" },
  "codeReview": {
    "status": "needs_work",
    "issues": [
      {
        "file": "src/index.ts",
        "line": 42,
        "severity": "error",
        "category": "security",
        "message": "SQL injection vulnerability",
        "suggestion": "Use parameterized queries"
      }
    ],
    "suggestions": []
  },
  "summary": "Security issue found"
}
\`\`\`
      `;

      const result = parseReviewOutput(output);
      expect(result.codeReview.issues.length).toBe(1);
      expect(result.codeReview.issues[0]?.file).toBe('src/index.ts');
      expect(result.codeReview.issues[0]?.line).toBe(42);
      expect(result.codeReview.issues[0]?.severity).toBe('error');
      expect(result.codeReview.issues[0]?.category).toBe('security');
    });

    it('should handle malformed output gracefully', () => {
      const result = parseReviewOutput('This is not JSON at all');
      expect(result.specCompliance.status).toBe('skipped');
      expect(result.codeReview.status).toBe('pass');
      expect(result.summary).toContain('parsing failed');
    });

    it('should normalize invalid status values', () => {
      const output = `
\`\`\`json
{
  "specCompliance": { "status": "invalid_status" },
  "codeReview": { "status": "unknown", "issues": [], "suggestions": [] },
  "summary": "test"
}
\`\`\`
      `;

      const result = parseReviewOutput(output);
      expect(result.specCompliance.status).toBe('skipped');
      expect(result.codeReview.status).toBe('pass');
    });
  });

  describe('parseEndpointOutput', () => {
    it('should parse endpoint list', () => {
      const output = `
\`\`\`json
{
  "endpoints": [
    { "method": "get", "path": "/api/users", "description": "List users" },
    { "method": "POST", "path": "/api/users", "description": "Create user" }
  ]
}
\`\`\`
      `;

      const result = parseEndpointOutput(output);
      expect(result.length).toBe(2);
      expect(result[0]?.method).toBe('GET');
      expect(result[0]?.path).toBe('/api/users');
      expect(result[1]?.method).toBe('POST');
    });

    it('should return empty array for no endpoints', () => {
      const output = '```json\n{ "endpoints": [] }\n```';
      const result = parseEndpointOutput(output);
      expect(result).toEqual([]);
    });

    it('should handle missing output', () => {
      const result = parseEndpointOutput('No JSON here');
      expect(result).toEqual([]);
    });
  });

  describe('extractEvents', () => {
    it('should extract VERIFIER events', () => {
      const output = `
Starting verification...
[VERIFIER:START] {"pr_number": 123, "harness": "claude"}
Running tests...
[VERIFIER:CHECK] {"check": "test_run", "status": "pass"}
Done.
[VERIFIER:COMPLETE] {"verdict": "pass"}
      `;

      const events = extractEvents(output);
      expect(events.length).toBe(3);
      expect(events[0]?.type).toBe('START');
      expect(events[1]?.type).toBe('CHECK');
      expect(events[2]?.type).toBe('COMPLETE');
    });

    it('should handle events without data', () => {
      const output = '[VERIFIER:PING]';
      const events = extractEvents(output);
      expect(events.length).toBe(1);
      expect(events[0]?.type).toBe('PING');
      expect(events[0]?.data).toEqual({});
    });
  });
});

describe('Schema', () => {
  it('should define valid VerificationReport structure', () => {
    const report: VerificationReport = {
      prNumber: 123,
      repo: 'owner/repo',
      branch: 'feature',
      sha: 'abc123',
      verifiedAt: new Date().toISOString(),
      durationMs: 5000,
      harness: 'claude',
      verdict: 'pass',
      summary: 'All checks passed',
      specCompliance: {
        status: 'pass',
        requirementsChecked: 5,
        requirementsMet: 5,
        missingRequirements: [],
        scopeCreep: [],
        scopeCreepIsBlocking: false,
        notes: [],
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
      testResults: {
        status: 'pass',
        testsRun: 10,
        testsPassed: 10,
        testsFailed: 0,
        failingTests: [],
      },
      typeCheck: {
        status: 'pass',
        errors: [],
      },
    };

    expect(report.verdict).toBe('pass');
    expect(report.specCompliance.status).toBe('pass');
    expect(report.testResults.testsRun).toBe(10);
  });
});

describe('Browser Check Parser', () => {
  describe('parseBrowserOutput', () => {
    it('should parse valid browser check output', () => {
      const output = `
Browser verification complete.

\`\`\`json
{
  "pagesChecked": ["/", "/dashboard", "/settings"],
  "issues": [],
  "status": "pass"
}
\`\`\`
      `;

      const result = parseBrowserOutput(output);
      expect(result.status).toBe('pass');
      expect(result.pagesChecked).toEqual(['/', '/dashboard', '/settings']);
      expect(result.issues).toEqual([]);
    });

    it('should parse browser check with issues', () => {
      const output = `
\`\`\`json
{
  "pagesChecked": ["/", "/dashboard"],
  "issues": [
    {
      "page": "/dashboard",
      "type": "console_error",
      "message": "Warning: setState called on unmounted component"
    },
    {
      "page": "/",
      "type": "render",
      "message": "Button with id='submit' not found"
    }
  ],
  "status": "warnings"
}
\`\`\`
      `;

      const result = parseBrowserOutput(output);
      expect(result.status).toBe('warnings');
      expect(result.pagesChecked.length).toBe(2);
      expect(result.issues.length).toBe(2);
      expect(result.issues[0].type).toBe('console_error');
      expect(result.issues[1].type).toBe('render');
    });

    it('should auto-determine status from issues when not provided', () => {
      const output = `
\`\`\`json
{
  "pagesChecked": ["/"],
  "issues": [
    {
      "page": "/",
      "type": "render",
      "message": "Page failed to load"
    }
  ]
}
\`\`\`
      `;

      const result = parseBrowserOutput(output);
      // render issue should cause 'fail' status
      expect(result.status).toBe('fail');
    });

    it('should handle console_error as warnings', () => {
      const output = `
\`\`\`json
{
  "pagesChecked": ["/"],
  "issues": [
    {
      "page": "/",
      "type": "console_error",
      "message": "Some console warning"
    }
  ]
}
\`\`\`
      `;

      const result = parseBrowserOutput(output);
      // console_error should be 'warnings' not 'fail'
      expect(result.status).toBe('warnings');
    });

    it('should handle invalid JSON gracefully', () => {
      const output = 'This is not JSON at all';

      const result = parseBrowserOutput(output);
      expect(result.status).toBe('fail');
      expect(result.pagesChecked).toEqual([]);
      expect(result.issues.length).toBe(1);
      expect(result.issues[0].message).toContain('Failed to parse');
    });

    it('should normalize unknown issue types to render', () => {
      const output = `
\`\`\`json
{
  "pagesChecked": ["/"],
  "issues": [
    {
      "page": "/",
      "type": "unknown_type",
      "message": "Something went wrong"
    }
  ],
  "status": "fail"
}
\`\`\`
      `;

      const result = parseBrowserOutput(output);
      expect(result.issues[0].type).toBe('render');
    });

    it('should handle screenshots field', () => {
      const output = `
\`\`\`json
{
  "pagesChecked": ["/"],
  "issues": [],
  "status": "pass",
  "screenshots": ["/tmp/screenshot-1.png", "/tmp/screenshot-2.png"]
}
\`\`\`
      `;

      const result = parseBrowserOutput(output);
      expect(result.screenshots).toEqual(['/tmp/screenshot-1.png', '/tmp/screenshot-2.png']);
    });

    it('should parse issues with screenshot field', () => {
      const output = `
\`\`\`json
{
  "pagesChecked": ["/error"],
  "issues": [
    {
      "page": "/error",
      "type": "render",
      "message": "Error page rendered incorrectly",
      "screenshot": "/tmp/error-page.png"
    }
  ],
  "status": "fail"
}
\`\`\`
      `;

      const result = parseBrowserOutput(output);
      expect(result.issues[0].screenshot).toBe('/tmp/error-page.png');
    });
  });
});
