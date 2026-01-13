import { describe, it, expect } from "bun:test";
import { parseTestOutput, type TestStats } from "../src/test-runner.js";

describe("parseTestOutput", () => {
  describe("Jest output", () => {
    it("parses Jest text format with all passing tests", () => {
      const output = `
PASS  src/foo.test.ts
PASS  src/bar.test.ts

Test Suites: 2 passed, 2 total
Tests:       5 passed, 5 total
Snapshots:   0 total
Time:        2.5s
`;

      const result = parseTestOutput(output, "");

      expect(result.stats.total).toBe(5);
      expect(result.stats.passed).toBe(5);
      expect(result.stats.failed).toBe(0);
      expect(result.stats.skipped).toBe(0);
      expect(result.stats.passPercentage).toBe(100);
    });

    it("parses Jest text format with some failures", () => {
      const output = `
PASS  src/foo.test.ts
FAIL  src/bar.test.ts

Test Suites: 1 failed, 1 passed, 2 total
Tests:       2 failed, 3 passed, 5 total
Snapshots:   0 total
Time:        2.5s
`;

      const result = parseTestOutput(output, "");

      expect(result.stats.total).toBe(5);
      expect(result.stats.passed).toBe(3);
      expect(result.stats.failed).toBe(2);
      expect(result.stats.skipped).toBe(0);
      expect(result.stats.passPercentage).toBe(60);
    });

    it("parses Jest text format with skipped tests", () => {
      const output = `
Test Suites: 2 passed, 2 total
Tests:       1 skipped, 4 passed, 5 total
`;

      const result = parseTestOutput(output, "");

      expect(result.stats.total).toBe(5);
      expect(result.stats.passed).toBe(4);
      expect(result.stats.failed).toBe(0);
      expect(result.stats.skipped).toBe(1);
    });

    it("extracts Jest failure details", () => {
      const output = `
● Test Suite › should work correctly

  expect(received).toBe(expected)

  Expected: 42
  Received: 24

Tests:       1 failed, 0 passed, 1 total
`;

      const result = parseTestOutput(output, "");

      expect(result.failures.length).toBeGreaterThan(0);
      expect(result.failures[0].name).toContain("Test Suite");
    });

    it("parses Jest JSON format", () => {
      const jsonOutput = JSON.stringify({
        numTotalTests: 10,
        numPassedTests: 8,
        numFailedTests: 2,
        numPendingTests: 0,
        testResults: [
          {
            name: "test-file.ts",
            assertionResults: [
              {
                status: "failed",
                fullName: "MyTest › should fail",
                failureMessages: ["Expected true but got false"],
              },
            ],
          },
        ],
      });

      const result = parseTestOutput(jsonOutput, "");

      expect(result.stats.total).toBe(10);
      expect(result.stats.passed).toBe(8);
      expect(result.stats.failed).toBe(2);
      expect(result.stats.passPercentage).toBe(80);
      expect(result.failures.length).toBe(1);
      expect(result.failures[0].name).toBe("MyTest › should fail");
    });
  });

  describe("Vitest output", () => {
    it("parses Vitest text format with passing tests", () => {
      const output = `
 ✓ src/foo.test.ts (2 tests)
 ✓ src/bar.test.ts (3 tests)

Test Files  2 passed (2)
Tests  5 passed (5)
`;

      const result = parseTestOutput(output, "");

      expect(result.stats.total).toBe(5);
      expect(result.stats.passed).toBe(5);
      expect(result.stats.failed).toBe(0);
      expect(result.stats.passPercentage).toBe(100);
    });

    it("parses Vitest text format with failures", () => {
      const output = `
 ✓ src/foo.test.ts (2 tests)
 ✗ src/bar.test.ts (3 tests) 1 failed

Test Files  1 passed | 1 failed (2)
Tests  4 passed | 1 failed (5)
`;

      const result = parseTestOutput(output, "");

      expect(result.stats.total).toBe(5);
      expect(result.stats.passed).toBe(4);
      expect(result.stats.failed).toBe(1);
      expect(result.stats.passPercentage).toBe(80);
    });

    it("parses Vitest JSON format", () => {
      const jsonOutput = JSON.stringify({
        numTests: 8,
        numPassedTests: 7,
        numFailedTests: 1,
        numPendingTests: 0,
      });

      const result = parseTestOutput(jsonOutput, "");

      expect(result.stats.total).toBe(8);
      expect(result.stats.passed).toBe(7);
      expect(result.stats.failed).toBe(1);
    });
  });

  describe("Bun test output", () => {
    it("parses Bun test format with all passing", () => {
      const output = `
bun test v1.0.0

test/foo.test.ts:
✓ should work [0.5ms]

test/bar.test.ts:
✓ should also work [0.3ms]

5 pass, 0 fail
`;

      const result = parseTestOutput(output, "");

      expect(result.stats.total).toBe(5);
      expect(result.stats.passed).toBe(5);
      expect(result.stats.failed).toBe(0);
      expect(result.stats.passPercentage).toBe(100);
    });

    it("parses Bun test format with failures", () => {
      const output = `
3 pass, 2 fail, 1 skip
`;

      const result = parseTestOutput(output, "");

      expect(result.stats.total).toBe(6);
      expect(result.stats.passed).toBe(3);
      expect(result.stats.failed).toBe(2);
      expect(result.stats.skipped).toBe(1);
      expect(result.stats.passPercentage).toBe(50);
    });
  });

  describe("Generic output", () => {
    it("parses generic test output with keywords", () => {
      const output = `
Test Results:
  Passed: 8
  Failed: 2
  Total: 10
`;

      const result = parseTestOutput(output, "");

      expect(result.stats.total).toBe(10);
      expect(result.stats.passed).toBe(8);
      expect(result.stats.failed).toBe(2);
      expect(result.stats.passPercentage).toBe(80);
    });

    it("parses generic output with skipped tests", () => {
      const output = `
passed: 5
failed: 1
skipped: 2
total: 8
`;

      const result = parseTestOutput(output, "");

      expect(result.stats.total).toBe(8);
      expect(result.stats.passed).toBe(5);
      expect(result.stats.failed).toBe(1);
      expect(result.stats.skipped).toBe(2);
    });

    it("handles unknown format gracefully", () => {
      const output = "Some random output that doesn't match any pattern";

      const result = parseTestOutput(output, "");

      // Should return zeroed stats without crashing
      expect(result.stats.total).toBe(0);
      expect(result.stats.passed).toBe(0);
      expect(result.stats.failed).toBe(0);
    });
  });

  describe("Error handling", () => {
    it("creates error when stderr is present but no stats", () => {
      const stderr = "Error: Cannot find module 'foo'";

      const result = parseTestOutput("", stderr);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain("Test execution error");
    });

    it("handles malformed JSON gracefully", () => {
      const badJson = '{"numTests": "invalid"';

      const result = parseTestOutput(badJson, "");

      // Should fall back to text parsing without crashing
      expect(result.stats).toBeDefined();
    });
  });

  describe("Pass percentage calculation", () => {
    it("calculates pass percentage correctly", () => {
      const output = "passed: 7, failed: 3, total: 10";

      const result = parseTestOutput(output, "");

      expect(result.stats.passPercentage).toBe(70);
    });

    it("handles zero total tests", () => {
      const output = "";

      const result = parseTestOutput(output, "");

      expect(result.stats.passPercentage).toBe(0);
    });

    it("handles 100% pass rate", () => {
      const output = "Tests: 5 passed, 5 total";

      const result = parseTestOutput(output, "");

      expect(result.stats.passPercentage).toBe(100);
    });

    it("handles 0% pass rate", () => {
      const output = "Tests: 5 failed, 5 total";

      const result = parseTestOutput(output, "");

      expect(result.stats.passPercentage).toBe(0);
    });
  });
});
