import type * as Monaco from "monaco-editor";
import type { PhpInspectionDiagnostic } from "../domain/phpInspections";
import type { PhpSyntaxDiagnostic } from "../domain/phpSyntaxDiagnostics";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";

type DiagnosticRange = {
  character: number;
  endCharacter: number;
  endLine: number;
  line: number;
};

export function toMonacoDiagnosticMarker(
  monaco: typeof Monaco,
  diagnostic: LanguageServerDiagnostic,
): Monaco.editor.IMarkerData {
  const range = diagnosticRange(diagnostic);
  const marker: Monaco.editor.IMarkerData & { data?: unknown } = {
    code: diagnosticCode(monaco, diagnostic),
    endColumn: range.endCharacter + 1,
    endLineNumber: range.endLine + 1,
    message: diagnostic.message,
    severity: diagnosticSeverity(monaco, diagnostic),
    source: diagnostic.source || "Language Server",
    startColumn: range.character + 1,
    startLineNumber: range.line + 1,
    tags: diagnosticTags(monaco, diagnostic.tags ?? []),
    relatedInformation: diagnosticRelatedInformation(monaco, diagnostic),
  };

  if ("data" in diagnostic) marker.data = diagnostic.data;
  return marker;
}

export function toDiagnosticOverviewDecoration(
  monaco: typeof Monaco,
  diagnostic: LanguageServerDiagnostic,
): Monaco.editor.IModelDeltaDecoration {
  const range = diagnosticRange(diagnostic);
  return {
    options: {
      hoverMessage: {
        value: diagnosticHoverText(diagnostic.source || "Language Server", diagnostic.message),
      },
      overviewRuler: {
        color: diagnosticOverviewColor(diagnostic.severity),
        position: monaco.editor.OverviewRulerLane.Right,
      },
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    },
    range: new monaco.Range(
      range.line + 1,
      range.character + 1,
      range.endLine + 1,
      range.endCharacter + 1,
    ),
  };
}

export function toSyntaxOverviewDecoration(
  monaco: typeof Monaco,
  diagnostic: PhpSyntaxDiagnostic,
): Monaco.editor.IModelDeltaDecoration {
  return {
    options: {
      hoverMessage: { value: diagnosticHoverText("PHP Syntax", diagnostic.message) },
      overviewRuler: {
        color: "#d98b8b",
        position: monaco.editor.OverviewRulerLane.Right,
      },
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    },
    range: new monaco.Range(
      diagnostic.line + 1,
      diagnostic.character + 1,
      diagnostic.endLine + 1,
      syntaxDiagnosticEndColumn(diagnostic),
    ),
  };
}

export function toMonacoSyntaxDiagnosticMarker(
  monaco: typeof Monaco,
  diagnostic: PhpSyntaxDiagnostic,
): Monaco.editor.IMarkerData {
  return {
    endColumn: syntaxDiagnosticEndColumn(diagnostic),
    endLineNumber: diagnostic.endLine + 1,
    message: diagnostic.message,
    severity: monaco.MarkerSeverity.Error,
    source: "PHP Syntax",
    startColumn: diagnostic.character + 1,
    startLineNumber: diagnostic.line + 1,
  };
}

export function toMonacoInspectionMarker(
  monaco: typeof Monaco,
  diagnostic: PhpInspectionDiagnostic,
): Monaco.editor.IMarkerData {
  const endColumn =
    diagnostic.endLine === diagnostic.line
      ? Math.max(diagnostic.endCharacter + 1, diagnostic.character + 2)
      : diagnostic.endCharacter + 1;

  return {
    endColumn,
    endLineNumber: diagnostic.endLine + 1,
    message: diagnostic.message,
    severity: monaco.MarkerSeverity.Warning,
    source: "PHP Inspection",
    startColumn: diagnostic.character + 1,
    startLineNumber: diagnostic.line + 1,
    tags: [monaco.MarkerTag.Unnecessary],
  };
}

export function toLocalPhpDiagnostic(
  diagnostic: PhpSyntaxDiagnostic | PhpInspectionDiagnostic,
  source: string,
  severity: LanguageServerDiagnostic["severity"],
): LanguageServerDiagnostic {
  return {
    character: diagnostic.character,
    endCharacter: diagnostic.endCharacter,
    endLine: diagnostic.endLine,
    line: diagnostic.line,
    message: diagnostic.message,
    severity,
    source,
    tags: "unnecessary" in diagnostic && diagnostic.unnecessary ? [1] : undefined,
  };
}

function diagnosticCode(
  monaco: typeof Monaco,
  diagnostic: LanguageServerDiagnostic,
): Monaco.editor.IMarkerData["code"] {
  if (diagnostic.code === null || typeof diagnostic.code === "undefined") return undefined;
  const value = String(diagnostic.code);
  return diagnostic.codeDescriptionHref
    ? { target: monaco.Uri.parse(diagnostic.codeDescriptionHref), value }
    : value;
}

function diagnosticRange(diagnostic: LanguageServerDiagnostic): DiagnosticRange {
  return {
    character: diagnostic.character,
    endCharacter: diagnostic.endCharacter ?? diagnostic.character + 1,
    endLine: diagnostic.endLine ?? diagnostic.line,
    line: diagnostic.line,
  };
}

function diagnosticRelatedInformation(
  monaco: typeof Monaco,
  diagnostic: LanguageServerDiagnostic,
): Monaco.editor.IMarkerData["relatedInformation"] {
  return diagnostic.relatedInformation?.map((info) => {
    const range = diagnosticRange({
      character: info.character,
      endCharacter: info.endCharacter,
      endLine: info.endLine,
      line: info.line,
      message: info.message,
      severity: diagnostic.severity,
      source: diagnostic.source,
    });
    return {
      message: info.message,
      resource: monaco.Uri.parse(info.uri),
      startColumn: range.character + 1,
      startLineNumber: range.line + 1,
      endColumn: range.endCharacter + 1,
      endLineNumber: range.endLine + 1,
    };
  });
}

function diagnosticHoverText(source: string, message: string): string {
  return `**${escapeMarkdown(source)}**: ${escapeMarkdown(message)}`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!|]/g, "\\$&");
}

function diagnosticOverviewColor(severity: LanguageServerDiagnostic["severity"]): string {
  if (severity === "warning") return "#d8b878";
  if (severity === "hint" || severity === "information") return "#8fbcae";
  return "#d98b8b";
}

function diagnosticSeverity(
  monaco: typeof Monaco,
  diagnostic: LanguageServerDiagnostic,
): Monaco.MarkerSeverity {
  if (diagnostic.severity === "error") return monaco.MarkerSeverity.Error;
  if (diagnostic.severity === "warning") return monaco.MarkerSeverity.Warning;
  if (diagnostic.severity === "hint") return monaco.MarkerSeverity.Hint;
  return monaco.MarkerSeverity.Info;
}

function diagnosticTags(monaco: typeof Monaco, tags: number[]): Monaco.MarkerTag[] | undefined {
  const markerTags = tags.flatMap((tag) => {
    if (tag === 1) return [monaco.MarkerTag.Unnecessary];
    if (tag === 2) return [monaco.MarkerTag.Deprecated];
    return [];
  });
  return markerTags.length > 0 ? markerTags : undefined;
}

function syntaxDiagnosticEndColumn(diagnostic: PhpSyntaxDiagnostic): number {
  if (diagnostic.endLine === diagnostic.line) {
    return Math.max(diagnostic.endCharacter + 1, diagnostic.character + 2);
  }
  return diagnostic.endCharacter + 1;
}
