import { describe, expect, it } from "vitest";
import type * as Monaco from "monaco-editor";
import {
  isSmartBlankLineIndentDocument,
  leadingWhitespace,
  smartBlankLineIndent,
  smartBlankLineIndentTargetLineNumber,
} from "./editorSmartIndent";

describe("editorSmartIndent", () => {
  it("limits smart indentation to supported source documents", () => {
    const document = { language: "typescript" } as never;
    expect(isSmartBlankLineIndentDocument(document)).toBe(true);
    expect(isSmartBlankLineIndentDocument({ language: "json" } as never)).toBe(false);
  });

  it("preserves an explicitly indented blank predecessor", () => {
    expect(smartBlankLineIndent(model(["if (ready) {", "    ", ""]), 3)).toBe("    ");
  });

  it("infers the nearby indentation unit after an opening block", () => {
    expect(smartBlankLineIndent(model(["if (ready) {", "  run();", "if (next) {", ""]), 4)).toBe(
      "  ",
    );
  });

  it("does not alter a non-empty line and falls back without context", () => {
    expect(smartBlankLineIndent(model(["value"]), 1)).toBeNull();
    expect(smartBlankLineIndent(model([""]), 1)).toBeNull();
  });

  it("derives the target line from multiline edits and exposes leading whitespace", () => {
    expect(
      smartBlankLineIndentTargetLineNumber(
        [{ range: { startLineNumber: 4 }, text: "\n\n" }],
        9,
      ),
    ).toBe(6);
    expect(smartBlankLineIndentTargetLineNumber([{ text: "x" }], 9)).toBe(9);
    expect(leadingWhitespace("\t  value")).toBe("\t  ");
  });
});

function model(lines: readonly string[]): Monaco.editor.ITextModel {
  return {
    getLineContent: (lineNumber: number) => lines[lineNumber - 1] ?? "",
    getLineCount: () => lines.length,
  } as Monaco.editor.ITextModel;
}
