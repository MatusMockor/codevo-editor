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

  it("accepts a trailing colon after a line as that line", () => {
    expect(parseQuickOpenQuery("src/foo.ts:42:")).toEqual({
      kind: "fileLocation",
      column: null,
      line: 42,
      pathQuery: "src/foo.ts",
    });
  });

  it.each([":", ":42", ":42:", ":42:7", ":0", "@handler", "#handler", ">format"])(
    "keeps the removed current-file and symbol syntax %s as a plain file query",
    (input) => {
      expect(parseQuickOpenQuery(input)).toEqual({ kind: "files", query: input });
    },
  );

  it.each(["@scope/pkg/index.ts:3", "#src/generated/index.ts:3"])(
    "parses a location on a path that starts with a former picker prefix for %s",
    (input) => {
      expect(parseQuickOpenQuery(input)).toEqual({
        kind: "fileLocation",
        column: null,
        line: 3,
        pathQuery: input.slice(0, -2),
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
});
