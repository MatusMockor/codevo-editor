// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import { dismissTransientEditorWidgets } from "./editorTransientWidgetDismissal";

afterEach(() => {
  vi.useRealTimers();
});

describe("dismissTransientEditorWidgets", () => {
  it("treats commands from unloaded Monaco contributions as best-effort", () => {
    vi.useFakeTimers();
    const domNode = document.createElement("div");
    domNode.innerHTML =
      '<div class="monaco-hover"></div><div class="find-widget"></div><div class="suggest-widget"></div>';
    const trigger = vi.fn((_source: string, command: string) => {
      if (command === "hideSuggestWidget") {
        throw new Error("command 'hideSuggestWidget' not found");
      }
    });
    const editor = {
      getDomNode: () => domNode,
      getModel: () => ({}),
      trigger,
    } as unknown as Monaco.editor.IStandaloneCodeEditor;

    expect(() => dismissTransientEditorWidgets(editor, "floating-surface")).not.toThrow();
    expect(() => vi.runAllTimers()).not.toThrow();
    expect(trigger).toHaveBeenCalledTimes(6);
  });

  it("does not dispatch commands for contributions that have not rendered", () => {
    vi.useFakeTimers();
    const trigger = vi.fn();
    const editor = {
      getDomNode: () => document.createElement("div"),
      getModel: () => ({}),
      trigger,
    } as unknown as Monaco.editor.IStandaloneCodeEditor;

    dismissTransientEditorWidgets(editor, "floating-surface");
    vi.runAllTimers();

    expect(trigger).not.toHaveBeenCalled();
  });
});
