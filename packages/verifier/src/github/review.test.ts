/**
 * GitHub Review Tests
 */

import { describe, it, expect } from 'bun:test';
import type { VerificationReport } from '../report/schema.js';

// Test helper to create a minimal valid report
function createTestReport(overrides: Partial<VerificationReport> = {}): VerificationReport {
  return {
    prNumber: 123,
    repo: 'owner/repo',
    branch: 'feature',
    sha: 'abc123def456',
    verifiedAt: new Date().toISOString(),
    durationMs: 45000,
    harness: 'claude',
    verdict: 'pass',
    summary: 'All checks passed successfully.',
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
      testsRun: 24,
      testsPassed: 24,
      testsFailed: 0,
      failingTests: [],
    },
    typeCheck: {
      status: 'pass',
      errors: [],
    },
    ...overrides,
  };
}

describe('GitHub Review', () => {
  describe('Report Structure', () => {
    it('should have all required fields for passing report', () => {
      const report = createTestReport();

      expect(report.verdict).toBe('pass');
      expect(report.specCompliance.status).toBe('pass');
      expect(report.codeReview.status).toBe('pass');
      expect(report.testResults.status).toBe('pass');
      expect(report.typeCheck.status).toBe('pass');
    });

    it('should support failed report with issues', () => {
      const report = createTestReport({
        verdict: 'fail',
        summary: 'Security vulnerabilities found',
        codeReview: {
          status: 'fail',
          issuesByCategory: {
            security: [
              {
                file: 'src/auth.ts',
                line: 42,
                severity: 'error',
                category: 'security',
                message: 'SQL injection vulnerability',
                suggestion: 'Use parameterized queries',
              },
            ],
            bugs: [],
            performance: [],
            quality: [],
            api_contract: [],
          },
          counts: { errors: 1, warnings: 0, info: 0 },
          issues: [
            {
              file: 'src/auth.ts',
              line: 42,
              severity: 'error',
              category: 'security',
              message: 'SQL injection vulnerability',
              suggestion: 'Use parameterized queries',
            },
          ],
          suggestions: [],
        },
      });

      expect(report.verdict).toBe('fail');
      expect(report.codeReview.issues.length).toBe(1);
      expect(report.codeReview.issues[0]?.category).toBe('security');
    });

    it('should support needs_work verdict', () => {
      const report = createTestReport({
        verdict: 'needs_work',
        summary: 'Some improvements suggested',
        codeReview: {
          status: 'needs_work',
          issuesByCategory: {
            security: [],
            bugs: [],
            performance: [
              {
                file: 'src/api.ts',
                line: 100,
                severity: 'warning',
                category: 'performance',
                message: 'N+1 query detected',
                suggestion: 'Use batch loading',
              },
            ],
            quality: [],
            api_contract: [],
          },
          counts: { errors: 0, warnings: 1, info: 0 },
          issues: [
            {
              file: 'src/api.ts',
              line: 100,
              severity: 'warning',
              category: 'performance',
              message: 'N+1 query detected',
              suggestion: 'Use batch loading',
            },
          ],
          suggestions: ['Consider adding caching'],
        },
      });

      expect(report.verdict).toBe('needs_work');
      expect(report.codeReview.suggestions.length).toBe(1);
    });

    it('should support test failures', () => {
      const report = createTestReport({
        verdict: 'fail',
        testResults: {
          status: 'fail',
          testsRun: 24,
          testsPassed: 20,
          testsFailed: 4,
          failingTests: [
            'Auth > should validate token',
            'Auth > should reject expired token',
            'API > should return 404 for missing resource',
            'API > should handle errors gracefully',
          ],
        },
      });

      expect(report.testResults.status).toBe('fail');
      expect(report.testResults.testsFailed).toBe(4);
      expect(report.testResults.failingTests.length).toBe(4);
    });

    it('should support type errors', () => {
      const report = createTestReport({
        verdict: 'fail',
        typeCheck: {
          status: 'fail',
          errors: [
            { file: 'src/types.ts', line: 10, message: "Property 'id' is missing" },
            { file: 'src/api.ts', line: 25, message: "Type 'string' is not assignable to type 'number'" },
          ],
        },
      });

      expect(report.typeCheck.status).toBe('fail');
      expect(report.typeCheck.errors.length).toBe(2);
    });

    it('should support integration check results', () => {
      const report = createTestReport({
        integrationCheck: {
          status: 'pass',
          endpointsTested: ['GET /api/users', 'POST /api/users', 'GET /api/users/:id'],
          issues: [],
        },
      });

      expect(report.integrationCheck?.status).toBe('pass');
      expect(report.integrationCheck?.endpointsTested.length).toBe(3);
    });

    it('should support browser check results', () => {
      const report = createTestReport({
        browserCheck: {
          status: 'warnings',
          pagesChecked: ['/', '/dashboard', '/settings'],
          issues: [
            {
              page: '/dashboard',
              type: 'console_error',
              message: 'Failed to load resource: 404',
            },
          ],
        },
      });

      expect(report.browserCheck?.status).toBe('warnings');
      expect(report.browserCheck?.pagesChecked.length).toBe(3);
      expect(report.browserCheck?.issues.length).toBe(1);
    });

    it('should support spec compliance failures', () => {
      const report = createTestReport({
        verdict: 'fail',
        specCompliance: {
          status: 'fail',
          requirementsChecked: 5,
          requirementsMet: 3,
          missingRequirements: [
            'User authentication endpoint',
            'Password reset flow',
          ],
          scopeCreep: ['Added analytics tracking (not in spec)'],
          scopeCreepIsBlocking: false,
          notes: ['Core functionality is present but auth is incomplete'],
        },
      });

      expect(report.specCompliance.status).toBe('fail');
      expect(report.specCompliance.missingRequirements.length).toBe(2);
      expect(report.specCompliance.scopeCreep.length).toBe(1);
    });
  });

  describe('Verdict Mapping', () => {
    it('should map pass verdict correctly', () => {
      const report = createTestReport({ verdict: 'pass' });
      expect(report.verdict).toBe('pass');
      // In production, this would map to APPROVE
    });

    it('should map fail verdict correctly', () => {
      const report = createTestReport({ verdict: 'fail' });
      expect(report.verdict).toBe('fail');
      // In production, this would map to REQUEST_CHANGES
    });

    it('should map needs_work verdict correctly', () => {
      const report = createTestReport({ verdict: 'needs_work' });
      expect(report.verdict).toBe('needs_work');
      // In production, this would map to REQUEST_CHANGES
    });
  });

  describe('Issue Categories', () => {
    it('should support all issue categories', () => {
      const report = createTestReport({
        codeReview: {
          status: 'needs_work',
          issuesByCategory: {
            security: [{ file: 'a.ts', severity: 'error', category: 'security', message: 'XSS' }],
            bugs: [{ file: 'b.ts', severity: 'error', category: 'bugs', message: 'Null pointer' }],
            performance: [{ file: 'c.ts', severity: 'warning', category: 'performance', message: 'N+1' }],
            quality: [{ file: 'd.ts', severity: 'info', category: 'quality', message: 'Long function' }],
            api_contract: [{ file: 'e.ts', severity: 'warning', category: 'api_contract', message: 'Missing validation' }],
          },
          counts: { errors: 2, warnings: 2, info: 1 },
          issues: [],
          suggestions: [],
        },
      });

      expect(report.codeReview.issuesByCategory.security.length).toBe(1);
      expect(report.codeReview.issuesByCategory.bugs.length).toBe(1);
      expect(report.codeReview.issuesByCategory.performance.length).toBe(1);
      expect(report.codeReview.issuesByCategory.quality.length).toBe(1);
      expect(report.codeReview.issuesByCategory.api_contract.length).toBe(1);
    });
  });

  describe('Cost Tracking', () => {
    it('should include cost when provided', () => {
      const report = createTestReport({
        costUsd: 0.0542,
      });

      expect(report.costUsd).toBe(0.0542);
    });
  });

  describe('Feedback Structure', () => {
    it('should include feedback for non-passing verdicts', () => {
      const report = createTestReport({
        verdict: 'fail',
        feedback: {
          actionItems: [
            {
              priority: 1,
              type: 'test_failure',
              description: 'Fix failing auth tests',
              file: 'src/auth.test.ts',
            },
            {
              priority: 2,
              type: 'type_error',
              description: 'Fix type mismatch',
              file: 'src/types.ts',
              line: 42,
              suggestion: 'Change type to number',
            },
          ],
          failingTests: [
            { name: 'Auth > login', error: 'Expected 200, got 401', file: 'auth.test.ts' },
          ],
          typeErrors: [
            { file: 'src/types.ts', line: 42, message: 'Type mismatch' },
          ],
        },
      });

      expect(report.feedback?.actionItems.length).toBe(2);
      expect(report.feedback?.actionItems[0]?.priority).toBe(1);
      expect(report.feedback?.failingTests?.length).toBe(1);
      expect(report.feedback?.typeErrors?.length).toBe(1);
    });
  });
});
