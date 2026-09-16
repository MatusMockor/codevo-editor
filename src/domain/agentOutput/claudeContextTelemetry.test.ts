import { describe, expect, it } from "vitest";
import { parseClaudeStreamJsonLine } from "./claudeStreamJson";

const parse = (value: unknown) => parseClaudeStreamJsonLine(JSON.stringify(value));
const assistant = (usage: unknown, extra = {}) => ({
  type: "assistant",
  message: { model: "claude-main", content: [], usage },
  ...extra,
});

describe("Claude context telemetry", () => {
  it("adds cache read and cache creation only for one primary assistant request", () => {
    expect(
      parse(
        assistant({
          input_tokens: 10,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30,
        }),
      ),
    ).toMatchObject({
      events: [
        { kind: "contextUsage", model: "claude-main", inputTokens: 60, contextWindow: null },
      ],
    });
  });
  it.each([
    { input_tokens: -1 },
    { input_tokens: 1, cache_read_input_tokens: -1 },
    { input_tokens: 1, cache_creation_input_tokens: null },
    { input_tokens: Number.MAX_SAFE_INTEGER, cache_read_input_tokens: 1 },
  ])("rejects invalid or overflowing input %j", (usage) => {
    expect(parse(assistant(usage))).toMatchObject({ events: [] });
  });
  it("excludes subagent and synthetic/error assistant responses", () => {
    expect(parse(assistant({ input_tokens: 1 }, { parent_tool_use_id: "tool-1" }))).toMatchObject({
      events: [],
    });
    expect(parse(assistant({ input_tokens: 1 }, { error: "api_error" }))).toMatchObject({
      events: [],
    });
    expect(
      parse({
        type: "assistant",
        message: { model: "<synthetic>", content: [], usage: { input_tokens: 1 } },
      }),
    ).toMatchObject({ events: [] });
  });
  it("preserves model capacities separately from aggregate totals", () => {
    expect(
      parse({
        type: "result",
        subtype: "success",
        modelUsage: {
          "claude-main": { inputTokens: 90000, contextWindow: 200000 },
          child: { contextWindow: 100000 },
        },
      }),
    ).toMatchObject({
      events: [
        { kind: "result" },
        { kind: "contextUsage", model: "claude-main", inputTokens: null, contextWindow: 200000 },
        { kind: "contextUsage", model: "child", inputTokens: null, contextWindow: 100000 },
      ],
    });
  });
  it("bounds model metadata and rejects zero windows", () => {
    expect(
      parse({
        type: "result",
        subtype: "success",
        modelUsage: Object.fromEntries(
          Array.from({ length: 17 }, (_, i) => [String(i), { contextWindow: 100 }]),
        ),
      }),
    ).toMatchObject({ events: [{ kind: "result" }] });
    expect(
      parse({ type: "result", subtype: "success", modelUsage: { bad: { contextWindow: 0 } } }),
    ).toMatchObject({ events: [{ kind: "result" }] });
  });
  it.each([
    ["compacting", "compacting"],
    [null, "idle"],
    ["requesting", "idle"],
  ])("maps system status %s", (status, expected) => {
    expect(parse({ type: "system", subtype: "status", status })).toMatchObject({
      events: [{ kind: "contextCompactionStatus", status: expected, message: null }],
    });
  });
  it("surfaces explicit compact failure without fabricating completion", () => {
    expect(
      parse({
        type: "system",
        subtype: "status",
        status: null,
        compact_result: "failed",
        compact_error: "cannot compact",
      }),
    ).toMatchObject({
      events: [{ kind: "contextCompactionStatus", status: "failed", message: "cannot compact" }],
    });
  });
});

it("ignores child compaction boundaries and unknown compact outcomes", () => {
  expect(
    parse({ type: "system", subtype: "compact_boundary", parent_tool_use_id: "child" }),
  ).toEqual({ kind: "ignored" });
  expect(parse({ type: "system", subtype: "compact_result", success: true })).toEqual({
    kind: "ignored",
  });
});

it.each([undefined, "future", 0, false])(
  "rejects malformed compaction status %s even with a known outcome",
  (status) => {
    expect(
      parse({
        type: "system",
        subtype: "status",
        status,
        compact_result: "failed",
        compact_error: "error",
      }),
    ).toEqual({ kind: "ignored" });
  },
);
