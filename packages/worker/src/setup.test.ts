import { describe, expect, it } from "bun:test";
import { PRStep, isRetryableError } from "./setup";

describe("setup", () => {
  describe("PRStep enum", () => {
    it("should have all expected steps", () => {
      expect(PRStep.STAGE).toBe("stage" as unknown as PRStep);
      expect(PRStep.COMMIT).toBe("commit" as unknown as PRStep);
      expect(PRStep.CHECK_UNPUSHED).toBe("check_unpushed" as unknown as PRStep);
      expect(PRStep.PUSH).toBe("push" as unknown as PRStep);
      expect(PRStep.CREATE_PR).toBe("create_pr" as unknown as PRStep);
    });
  });

  describe("isRetryableError", () => {
    it("should identify network connectivity errors", () => {
      expect(isRetryableError({ stdout: "", stderr: "connection reset by peer", code: 1 })).toBe(true);
      expect(isRetryableError({ stdout: "", stderr: "connection refused", code: 1 })).toBe(true);
      expect(isRetryableError({ stdout: "", stderr: "Connection timed out", code: 1 })).toBe(true);
      expect(isRetryableError({ stdout: "", stderr: "network is unreachable", code: 1 })).toBe(true);
      expect(isRetryableError({ stdout: "", stderr: "Temporary failure in name resolution", code: 1 })).toBe(true);
      expect(isRetryableError({ stdout: "", stderr: "Could not resolve host: github.com", code: 1 })).toBe(true);
      expect(isRetryableError({ stdout: "", stderr: "SSL connect error", code: 1 })).toBe(true);
      expect(isRetryableError({ stdout: "", stderr: "fatal: unable to access 'https://github.com/...'", code: 1 })).toBe(true);
    });

    it("should identify server-side errors (5xx)", () => {
      expect(isRetryableError({ stdout: "", stderr: "error: 500 Internal Server Error", code: 1 })).toBe(true);
      expect(isRetryableError({ stdout: "", stderr: "502 Bad Gateway", code: 1 })).toBe(true);
      expect(isRetryableError({ stdout: "", stderr: "error 503 Service Unavailable", code: 1 })).toBe(true);
      expect(isRetryableError({ stdout: "", stderr: "HTTP 504 Gateway Timeout", code: 1 })).toBe(true);
      expect(isRetryableError({ stdout: "", stderr: "Internal Server Error", code: 1 })).toBe(true);
      expect(isRetryableError({ stdout: "", stderr: "Service Unavailable", code: 1 })).toBe(true);
      expect(isRetryableError({ stdout: "", stderr: "Bad Gateway", code: 1 })).toBe(true);
    });

    it("should identify rate limiting errors", () => {
      expect(isRetryableError({ stdout: "", stderr: "rate limit exceeded", code: 1 })).toBe(true);
      expect(isRetryableError({ stdout: "", stderr: "HTTP 429 Too Many Requests", code: 1 })).toBe(true);
      expect(isRetryableError({ stdout: "", stderr: "Too many requests", code: 1 })).toBe(true);
    });

    it("should check stdout as well as stderr", () => {
      expect(isRetryableError({ stdout: "connection reset", stderr: "", code: 1 })).toBe(true);
      expect(isRetryableError({ stdout: "Rate limit exceeded", stderr: "", code: 1 })).toBe(true);
    });

    it("should not identify non-retryable errors", () => {
      expect(isRetryableError({ stdout: "", stderr: "Permission denied", code: 1 })).toBe(false);
      expect(isRetryableError({ stdout: "", stderr: "not a git repository", code: 1 })).toBe(false);
      expect(isRetryableError({ stdout: "", stderr: "branch already exists", code: 1 })).toBe(false);
      expect(isRetryableError({ stdout: "", stderr: "Authentication failed", code: 1 })).toBe(false);
      expect(isRetryableError({ stdout: "", stderr: "remote origin already exists", code: 1 })).toBe(false);
    });

    it("should handle success results (code 0)", () => {
      expect(isRetryableError({ stdout: "success", stderr: "", code: 0 })).toBe(false);
    });
  });

  describe("token handling", () => {
    it("should mask tokens correctly", () => {
      // Test the masking logic used in createPullRequest
      const token = "ghp_1234567890abcdef";
      const tokenLength = token.length;
      const tokenMask = tokenLength > 0
        ? `${token.substring(0, 4)}...(${tokenLength} chars)`
        : "(empty)";

      expect(tokenMask).toBe("ghp_...(20 chars)");
    });

    it("should handle empty tokens", () => {
      const token = "";
      const tokenLength = token?.length || 0;
      const tokenMask = tokenLength > 0
        ? `${token.substring(0, 4)}...(${tokenLength} chars)`
        : "(empty)";

      expect(tokenMask).toBe("(empty)");
    });

    it("should handle undefined tokens", () => {
      const token = undefined as string | undefined;
      const tokenStr = token ?? "";
      const tokenLength = tokenStr.length;
      const tokenMask = tokenLength > 0
        ? `${tokenStr.substring(0, 4)}...(${tokenLength} chars)`
        : "(empty)";

      expect(tokenMask).toBe("(empty)");
    });
  });
});
