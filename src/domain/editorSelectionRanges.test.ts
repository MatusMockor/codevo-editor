import { describe, expect, it } from "vitest";
import {
  editorSelectionExpansionRanges,
  nextEditorSelectionExpansionRange,
} from "./editorSelectionRanges";

describe("editorSelectionRanges", () => {
  it("expands PHP member method names to calls and statements", () => {
    const line = "        $id = $request->getCommentId();";

    expect(rangeTexts(line, line.indexOf("getCommentId") + 3)).toEqual([
      "getCommentId",
      "$request->getCommentId()",
      "$id = $request->getCommentId();",
    ]);
  });

  it("expands nested PHP chains without losing the focused method first", () => {
    const line =
      "        $comment = $this->repo->findOrFail($request->getCommentId());";

    expect(rangeTexts(line, line.indexOf("getCommentId") + 3)).toEqual([
      "getCommentId",
      "$request->getCommentId()",
      "$comment = $this->repo->findOrFail($request->getCommentId());",
    ]);
  });

  it("expands JavaScript and TypeScript member calls", () => {
    const line = "const id = request.getCommentId(user.id);";

    expect(rangeTexts(line, line.indexOf("getCommentId") + 3)).toEqual([
      "getCommentId",
      "request.getCommentId(user.id)",
      "const id = request.getCommentId(user.id);",
    ]);
  });

  it("expands static OOP calls", () => {
    const line = "        return User::find($id);";

    expect(rangeTexts(line, line.indexOf("find") + 1)).toEqual([
      "find",
      "User::find($id)",
      "return User::find($id);",
    ]);
  });

  it("expands optional chaining calls", () => {
    const line = "const id = service?.getCommentId();";

    expect(rangeTexts(line, line.indexOf("getCommentId") + 2)).toEqual([
      "getCommentId",
      "service?.getCommentId()",
      "const id = service?.getCommentId();",
    ]);
  });

  it("returns the next containing range after the current selection", () => {
    const line = "        $id = $request->getCommentId();";
    const methodStart = line.indexOf("getCommentId");
    const methodEnd = methodStart + "getCommentId".length;

    expect(
      nextEditorSelectionExpansionRange(line, methodStart + 2, {
        end: methodEnd,
        start: methodStart,
      }),
    ).toEqual({
      end: line.indexOf(")") + 1,
      start: line.indexOf("$request"),
    });
  });

  it("does not expand whitespace", () => {
    expect(editorSelectionExpansionRanges("    ", 2)).toEqual([]);
  });
});

function rangeTexts(line: string, offset: number): string[] {
  return editorSelectionExpansionRanges(line, offset).map((range) =>
    line.slice(range.start, range.end),
  );
}
