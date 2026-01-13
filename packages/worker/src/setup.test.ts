import { describe, expect, it } from "bun:test";
import { PRStep } from "./setup";

describe("setup", () => {
  describe("PRStep enum", () => {
    it("should have all expected steps", () => {
      expect(PRStep.STAGE).toBe("stage");
      expect(PRStep.COMMIT).toBe("commit");
      expect(PRStep.CHECK_UNPUSHED).toBe("check_unpushed");
      expect(PRStep.PUSH).toBe("push");
      expect(PRStep.CREATE_PR).toBe("create_pr");
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
      const token: string | undefined = undefined;
      const tokenLength = token?.length || 0;
      const tokenMask = tokenLength > 0
        ? `${token!.substring(0, 4)}...(${tokenLength} chars)`
        : "(empty)";

      expect(tokenMask).toBe("(empty)");
    });
  });
});
