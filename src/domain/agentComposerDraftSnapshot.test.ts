import { describe, expect, it } from "vitest";
import { MAX_AGENT_TASK_PROMPT_BYTES } from "./agentTask";
import {
  MAX_AGENT_COMPOSER_DRAFT_KEY_CHARS,
  MAX_AGENT_COMPOSER_DRAFT_SNAPSHOT_RAW_CHARS,
  MAX_AGENT_COMPOSER_DRAFT_TEXT_BYTES,
  MAX_PERSISTED_AGENT_COMPOSER_DRAFTS,
  MAX_PERSISTED_AGENT_COMPOSER_DRAFT_TOTAL_BYTES,
  parseAgentComposerDraftSnapshot,
  serializeAgentComposerDraftSnapshot,
  type AgentComposerDraftEntry,
} from "./agentComposerDraftSnapshot";

function wire(drafts: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 1, drafts, ...extra });
}

function keys(entries: readonly AgentComposerDraftEntry[]): readonly string[] {
  return entries.map(([key]) => key);
}

describe("agentComposerDraftSnapshot", () => {
  it("pins the documented bounds", () => {
    expect(MAX_PERSISTED_AGENT_COMPOSER_DRAFTS).toBe(32);
    expect(MAX_PERSISTED_AGENT_COMPOSER_DRAFT_TOTAL_BYTES).toBe(256 * 1_024);
    expect(MAX_AGENT_COMPOSER_DRAFT_KEY_CHARS).toBe(4_160);
    expect(MAX_AGENT_COMPOSER_DRAFT_TEXT_BYTES).toBe(2 * MAX_AGENT_TASK_PROMPT_BYTES);
  });

  it("writes the versioned wire format oldest-first and parses it back identically", () => {
    const entries: readonly AgentComposerDraftEntry[] = [
      ["agt-mue1wenj-7ede", "reply to the agent"],
      ["agt-mue1wenj-9c1f", 'follow up\nwith "quotes" and é'],
    ];

    const raw = serializeAgentComposerDraftSnapshot(entries);

    expect(JSON.parse(raw)).toEqual({
      version: 1,
      drafts: [
        ["agt-mue1wenj-7ede", "reply to the agent"],
        ["agt-mue1wenj-9c1f", 'follow up\nwith "quotes" and é'],
      ],
    });
    expect(parseAgentComposerDraftSnapshot(raw)).toEqual(entries);
  });

  it("never writes a new-thread draft so it cannot survive a restart", () => {
    const raw = serializeAgentComposerDraftSnapshot([
      ["agt-mue1wenj-7ede", "reply to the agent"],
      ["new:/workspace/app", "start a new thread"],
      ["new:remote:server:runner:project", "start a remote thread"],
    ]);

    expect(JSON.parse(raw)).toEqual({
      version: 1,
      drafts: [["agt-mue1wenj-7ede", "reply to the agent"]],
    });
    expect(parseAgentComposerDraftSnapshot(raw)).toEqual([
      ["agt-mue1wenj-7ede", "reply to the agent"],
    ]);
  });

  it("serializes a snapshot holding only ephemeral drafts to the empty snapshot", () => {
    const raw = serializeAgentComposerDraftSnapshot([
      ["new:/workspace/app", "start a new thread"],
      ["clone:local:p-1", "clone drafts are ephemeral"],
    ]);

    expect(raw).toBe(serializeAgentComposerDraftSnapshot([]));
    expect(parseAgentComposerDraftSnapshot(raw)).toEqual([]);
  });

  it("does not let ephemeral drafts consume the entry cap of persisted ones", () => {
    const ephemeral = Array.from(
      { length: MAX_PERSISTED_AGENT_COMPOSER_DRAFTS },
      (_, index): AgentComposerDraftEntry => [`new:/workspace/app-${index}`, `draft ${index}`],
    );

    const raw = serializeAgentComposerDraftSnapshot([["agt-1", "kept"], ...ephemeral]);

    expect(parseAgentComposerDraftSnapshot(raw)).toEqual([["agt-1", "kept"]]);
  });

  it("serializes an empty snapshot and parses it to no entries", () => {
    const raw = serializeAgentComposerDraftSnapshot([]);

    expect(raw).toBe('{"version":1,"drafts":[]}');
    expect(parseAgentComposerDraftSnapshot(raw)).toEqual([]);
  });

  it.each([
    ["nothing stored", null],
    ["an empty string", ""],
    ["garbage JSON", "{version:1"],
    ["a JSON string", '"drafts"'],
    ["null", "null"],
    ["a top-level array", '[["agt-1","text"]]'],
    ["an unknown version", '{"version":2,"drafts":[["agt-1","text"]]}'],
    ["a string version", '{"version":"1","drafts":[["agt-1","text"]]}'],
    ["a missing version", '{"drafts":[["agt-1","text"]]}'],
    ["missing drafts", '{"version":1}'],
    ["drafts that are not an array", '{"version":1,"drafts":{"agt-1":"text"}}'],
    ["an unknown top-level field", wire([["agt-1", "text"]], { savedAt: 1 })],
  ])("fails closed to no drafts for %s", (_label, raw) => {
    expect(parseAgentComposerDraftSnapshot(raw)).toEqual([]);
  });

  it("rejects an oversize payload before parsing it", () => {
    const padded = `${wire([["agt-1", "text"]])}${" ".repeat(MAX_AGENT_COMPOSER_DRAFT_SNAPSHOT_RAW_CHARS)}`;

    expect(parseAgentComposerDraftSnapshot(padded)).toEqual([]);
  });

  it("drops malformed and ineligible entries but keeps the valid ones", () => {
    const raw = wire([
      ["agt-1", "kept"],
      ["agt-2"],
      ["agt-3", "text", "extra"],
      [7, "numeric key"],
      ["agt-4", 7],
      { key: "agt-5", text: "object" },
      "agt-6",
      ["", "empty key"],
      ["agt-7", ""],
      ["clone:local:p-1", "clone drafts are ephemeral"],
      ["k".repeat(MAX_AGENT_COMPOSER_DRAFT_KEY_CHARS + 1), "long key"],
      ["agt-8", "a".repeat(MAX_AGENT_COMPOSER_DRAFT_TEXT_BYTES + 1)],
      ["agt-9", "é".repeat(MAX_AGENT_COMPOSER_DRAFT_TEXT_BYTES / 2 + 1)],
      ["new:/workspace/app", "new-thread drafts are ephemeral"],
      ["agt-10", "also kept"],
    ]);

    expect(parseAgentComposerDraftSnapshot(raw)).toEqual([
      ["agt-1", "kept"],
      ["agt-10", "also kept"],
    ]);
  });

  it("accepts a key and a text exactly at their limits", () => {
    const longKey = "k".repeat(MAX_AGENT_COMPOSER_DRAFT_KEY_CHARS);
    const fullText = "a".repeat(MAX_AGENT_COMPOSER_DRAFT_TEXT_BYTES);

    expect(parseAgentComposerDraftSnapshot(wire([[longKey, fullText]]))).toEqual([
      [longKey, fullText],
    ]);
  });

  it("keeps the newest entry for a duplicated key at its newest position", () => {
    const raw = wire([
      ["agt-1", "old"],
      ["agt-2", "two"],
      ["agt-1", "new"],
    ]);

    expect(parseAgentComposerDraftSnapshot(raw)).toEqual([
      ["agt-2", "two"],
      ["agt-1", "new"],
    ]);
  });

  it("keeps only the newest entries past the entry cap", () => {
    const entries = Array.from(
      { length: MAX_PERSISTED_AGENT_COMPOSER_DRAFTS + 5 },
      (_, index): AgentComposerDraftEntry => [`agt-${index}`, `draft ${index}`],
    );

    const parsed = parseAgentComposerDraftSnapshot(wire(entries));

    expect(parsed).toHaveLength(MAX_PERSISTED_AGENT_COMPOSER_DRAFTS);
    expect(parsed[0]).toEqual(["agt-5", "draft 5"]);
    expect(parsed[parsed.length - 1]).toEqual([
      `agt-${MAX_PERSISTED_AGENT_COMPOSER_DRAFTS + 4}`,
      `draft ${MAX_PERSISTED_AGENT_COMPOSER_DRAFTS + 4}`,
    ]);
  });

  it("keeps only the newest entries within the total byte budget", () => {
    const big = "é".repeat(MAX_AGENT_COMPOSER_DRAFT_TEXT_BYTES / 2);
    const entries: readonly AgentComposerDraftEntry[] = [
      ["agt-0", big],
      ["agt-1", big],
      ["agt-2", big],
      ["agt-3", big],
      ["agt-4", big],
      ["agt-5", "small"],
    ];

    expect(keys(parseAgentComposerDraftSnapshot(wire(entries)))).toEqual([
      "agt-2",
      "agt-3",
      "agt-4",
      "agt-5",
    ]);
  });

  it("still keeps an older small draft after a big one no longer fits the budget", () => {
    const big = "é".repeat(MAX_AGENT_COMPOSER_DRAFT_TEXT_BYTES / 2);
    const entries: readonly AgentComposerDraftEntry[] = [
      ["agt-small", "short note"],
      ["agt-0", big],
      ["agt-1", big],
      ["agt-2", big],
      ["agt-3", big],
      ["agt-4", big],
    ];

    expect(keys(parseAgentComposerDraftSnapshot(wire(entries)))).toEqual([
      "agt-small",
      "agt-2",
      "agt-3",
      "agt-4",
    ]);
  });

  it("applies the same bounds when serializing so the written snapshot parses back identically", () => {
    const big = "a".repeat(MAX_AGENT_COMPOSER_DRAFT_TEXT_BYTES);
    const entries: readonly AgentComposerDraftEntry[] = [
      ["agt-0", big],
      ["clone:local:p-1", "ephemeral"],
      ["agt-1", big],
      ["agt-2", big],
      ["agt-3", big],
      ["", "empty key"],
      ["agt-4", "small"],
      ["agt-3", big],
    ];

    const raw = serializeAgentComposerDraftSnapshot(entries);
    const parsed = parseAgentComposerDraftSnapshot(raw);

    expect(keys(parsed)).toEqual(["agt-1", "agt-2", "agt-4", "agt-3"]);
    expect(serializeAgentComposerDraftSnapshot(parsed)).toBe(raw);
  });

  it("drops the oldest entries when JSON escaping would exceed the raw payload cap", () => {
    const escaped = "\u0001".repeat(40_000);
    const entries = Array.from({ length: 6 }, (_, index): AgentComposerDraftEntry => [
      `agt-${index}`,
      escaped,
    ]);

    const raw = serializeAgentComposerDraftSnapshot(entries);
    const parsed = parseAgentComposerDraftSnapshot(raw);

    expect(raw.length).toBeLessThanOrEqual(MAX_AGENT_COMPOSER_DRAFT_SNAPSHOT_RAW_CHARS);
    expect(parsed.length).toBeLessThan(entries.length);
    expect(parsed[parsed.length - 1]).toEqual(["agt-5", escaped]);
    expect(serializeAgentComposerDraftSnapshot(parsed)).toBe(raw);
  });
});
