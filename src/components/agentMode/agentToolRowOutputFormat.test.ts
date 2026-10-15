import { describe, expect, it } from "vitest";
import {
  agentToolOutputFormat,
  MAX_TOOL_OUTPUT_JSON_BYTES,
  prettyJson,
} from "./agentToolRowOutputFormat";

describe("agentToolOutputFormat", () => {
  it("pretty-prints JSON objects and arrays with two spaces", () => {
    expect(prettyJson('  {"a":1,"b":[true,null]}\n')).toBe(
      '{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}',
    );
    expect(prettyJson("[1,2]")).toBe("[\n  1,\n  2\n]");
    expect(
      agentToolOutputFormat({ rowKind: "other", inputSummary: "", output: '{"ok":true}' }),
    ).toEqual({ kind: "code", text: '{\n  "ok": true\n}', language: "json" });
  });

  it("keeps invalid, scalar and non-bracketed output plain", () => {
    expect(prettyJson('{"a":')).toBeNull();
    expect(prettyJson("42")).toBeNull();
    expect(prettyJson('"text"')).toBeNull();
    expect(
      agentToolOutputFormat({ rowKind: "command", inputSummary: "ls", output: "{oops" }),
    ).toEqual({ kind: "plain", text: "{oops" });
  });

  it("reformats losslessly and falls back to raw for pathological nesting", () => {
    const raw = '{"big":9007199254740993123,"dup":1,"dup":2}';
    expect(agentToolOutputFormat({ rowKind: "other", inputSummary: "", output: raw })).toEqual({
      kind: "code",
      text: '{\n  "big": 9007199254740993123,\n  "dup": 1,\n  "dup": 2\n}',
      language: "json",
    });
    const deep = "[".repeat(3_000) + "]".repeat(3_000);
    expect(agentToolOutputFormat({ rowKind: "other", inputSummary: "", output: deep })).toEqual({
      kind: "plain",
      text: deep,
    });
  });

  it("does not parse output above the JSON byte budget", () => {
    const filler = "x".repeat(MAX_TOOL_OUTPUT_JSON_BYTES);
    expect(prettyJson(`{"a":"${filler}"}`)).toBeNull();
    const wide = "é".repeat(MAX_TOOL_OUTPUT_JSON_BYTES / 2);
    expect(prettyJson(`{"a":"${wide}"}`)).toBeNull();
  });

  it("uses the read path language only for unnumbered read output", () => {
    expect(
      agentToolOutputFormat({
        rowKind: "read",
        inputSummary: "src/app.ts",
        output: "const a = 1;",
      }),
    ).toEqual({ kind: "code", text: "const a = 1;", language: "typescript" });
    expect(
      agentToolOutputFormat({
        rowKind: "read",
        inputSummary: "src/app.ts",
        output: "     1\tconst a = 1;",
      }),
    ).toEqual({ kind: "plain", text: "     1\tconst a = 1;" });
    expect(
      agentToolOutputFormat({
        rowKind: "command",
        inputSummary: "cat src/app.ts",
        output: "const a",
      }),
    ).toEqual({ kind: "plain", text: "const a" });
    expect(
      agentToolOutputFormat({ rowKind: "read", inputSummary: "README", output: "hello" }),
    ).toEqual({ kind: "plain", text: "hello" });
  });
});
