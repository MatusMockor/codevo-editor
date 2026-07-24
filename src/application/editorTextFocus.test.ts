// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { editorTextFocusOwner } from "./editorTextFocus";

describe("editorTextFocusOwner", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("returns the exact Monaco owner for its text input", () => {
    const editor = document.createElement("div");
    editor.className = "monaco-editor";
    const input = document.createElement("textarea");
    input.className = "inputarea";
    editor.append(input);
    document.body.append(editor);

    expect(editorTextFocusOwner({ target: input })).toBe(editor);
  });

  it.each([
    "input",
    "textarea",
    "[contenteditable='true']",
    ".monaco-editor input.find-input",
    ".monaco-editor .suggest-widget input",
  ])("rejects focus owned by %s", (selector) => {
    document.body.innerHTML = domForSelector(selector);
    const target = document.querySelector("[data-target]");

    expect(editorTextFocusOwner({ target })).toBeNull();
  });

  it("rejects detached, nested and non-DOM targets", () => {
    const editor = document.createElement("div");
    editor.className = "monaco-editor";
    const wrapper = document.createElement("div");
    wrapper.className = "inputarea";
    const nested = document.createElement("span");
    wrapper.append(nested);
    editor.append(wrapper);

    expect(editorTextFocusOwner({ target: nested })).toBeNull();
    expect(editorTextFocusOwner({ target: null })).toBeNull();
    expect(editorTextFocusOwner({ target: new EventTarget() })).toBeNull();
  });
});

function domForSelector(selector: string): string {
  switch (selector) {
    case "input":
      return "<input data-target />";
    case "textarea":
      return "<textarea data-target></textarea>";
    case "[contenteditable='true']":
      return '<div contenteditable="true" data-target></div>';
    case ".monaco-editor input.find-input":
      return '<div class="monaco-editor"><input class="find-input" data-target /></div>';
    default:
      return '<div class="monaco-editor"><div class="suggest-widget"><input data-target /></div></div>';
  }
}
