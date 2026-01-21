import { describe, it, expect } from "bun:test";
import { getHarness } from "./index";

describe("Harness", () => {
  it("should export getHarness function", () => {
    expect(typeof getHarness).toBe("function");
  });

  it("should return claude harness by default", () => {
    const harness = getHarness();
    expect(harness.name).toBe("claude");
  });

  it("should return codex harness when specified", () => {
    const harness = getHarness("codex");
    expect(harness.name).toBe("codex");
  });

  it("should return opencode harness when specified", () => {
    const harness = getHarness("opencode");
    expect(harness.name).toBe("opencode");
  });
});
