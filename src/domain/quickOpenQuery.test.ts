import { describe, expect, it } from "vitest";
import { parseQuickOpenQuery } from "./quickOpenQuery";

describe("parseQuickOpenQuery", () => {
  it("parses a file path with a trailing line", () => {
    expect(parseQuickOpenQuery("src/foo.ts:42")).toEqual({
      kind: "fileLocation",
      column: null,
      line: 42,
      pathQuery: "src/foo.ts",
    });
  });

  it("parses a file path with a trailing line and column", () => {
    expect(parseQuickOpenQuery("src/foo.ts:42:7")).toEqual({
      kind: "fileLocation",
      column: 7,
      line: 42,
      pathQuery: "src/foo.ts",
    });
  });

  it("parses a bare line as a location in the current file", () => {
    expect(parseQuickOpenQuery(":42")).toEqual({
      kind: "currentFileLocation",
      column: null,
      line: 42,
    });
  });

  it.each([
    ["@handler", "currentFileSymbols", "handler"],
    ["#handler", "workspaceSymbols", "handler"],
    [">format", "commands", "format"],
  ] as const)("routes %s to %s", (input, kind, query) => {
    expect(parseQuickOpenQuery(input)).toEqual({ kind, query });
  });

  it.each(["@scope/pkg/index.ts", "#src/generated/index.ts"])(
    "keeps slash-containing symbol prefix input as a file query for %s",
    (input) => {
      expect(parseQuickOpenQuery(input)).toEqual({
        kind: "files",
        query: input,
      });
    },
  );

  it("does not mistake a Windows drive letter for a line suffix", () => {
    expect(parseQuickOpenQuery("C:\\src\\foo.ts")).toEqual({
      kind: "files",
      query: "C:\\src\\foo.ts",
    });
  });

  it("parses a Windows path with an explicit line suffix", () => {
    expect(parseQuickOpenQuery("C:\\src\\foo.ts:42")).toEqual({
      kind: "fileLocation",
      column: null,
      line: 42,
      pathQuery: "C:\\src\\foo.ts",
    });
  });

  it("keeps a path containing a colon as a plain file query", () => {
    expect(parseQuickOpenQuery("src/generated:types.ts")).toEqual({
      kind: "files",
      query: "src/generated:types.ts",
    });
  });

  it("keeps a colon-containing path when parsing its location", () => {
    expect(parseQuickOpenQuery("src/generated:types.ts:42:7")).toEqual({
      kind: "fileLocation",
      column: 7,
      line: 42,
      pathQuery: "src/generated:types.ts",
    });
  });

  it.each(["src/foo.ts:0", "src/foo.ts:42:0", "src/foo.ts:not-a-line"])(
    "falls back to files for malformed location %s",
    (input) => {
      expect(parseQuickOpenQuery(input)).toEqual({
        kind: "files",
        query: input,
      });
    },
  );

  it("gives picker prefixes precedence over location suffixes", () => {
    expect(parseQuickOpenQuery("@handler:42")).toEqual({
      kind: "currentFileSymbols",
      query: "handler:42",
    });
  });
});
