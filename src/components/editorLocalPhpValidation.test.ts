import type { Dispatch, SetStateAction } from "react";
import type * as Monaco from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import {
  applyLocalPhpValidationSnapshot,
  localPhpDiagnosticsFromVisibleMarkers,
} from "./editorLocalPhpValidation";

function stateSetter<Value>(read: () => Value, write: (value: Value) => void) {
  return ((action: SetStateAction<Value>) => {
    write(typeof action === "function" ? (action as (previous: Value) => Value)(read()) : action);
  }) as Dispatch<SetStateAction<Value>>;
}

describe("editorLocalPhpValidation", () => {
  it("projects one validation snapshot to diagnostics, caches, and Monaco markers", () => {
    const monaco = {
      MarkerSeverity: { Error: 8, Warning: 4 },
      MarkerTag: { Unnecessary: 1 },
    } as unknown as typeof Monaco;
    const writeMarkers = vi.fn();
    const onDiagnosticsChange = vi.fn();
    let syntaxByPath = {};
    let inspectionCounts = {};

    applyLocalPhpValidationSnapshot(
      {
        inspectionDiagnostics: [
          {
            character: 2,
            endCharacter: 5,
            endLine: 1,
            kind: "unused-variable",
            line: 1,
            message: "Unused variable",
            severity: "warning",
            unnecessary: true,
          },
        ],
        syntaxDiagnostics: [
          {
            character: 0,
            endCharacter: 1,
            endLine: 0,
            line: 0,
            message: "Syntax error",
          },
        ],
      },
      monaco,
      "/workspace/file.php",
      writeMarkers,
      onDiagnosticsChange,
      stateSetter(
        () => syntaxByPath,
        (value) => {
          syntaxByPath = value;
        },
      ),
      stateSetter(
        () => inspectionCounts,
        (value) => {
          inspectionCounts = value;
        },
      ),
    );

    expect(onDiagnosticsChange).toHaveBeenCalledWith("/workspace/file.php", [
      expect.objectContaining({ message: "Syntax error", severity: "error" }),
      expect.objectContaining({ message: "Unused variable", severity: "warning" }),
    ]);
    expect(syntaxByPath).toEqual({
      "/workspace/file.php": [expect.objectContaining({ message: "Syntax error" })],
    });
    expect(inspectionCounts).toEqual({ "/workspace/file.php": 1 });
    expect(writeMarkers).toHaveBeenCalledWith([
      expect.objectContaining({ severity: 8, source: "PHP Syntax" }),
      expect.objectContaining({ severity: 4, source: "PHP Inspection" }),
    ]);
  });

  it("keeps only visible problem markers and maps their severities", () => {
    const monaco = {
      MarkerSeverity: { Error: 8, Hint: 1, Info: 2, Warning: 4 },
      editor: {
        getModelMarkers: () => [
          {
            endColumn: 5,
            endLineNumber: 1,
            message: "error",
            severity: 8,
            source: "PHP",
            startColumn: 2,
            startLineNumber: 1,
          },
          {
            endColumn: 3,
            endLineNumber: 2,
            message: "hint",
            severity: 1,
            source: "PHP",
            startColumn: 1,
            startLineNumber: 2,
          },
        ],
      },
    } as unknown as typeof Monaco;
    const model = {
      uri: { toString: () => "file:///workspace/file.php" },
    } as unknown as Monaco.editor.ITextModel;

    expect(localPhpDiagnosticsFromVisibleMarkers(monaco, model)).toEqual([
      {
        character: 1,
        endCharacter: 4,
        endLine: 0,
        line: 0,
        message: "error",
        severity: "error",
        source: "PHP",
        tags: undefined,
      },
    ]);
  });
});
