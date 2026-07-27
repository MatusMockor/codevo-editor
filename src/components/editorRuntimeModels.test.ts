import type * as Monaco from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import { MAX_MONACO_DIAGNOSTIC_ITEMS } from "./editorDiagnosticMonacoMappings";
import { reconcileEditorRuntimeMarkers } from "./editorRuntimeModels";

describe("reconcileEditorRuntimeMarkers", () => {
  it("maps and publishes at most the Monaco diagnostic budget", () => {
    const path = "/workspace/src/index.ts";
    const model = {
      uri: {
        fsPath: path,
        path,
        scheme: "file",
        toString: () => `file://${path}`,
      },
    } as Monaco.editor.ITextModel;
    const setModelMarkers = vi.fn();
    const monaco = {
      editor: {
        getModels: () => [model],
        setModelMarkers,
      },
    } as unknown as typeof Monaco;
    const diagnostic: LanguageServerDiagnostic = {
      character: 0,
      line: 0,
      message: "Problem",
      severity: "error",
      source: "typescript",
    };
    const diagnostics = Array<LanguageServerDiagnostic>(100_000).fill(diagnostic);
    const toMarker = vi.fn(() => ({
      endColumn: 2,
      endLineNumber: 1,
      message: "Problem",
      severity: 8,
      startColumn: 1,
      startLineNumber: 1,
    }));

    reconcileEditorRuntimeMarkers(
      monaco,
      null,
      { [path]: diagnostics },
      {},
      new WeakSet(),
      toMarker,
    );

    expect(toMarker).toHaveBeenCalledTimes(MAX_MONACO_DIAGNOSTIC_ITEMS);
    expect(setModelMarkers).toHaveBeenCalledOnce();
    expect(setModelMarkers.mock.calls[0]?.slice(0, 2)).toEqual([model, "php-language-server"]);
    expect(setModelMarkers.mock.calls[0]?.[2]).toHaveLength(MAX_MONACO_DIAGNOSTIC_ITEMS);
  });
});
