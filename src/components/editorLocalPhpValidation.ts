import type { Dispatch, SetStateAction } from "react";
import type * as Monaco from "monaco-editor";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import type { PhpInspectionDiagnostic } from "../domain/phpInspections";
import type { PhpSyntaxDiagnostic } from "../domain/phpSyntaxDiagnostics";
import type { LocalPhpValidationSnapshot } from "./EditorRuntimeHost";
import {
  toLocalPhpDiagnostic,
  toMonacoInspectionMarker,
  toMonacoSyntaxDiagnosticMarker,
} from "./editorDiagnosticMonacoMappings";

export function applyLocalPhpValidationSnapshot(
  snapshot: LocalPhpValidationSnapshot<PhpSyntaxDiagnostic, PhpInspectionDiagnostic>,
  monaco: typeof Monaco,
  path: string,
  writeMarkers: (markers: readonly Monaco.editor.IMarkerData[]) => void,
  onDiagnosticsChange: (path: string, diagnostics: LanguageServerDiagnostic[]) => void,
  setSyntaxDiagnostics: Dispatch<SetStateAction<Record<string, PhpSyntaxDiagnostic[]>>>,
  setInspectionDiagnosticCounts: Dispatch<SetStateAction<Record<string, number>>>,
): void {
  const { inspectionDiagnostics, syntaxDiagnostics } = snapshot;

  onDiagnosticsChange(path, [
    ...syntaxDiagnostics.map((diagnostic) =>
      toLocalPhpDiagnostic(diagnostic, "PHP Syntax", "error"),
    ),
    ...inspectionDiagnostics.map((diagnostic) =>
      toLocalPhpDiagnostic(diagnostic, "PHP Inspection", "warning"),
    ),
  ]);
  setSyntaxDiagnostics((current) => ({
    ...current,
    [path]: syntaxDiagnostics,
  }));
  setInspectionDiagnosticCounts((current) => {
    if (inspectionDiagnostics.length > 0) {
      return {
        ...current,
        [path]: inspectionDiagnostics.length,
      };
    }
    if (current[path] === undefined) {
      return current;
    }

    const next = { ...current };
    delete next[path];
    return next;
  });
  writeMarkers([
    ...syntaxDiagnostics.map((diagnostic) => toMonacoSyntaxDiagnosticMarker(monaco, diagnostic)),
    ...inspectionDiagnostics.map((diagnostic) => toMonacoInspectionMarker(monaco, diagnostic)),
  ]);
}

export function localPhpDiagnosticsFromVisibleMarkers(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
): LanguageServerDiagnostic[] {
  return monaco.editor
    .getModelMarkers({ resource: model.uri })
    .filter(
      (marker) =>
        marker.severity === monaco.MarkerSeverity.Error ||
        marker.severity === monaco.MarkerSeverity.Warning,
    )
    .map((marker) => ({
      character: marker.startColumn - 1,
      endCharacter: marker.endColumn - 1,
      endLine: marker.endLineNumber - 1,
      line: marker.startLineNumber - 1,
      message: marker.message,
      severity: localPhpDiagnosticSeverityFromMarker(monaco, marker.severity),
      source: marker.source ?? "PHP",
      tags: marker.tags?.map((tag) => Number(tag)),
    }));
}

function localPhpDiagnosticSeverityFromMarker(
  monaco: typeof Monaco,
  severity: Monaco.MarkerSeverity,
): LanguageServerDiagnostic["severity"] {
  if (severity === monaco.MarkerSeverity.Error) {
    return "error";
  }

  if (severity === monaco.MarkerSeverity.Warning) {
    return "warning";
  }

  if (severity === monaco.MarkerSeverity.Hint) {
    return "hint";
  }

  return "information";
}
