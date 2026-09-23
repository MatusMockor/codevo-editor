import { describe, expect, it } from "vitest";
import {
  MAX_RUNTIME_SUBAGENT_RECENT_ACTIVITY,
  MAX_RUNTIME_SUBAGENT_RECENT_ACTIVITY_CHARACTERS,
  appendAgentRuntimeSubagentActivity,
  boundedAgentRuntimeSubagentActivity,
  sameAgentRuntimeSubagentActivity,
} from "./agentRuntimeSubagentActivity";

function appendAll(lines: ReadonlyArray<string | undefined>): ReadonlyArray<string> {
  return lines.reduce<ReadonlyArray<string>>(
    (history, line) => appendAgentRuntimeSubagentActivity(history, line),
    [],
  );
}

describe("agent runtime subagent recent activity", () => {
  it("keeps the newest six entries and evicts the oldest first", () => {
    const history = appendAll(Array.from({ length: 10 }, (_, index) => `Step ${index}`));

    expect(history).toHaveLength(MAX_RUNTIME_SUBAGENT_RECENT_ACTIVITY);
    expect(history).toEqual(["Step 4", "Step 5", "Step 6", "Step 7", "Step 8", "Step 9"]);
  });

  it("evicts deterministically so replaying the same stream yields the same history", () => {
    const stream = Array.from({ length: 40 }, (_, index) => `Line ${index % 7}`);

    expect(appendAll(stream)).toEqual(appendAll(stream));
  });

  it("collapses consecutive duplicates but keeps a repeated line after a different one", () => {
    const history = appendAll(["Read", "Read", "Grep", "Read"]);

    expect(history).toEqual(["Read", "Grep", "Read"]);
  });

  it("returns the same instance when nothing is appended", () => {
    const history = appendAll(["Read"]);

    expect(appendAgentRuntimeSubagentActivity(history, undefined)).toBe(history);
    expect(appendAgentRuntimeSubagentActivity(history, "   ")).toBe(history);
    expect(appendAgentRuntimeSubagentActivity(history, " Read ")).toBe(history);
  });

  it("normalizes to one bounded line per entry on code point boundaries", () => {
    const [entry] = appendAll([`first\n  second ${"😀".repeat(400)}`]);

    expect(entry?.startsWith("first second ")).toBe(true);
    expect([...(entry ?? "")]).toHaveLength(MAX_RUNTIME_SUBAGENT_RECENT_ACTIVITY_CHARACTERS);
    expect(entry?.endsWith("…")).toBe(true);
  });

  it("re-bounds untrusted source history", () => {
    const history = boundedAgentRuntimeSubagentActivity(
      Array.from({ length: 9 }, (_, index) => ` Step ${index} `),
    );

    expect(history).toEqual(["Step 3", "Step 4", "Step 5", "Step 6", "Step 7", "Step 8"]);
    expect(boundedAgentRuntimeSubagentActivity(undefined)).toEqual([]);
  });

  it("compares histories by content", () => {
    expect(sameAgentRuntimeSubagentActivity(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameAgentRuntimeSubagentActivity(["a", "b"], ["a"])).toBe(false);
    expect(sameAgentRuntimeSubagentActivity(["a", "b"], ["a", "c"])).toBe(false);
  });
});
