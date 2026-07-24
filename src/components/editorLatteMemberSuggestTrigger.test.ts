import type * as Monaco from "monaco-editor";
import { describe, expect, it } from "vitest";
import { shouldTriggerLatteMemberSuggest } from "./editorLatteMemberSuggestTrigger";

function modelWithLine(line: string): Monaco.editor.ITextModel {
  return {
    getLineContent: () => line,
  } as unknown as Monaco.editor.ITextModel;
}

describe("Latte member suggestion trigger", () => {
  it("triggers while typing a member chain inside an open Latte expression", () => {
    const line = "{$presenter->user->get";
    expect(
      shouldTriggerLatteMemberSuggest(
        "latte",
        modelWithLine(line),
        { column: line.length + 1, lineNumber: 1 },
        [{ text: "t" }],
      ),
    ).toBe(true);
  });

  it("supports array access in the receiver chain", () => {
    const line = "{$rows[$index]->na";
    expect(
      shouldTriggerLatteMemberSuggest(
        "latte",
        modelWithLine(line),
        { column: line.length + 1, lineNumber: 1 },
        [{ text: "a" }],
      ),
    ).toBe(true);
  });

  it("ignores closed expressions, other languages, and irrelevant edits", () => {
    const closed = "{$presenter->user}";
    const position = { column: closed.length + 1, lineNumber: 1 };

    expect(
      shouldTriggerLatteMemberSuggest("latte", modelWithLine(closed), position, [{ text: "r" }]),
    ).toBe(false);
    expect(
      shouldTriggerLatteMemberSuggest("php", modelWithLine(closed), position, [{ text: "r" }]),
    ).toBe(false);
    expect(
      shouldTriggerLatteMemberSuggest("latte", modelWithLine("{$presenter->"), position, [
        { text: " " },
      ]),
    ).toBe(false);
  });
});
