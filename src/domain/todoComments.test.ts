import { describe, expect, it } from "vitest";
import { extractTodoComments } from "./todoComments";

describe("extractTodoComments", () => {
  it("extracts a TODO from a line comment with a colon", () => {
    expect(extractTodoComments("// TODO: fix this")).toEqual([
      { tag: "TODO", text: "fix this", line: 1, column: 4 },
    ]);
  });

  it("extracts a FIXME from a hash comment without a colon", () => {
    expect(extractTodoComments("# FIXME bla")).toEqual([
      { tag: "FIXME", text: "bla", line: 1, column: 3 },
    ]);
  });

  it("extracts a HACK from a block comment", () => {
    expect(extractTodoComments("/* HACK avoid the cache */")).toEqual([
      { tag: "HACK", text: "avoid the cache", line: 1, column: 4 },
    ]);
  });

  it("reports the correct line and column for nested positions", () => {
    const source = ["const a = 1;", "    // TODO: indented note", "const b = 2;"].join(
      "\n",
    );

    expect(extractTodoComments(source)).toEqual([
      { tag: "TODO", text: "indented note", line: 2, column: 8 },
    ]);
  });

  it("extracts multiple tagged comments from one source", () => {
    const source = [
      "// TODO: first",
      "function go() {}",
      "# FIXME: second",
      "/* BUG: third */",
    ].join("\n");

    expect(extractTodoComments(source)).toEqual([
      { tag: "TODO", text: "first", line: 1, column: 4 },
      { tag: "FIXME", text: "second", line: 3, column: 3 },
      { tag: "BUG", text: "third", line: 4, column: 4 },
    ]);
  });

  it("ignores tags that appear inside string literals", () => {
    const source = '$x = "TODO: not a comment";';

    expect(extractTodoComments(source)).toEqual([]);
  });

  it("ignores tags inside strings but keeps real comments on the same line", () => {
    const source = '$x = "TODO: nope"; // TODO: real one';

    expect(extractTodoComments(source)).toEqual([
      { tag: "TODO", text: "real one", line: 1, column: 23 },
    ]);
  });

  it("extracts a TODO from a blade comment", () => {
    expect(extractTodoComments("{{-- TODO: render the list --}}")).toEqual([
      { tag: "TODO", text: "render the list", line: 1, column: 6 },
    ]);
  });

  it("extracts a TODO from an html comment", () => {
    expect(extractTodoComments("<!-- TODO: add aria labels -->")).toEqual([
      { tag: "TODO", text: "add aria labels", line: 1, column: 6 },
    ]);
  });

  it("extracts a bare tag with no following text as empty text", () => {
    expect(extractTodoComments("<!-- TODO -->")).toEqual([
      { tag: "TODO", text: "", line: 1, column: 6 },
    ]);
  });

  it("supports custom tags via options", () => {
    const source = "// REVIEW: please look\n// TODO: ignored here";

    expect(extractTodoComments(source, { tags: ["REVIEW"] })).toEqual([
      { tag: "REVIEW", text: "please look", line: 1, column: 4 },
    ]);
  });

  it("returns an empty array when there are no tagged comments", () => {
    const source = ["const value = 1;", "// just an ordinary comment"].join("\n");

    expect(extractTodoComments(source)).toEqual([]);
  });

  it("does not match tags that are part of a larger word", () => {
    expect(extractTodoComments("// TODOLIST is not a tag")).toEqual([]);
  });

  it("matches a tag only inside its comment, not the code before it", () => {
    const source = "$todo = TODO; // NOTE: TODO appears in code too";

    expect(extractTodoComments(source)).toEqual([
      { tag: "NOTE", text: "TODO appears in code too", line: 1, column: 18 },
    ]);
  });

  it("extracts a tag from a multi-line block comment on the correct line", () => {
    const source = ["/*", " * HACK: workaround", " */"].join("\n");

    expect(extractTodoComments(source)).toEqual([
      { tag: "HACK", text: "workaround", line: 2, column: 4 },
    ]);
  });

  it("is case-sensitive and ignores lowercase tags by default", () => {
    expect(extractTodoComments("// todo: lowercase")).toEqual([]);
  });

  it("extracts tags from consecutive lines within one block comment", () => {
    const source = ["/*", " * TODO: alpha", " * FIXME: beta", " */"].join("\n");

    expect(extractTodoComments(source)).toEqual([
      { tag: "TODO", text: "alpha", line: 2, column: 4 },
      { tag: "FIXME", text: "beta", line: 3, column: 4 },
    ]);
  });

  it("does not treat a tag inside another tag's description as a new entry", () => {
    expect(extractTodoComments("// TODO: see the FIXME in the parser")).toEqual([
      { tag: "TODO", text: "see the FIXME in the parser", line: 1, column: 4 },
    ]);
  });

  it("computes correct line and column for CRLF line endings", () => {
    const source = "const a = 1;\r\n    // TODO: crlf note\r\nconst b = 2;";

    expect(extractTodoComments(source)).toEqual([
      { tag: "TODO", text: "crlf note", line: 2, column: 8 },
    ]);
  });

  it("handles an unterminated block comment without throwing", () => {
    expect(extractTodoComments("/* TODO: still open")).toEqual([
      { tag: "TODO", text: "still open", line: 1, column: 4 },
    ]);
  });

  it("ignores PHP8 attributes that start with a hash", () => {
    const source = "#[Route('/x')] // NOTE: real comment";

    expect(extractTodoComments(source)).toEqual([
      { tag: "NOTE", text: "real comment", line: 1, column: 19 },
    ]);
  });
});
