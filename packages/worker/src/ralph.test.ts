import { describe, it, expect } from "bun:test";
import { parseRalphEvent, type RalphEvent } from "./ralph.js";

describe("parseRalphEvent", () => {
  it("should parse ITERATION event with JSON data", () => {
    const line = '[RALPH:ITERATION] {"iteration": 5, "tokens": {"in": 100, "out": 50}}';
    const event = parseRalphEvent(line);

    expect(event).not.toBeNull();
    expect(event!.type).toBe("ITERATION");
    expect(event!.data.iteration).toBe(5);
    expect(event!.data.tokens).toEqual({ in: 100, out: 50 });
  });

  it("should parse FILE_EDIT event", () => {
    const line = '[RALPH:FILE_EDIT] {"files": ["src/index.ts", "src/utils.ts"]}';
    const event = parseRalphEvent(line);

    expect(event).not.toBeNull();
    expect(event!.type).toBe("FILE_EDIT");
    expect(event!.data.files).toEqual(["src/index.ts", "src/utils.ts"]);
  });

  it("should parse STUCK event", () => {
    const line = '[RALPH:STUCK] {"reason": "Cannot compile", "attempts": 3}';
    const event = parseRalphEvent(line);

    expect(event).not.toBeNull();
    expect(event!.type).toBe("STUCK");
    expect(event!.data.reason).toBe("Cannot compile");
    expect(event!.data.attempts).toBe(3);
  });

  it("should parse COMPLETE event", () => {
    const line = '[RALPH:COMPLETE] {"testsRun": 10, "testsPassed": 10}';
    const event = parseRalphEvent(line);

    expect(event).not.toBeNull();
    expect(event!.type).toBe("COMPLETE");
    expect(event!.data.testsRun).toBe(10);
    expect(event!.data.testsPassed).toBe(10);
  });

  it("should parse FAILED event", () => {
    const line = '[RALPH:FAILED] {"error": "Build failed"}';
    const event = parseRalphEvent(line);

    expect(event).not.toBeNull();
    expect(event!.type).toBe("FAILED");
    expect(event!.data.error).toBe("Build failed");
  });

  it("should handle event with plain text message", () => {
    const line = "[RALPH:ITERATION] Starting iteration 5";
    const event = parseRalphEvent(line);

    expect(event).not.toBeNull();
    expect(event!.type).toBe("ITERATION");
    expect(event!.data.message).toBe("Starting iteration 5");
  });

  it("should handle event without data", () => {
    const line = "[RALPH:COMPLETE]";
    const event = parseRalphEvent(line);

    expect(event).not.toBeNull();
    expect(event!.type).toBe("COMPLETE");
    expect(event!.data).toEqual({});
  });

  it("should return null for non-event lines", () => {
    expect(parseRalphEvent("Just some output")).toBeNull();
    expect(parseRalphEvent("")).toBeNull();
    expect(parseRalphEvent("[INFO] Not a ralph event")).toBeNull();
  });

  it("should preserve raw line", () => {
    const line = '[RALPH:ITERATION] {"iteration": 1}';
    const event = parseRalphEvent(line);

    expect(event!.raw).toBe(line);
  });
});
