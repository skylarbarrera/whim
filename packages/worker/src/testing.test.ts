import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hasTestScript, parseTestOutput, runTests } from "./testing.js";

describe("testing module", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `worker-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("hasTestScript", () => {
    it("returns true when test script is defined", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          scripts: {
            test: "jest",
          },
        })
      );

      const result = await hasTestScript(testDir);
      expect(result).toBe(true);
    });

    it("returns false when test script is default npm placeholder", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          scripts: {
            test: 'echo "Error: no test specified" && exit 1',
          },
        })
      );

      const result = await hasTestScript(testDir);
      expect(result).toBe(false);
    });

    it("returns false when no test script exists", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          scripts: {
            build: "tsc",
          },
        })
      );

      const result = await hasTestScript(testDir);
      expect(result).toBe(false);
    });

    it("returns false when package.json does not exist", async () => {
      const result = await hasTestScript(testDir);
      expect(result).toBe(false);
    });

    it("returns false when package.json is invalid", async () => {
      await writeFile(join(testDir, "package.json"), "not json");

      const result = await hasTestScript(testDir);
      expect(result).toBe(false);
    });
  });

  describe("parseTestOutput", () => {
    it("parses Jest output format", () => {
      const stdout = `
PASS src/index.test.ts
PASS src/utils.test.ts

Test Suites: 2 passed, 2 total
Tests: 15 passed, 15 total
`;
      const result = parseTestOutput(stdout, "");
      expect(result.testsRun).toBe(15);
      expect(result.testsPassed).toBe(15);
      expect(result.testsFailed).toBe(0);
    });

    it("parses Jest output with failures", () => {
      const stdout = `
PASS src/index.test.ts
FAIL src/utils.test.ts

Test Suites: 1 passed, 1 failed, 2 total
Tests: 12 passed, 3 failed, 15 total
`;
      const result = parseTestOutput(stdout, "");
      expect(result.testsRun).toBe(15);
      expect(result.testsPassed).toBe(12);
      expect(result.testsFailed).toBe(3);
    });

    it("parses Vitest output format", () => {
      const stdout = `
 ✓ src/index.test.ts (5 tests)
 ✓ src/utils.test.ts (10 tests)

 Test Files  2 passed (2)
      Tests  15 passed (15)
`;
      const result = parseTestOutput(stdout, "");
      expect(result.testsRun).toBe(15);
      expect(result.testsPassed).toBe(15);
    });

    it("parses Bun test output format", () => {
      const stdout = `
bun test v1.0.0

src/index.test.ts:
✓ test 1
✓ test 2

10 pass, 2 fail, 12 total
`;
      const result = parseTestOutput(stdout, "");
      expect(result.testsRun).toBe(12);
      expect(result.testsPassed).toBe(10);
      expect(result.testsFailed).toBe(2);
    });

    it("falls back to counting PASS/FAIL occurrences", () => {
      const stdout = `
PASS: test 1
PASS: test 2
PASS: test 3
FAIL: test 4
`;
      const result = parseTestOutput(stdout, "");
      expect(result.testsRun).toBe(4);
      expect(result.testsPassed).toBe(3);
      expect(result.testsFailed).toBe(1);
    });

    it("returns zeros for unrecognized output", () => {
      const stdout = "Some random output";
      const result = parseTestOutput(stdout, "");
      expect(result.testsRun).toBe(0);
      expect(result.testsPassed).toBe(0);
      expect(result.testsFailed).toBe(0);
    });
  });

  describe("runTests", () => {
    it("returns skipped when no test script exists", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          name: "test-project",
        })
      );

      const result = await runTests(testDir);
      expect(result.status).toBe("skipped");
      expect(result.error).toContain("No test script defined");
    });

    it("runs tests and returns passed status", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          scripts: {
            test: "echo 'Tests: 5 passed, 5 total'",
          },
        })
      );

      const result = await runTests(testDir);
      expect(result.status).toBe("passed");
      expect(result.testsRun).toBe(5);
      expect(result.testsPassed).toBe(5);
    });

    it("runs tests and returns failed status", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          scripts: {
            test: "echo 'Tests: 3 passed, 2 failed, 5 total' && exit 1",
          },
        })
      );

      const result = await runTests(testDir);
      expect(result.status).toBe("failed");
      expect(result.testsRun).toBe(5);
      expect(result.testsPassed).toBe(3);
      expect(result.testsFailed).toBe(2);
    });

    it(
      "handles timeout",
      async () => {
        await writeFile(
          join(testDir, "package.json"),
          JSON.stringify({
            name: "test-project",
            scripts: {
              test: "sleep 10",
            },
          })
        );

        const result = await runTests(testDir, { timeout: 100 });
        expect(result.status).toBe("timeout");
        expect(result.error).toContain("timed out");
      },
      { timeout: 10000 }
    );

    it("uses custom command and args", async () => {
      const result = await runTests(testDir, {
        command: "echo",
        args: ["Tests: 10 passed, 10 total"],
      });
      expect(result.status).toBe("passed");
      expect(result.testsRun).toBe(10);
    });

    it("captures stdout and stderr", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          scripts: {
            test: "echo 'stdout output' && echo 'stderr output' >&2",
          },
        })
      );

      const result = await runTests(testDir);
      expect(result.stdout).toContain("stdout output");
      expect(result.stderr).toContain("stderr output");
    });
  });
});
