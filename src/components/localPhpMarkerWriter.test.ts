import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import { MAX_MONACO_DIAGNOSTIC_ITEMS } from "./editorDiagnosticMonacoMappings";
import { LocalPhpMarkerWriter } from "./localPhpMarkerWriter";

describe("LocalPhpMarkerWriter", () => {
  it("writes identical non-empty markers once for a shared model", () => {
    const setModelMarkers = vi.fn();
    const writer = new LocalPhpMarkerWriter();
    const monaco = monacoWith(setModelMarkers);
    const model = {} as Monaco.editor.ITextModel;
    const markers = [marker("Unexpected token")];

    writer.write(monaco, model, markers);
    writer.write(monaco, model, [...markers]);

    expect(setModelMarkers).toHaveBeenCalledOnce();
  });

  it("always writes clears and allows the same markers to be restored", () => {
    const setModelMarkers = vi.fn();
    const writer = new LocalPhpMarkerWriter();
    const monaco = monacoWith(setModelMarkers);
    const model = {} as Monaco.editor.ITextModel;
    const markers = [marker("Unexpected token")];

    writer.write(monaco, model, markers);
    writer.write(monaco, model, []);
    writer.write(monaco, model, []);
    writer.write(monaco, model, markers);

    expect(setModelMarkers.mock.calls).toEqual([
      [model, "php-syntax", markers],
      [model, "php-syntax", []],
      [model, "php-syntax", []],
      [model, "php-syntax", markers],
    ]);
  });

  it("keeps marker ownership isolated per model", () => {
    const setModelMarkers = vi.fn();
    const writer = new LocalPhpMarkerWriter();
    const monaco = monacoWith(setModelMarkers);
    const leftModel = {} as Monaco.editor.ITextModel;
    const rightModel = {} as Monaco.editor.ITextModel;
    const markers = [marker("Unexpected token")];

    writer.write(monaco, leftModel, markers);
    writer.write(monaco, rightModel, markers);

    expect(setModelMarkers).toHaveBeenCalledTimes(2);
  });

  it("defensively caps oversized marker arrays", () => {
    const setModelMarkers = vi.fn();
    const writer = new LocalPhpMarkerWriter();
    const monaco = monacoWith(setModelMarkers);
    const model = {} as Monaco.editor.ITextModel;

    writer.write(monaco, model, Array<Monaco.editor.IMarkerData>(100_000).fill(marker("Problem")));

    expect(setModelMarkers.mock.calls[0]?.[2]).toHaveLength(MAX_MONACO_DIAGNOSTIC_ITEMS);
  });
});

function marker(message: string): Monaco.editor.IMarkerData {
  return {
    endColumn: 2,
    endLineNumber: 1,
    message,
    severity: 8,
    startColumn: 1,
    startLineNumber: 1,
  };
}

function monacoWith(setModelMarkers: ReturnType<typeof vi.fn>): typeof Monaco {
  return {
    editor: { setModelMarkers },
  } as unknown as typeof Monaco;
}
