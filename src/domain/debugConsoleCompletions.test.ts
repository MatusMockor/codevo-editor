import { describe, expect, it } from "vitest";
import {
  MAX_DEBUG_COMPLETION_PREFIX_BYTES,
  debugConsoleCompletionContextAt,
} from "./debugConsoleCompletions";

describe("debugConsoleCompletionContextAt", () => {
  it("builds an immutable lexical query and UTF-16 replacement", () => {
    const source = "😀 + použív";
    const result = debugConsoleCompletionContextAt(source, source.length);

    expect(result).toEqual({
      prefix: "použív",
      query: { kind: "lexical", prefix: "použív" },
      replacement: { start: 5, end: 11 },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.query)).toBe(true);
    expect(Object.isFrozen(result?.replacement)).toBe(true);
  });

  it("represents static receivers without sending an evaluable expression", () => {
    const source = 'this.users[0]["displayName"].toL';
    const result = debugConsoleCompletionContextAt(source, source.length);

    expect(result).toEqual({
      prefix: "toL",
      query: {
        kind: "member",
        root: { kind: "this" },
        path: ["users", "0", "displayName"],
        prefix: "toL",
      },
      replacement: { start: source.length - 3, end: source.length },
    });
    expect(Object.isFrozen(result?.query)).toBe(true);
    expect(Object.isFrozen(result?.query.kind === "member" ? result.query.path : null)).toBe(true);
  });

  it("keeps a binding root and supports an empty member prefix", () => {
    expect(debugConsoleCompletionContextAt("account.profile.", 16)).toEqual({
      prefix: "",
      query: {
        kind: "member",
        root: { kind: "binding", name: "account" },
        path: ["profile"],
        prefix: "",
      },
      replacement: { start: 16, end: 16 },
    });
  });

  it("offers an empty lexical query only on an otherwise empty line", () => {
    expect(debugConsoleCompletionContextAt("previous\n  ", 11)).toEqual({
      prefix: "",
      query: { kind: "lexical", prefix: "" },
      replacement: { start: 11, end: 11 },
    });
    for (const source of ["/* open\n  ", "`template\n  "]) {
      expect(debugConsoleCompletionContextAt(source, source.length)).toBeNull();
    }
  });

  it.each([
    '"account.na"',
    "// account.na",
    "/* account.na */",
    "account().na",
    "account[key].na",
    "account?.na",
    "account.#na",
    "account['name'].na",
    'account["\\u006eame"].na',
    "account[01].na",
    "if.member",
  ])("rejects unsafe or non-canonical query %s", (source) => {
    expect(debugConsoleCompletionContextAt(source, source.length)).toBeNull();
  });

  it("accepts canonical JSON escapes without control characters and decodes the path", () => {
    const source = 'account["a\\"b"].na';
    expect(debugConsoleCompletionContextAt(source, source.length)?.query).toEqual({
      kind: "member",
      root: { kind: "binding", name: "account" },
      path: ['a"b'],
      prefix: "na",
    });
    expect(
      debugConsoleCompletionContextAt(
        'account["line\\nfeed"].na',
        'account["line\\nfeed"].na'.length,
      ),
    ).toBeNull();
  });

  it("caps the receiver at eight segments", () => {
    const accepted = `root.${Array.from({ length: 7 }, (_, index) => `p${index}`).join(".")}.x`;
    const rejected = `${accepted}.ninth`;
    expect(debugConsoleCompletionContextAt(accepted, accepted.length)).not.toBeNull();
    expect(debugConsoleCompletionContextAt(rejected, rejected.length)).toBeNull();
  });

  it("enforces prefix and structured-query byte limits", () => {
    const oversizedPrefix = "x".repeat(MAX_DEBUG_COMPLETION_PREFIX_BYTES + 1);
    expect(debugConsoleCompletionContextAt(oversizedPrefix, oversizedPrefix.length)).toBeNull();

    const largePath = `root["${"x".repeat(4_090)}"].member`;
    expect(debugConsoleCompletionContextAt(largePath, largePath.length)).toBeNull();
  });

  it("rejects an oversized console input before suffix scanning", () => {
    const oversizedSource = `${"a + ".repeat(1_025)}member`;
    expect(debugConsoleCompletionContextAt(oversizedSource, oversizedSource.length)).toBeNull();
  });

  it("rejects invalid cursors and malformed Unicode", () => {
    expect(debugConsoleCompletionContextAt("name", -1)).toBeNull();
    expect(debugConsoleCompletionContextAt("name", 5)).toBeNull();
    expect(debugConsoleCompletionContextAt("\ud800name", 5)).toBeNull();
  });
});
