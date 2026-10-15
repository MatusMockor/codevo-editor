import { describe, expect, it } from "vitest";
import {
  MAX_PRETTY_JSON_CHARS,
  MAX_PRETTY_JSON_DEPTH,
  reindentJson,
} from "./agentToolRowOutputFormatJson";

describe("reindentJson", () => {
  it("matches JSON.stringify indentation for ordinary documents", () => {
    const value = { a: [1, { b: null, c: [] }, {}], d: "x", e: true, f: -1.5e3 };
    expect(reindentJson(JSON.stringify(value))).toBe(JSON.stringify(value, null, 2));
    expect(reindentJson(" [ ] ")).toBe("[]");
    expect(reindentJson("{\n}")).toBe("{}");
  });

  it("keeps big integers, number spelling and duplicate keys verbatim", () => {
    expect(reindentJson('{"n":12345678901234567890,"f":1.50,"e":1E+2,"k":1,"k":2}')).toBe(
      '{\n  "n": 12345678901234567890,\n  "f": 1.50,\n  "e": 1E+2,\n  "k": 1,\n  "k": 2\n}',
    );
  });

  it("keeps string escapes exactly as written", () => {
    expect(reindentJson('["\\u00e9\\n\\"q\\"\\/", "a,b:{c}"]')).toBe(
      '[\n  "\\u00e9\\n\\"q\\"\\/",\n  "a,b:{c}"\n]',
    );
  });

  it.each([
    "[1,]",
    '{"a":1,}',
    "[01]",
    "['a']",
    '["a\tb"]',
    '["\\x"]',
    "[1 2]",
    '{"a" 1}',
    "{1:2}",
    "[1]]",
    "[1] x",
    "[1",
    '{"a":tru}',
    "[NaN]",
    "{]",
  ])("rejects invalid JSON %s", (text) => {
    expect(reindentJson(text)).toBeNull();
  });

  it("bounds nesting depth without exploding", () => {
    const allowed = "[".repeat(MAX_PRETTY_JSON_DEPTH) + "]".repeat(MAX_PRETTY_JSON_DEPTH);
    expect(reindentJson(allowed)).not.toBeNull();
    const deeper = "[".repeat(MAX_PRETTY_JSON_DEPTH + 1) + "]".repeat(MAX_PRETTY_JSON_DEPTH + 1);
    expect(reindentJson(deeper)).toBeNull();
    const pathological = "[".repeat(3_000) + "1" + "]".repeat(3_000);
    expect(reindentJson(pathological)).toBeNull();
  });

  it("bounds the formatted size and falls back", () => {
    const nested =
      "[".repeat(60) + Array.from({ length: 10_000 }, () => "1").join(",") + "]".repeat(60);
    expect(nested.length).toBeLessThan(30_000);
    expect(reindentJson(nested)).toBeNull();
    const wide = `[${Array.from({ length: 1_000 }, () => "1").join(",")}]`;
    expect(reindentJson(wide)?.length).toBeLessThan(MAX_PRETTY_JSON_CHARS);
  });
});
