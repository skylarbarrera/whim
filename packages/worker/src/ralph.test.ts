import { describe, it, expect } from "bun:test";
import { parseRalphEvent, type RalphEvent } from "./ralph.js";

describe("parseRalphEvent", () => {
  it("should parse started event", () => {
    const line = '{"event":"started","spec":"SPEC.md","tasks":5,"timestamp":"2024-01-01T00:00:00Z"}';
    const event = parseRalphEvent(line);

    expect(event).not.toBeNull();
    expect(event!.event).toBe("started");
    expect(event!.tasks).toBe(5);
  });

  it("should parse iteration event", () => {
    const line = '{"event":"iteration","n":1,"phase":"working"}';
    const event = parseRalphEvent(line);

    expect(event).not.toBeNull();
    expect(event!.event).toBe("iteration");
    expect(event!.n).toBe(1);
  });

  it("should parse tool event", () => {
    const line = '{"event":"tool","type":"write","path":"src/index.ts"}';
    const event = parseRalphEvent(line);

    expect(event).not.toBeNull();
    expect(event!.event).toBe("tool");
    expect(event!.type).toBe("write");
    expect(event!.path).toBe("src/index.ts");
  });

  it("should parse complete event", () => {
    const line = '{"event":"complete","tasks_done":5,"total_duration_ms":180000}';
    const event = parseRalphEvent(line);

    expect(event).not.toBeNull();
    expect(event!.event).toBe("complete");
    expect(event!.tasks_done).toBe(5);
  });

  it("should parse stuck event", () => {
    const line = '{"event":"stuck","reason":"No progress","iterations_without_progress":3}';
    const event = parseRalphEvent(line);

    expect(event).not.toBeNull();
    expect(event!.event).toBe("stuck");
    expect(event!.reason).toBe("No progress");
  });

  it("should parse failed event", () => {
    const line = '{"event":"failed","error":"Build failed"}';
    const event = parseRalphEvent(line);

    expect(event).not.toBeNull();
    expect(event!.event).toBe("failed");
    expect(event!.error).toBe("Build failed");
  });

  it("should return null for non-JSON lines", () => {
    expect(parseRalphEvent("Just some output")).toBeNull();
    expect(parseRalphEvent("")).toBeNull();
    expect(parseRalphEvent("[INFO] Not a ralph event")).toBeNull();
  });

  it("should return null for JSON without event field", () => {
    expect(parseRalphEvent('{"foo":"bar"}')).toBeNull();
  });
});
