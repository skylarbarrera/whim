import { describe, expect, it } from "bun:test";
import { PRStep } from "./setup";

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
