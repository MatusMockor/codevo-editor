import type * as Monaco from "monaco-editor";
import { MAX_CODE_ACTION_DIAGNOSTICS } from "../domain/codeActionProjection";
import type { LanguageServerCodeActionContext } from "../domain/languageServerFeatures";

export function toJavaScriptTypeScriptCodeActionContext(
  monaco: typeof Monaco,
  context: Monaco.languages.CodeActionContext,
): LanguageServerCodeActionContext | null {
  if (context.markers.length > MAX_CODE_ACTION_DIAGNOSTICS) return null;
  return {
    diagnostics: context.markers.map((marker) => ({
      code: markerCode(marker),
      data: markerData(marker),
      message: marker.message,
      range: {
        end: {
          character: Math.max(0, marker.endColumn - 1),
          line: Math.max(0, marker.endLineNumber - 1),
        },
        start: {
          character: Math.max(0, marker.startColumn - 1),
          line: Math.max(0, marker.startLineNumber - 1),
        },
      },
      severity: diagnosticSeverity(monaco, marker.severity),
      source: marker.source ?? null,
    })),
    only: context.only ? [context.only] : null,
    triggerKind: triggerKind(monaco, context.trigger),
  };
}

function markerCode(marker: Monaco.editor.IMarkerData): string | number | null {
  if (!marker.code) return null;
  return typeof marker.code === "string" || typeof marker.code === "number"
    ? marker.code
    : marker.code.value;
}

function markerData(marker: Monaco.editor.IMarkerData): unknown | null {
  return (marker as Monaco.editor.IMarkerData & { data?: unknown }).data ?? null;
}

function triggerKind(
  monaco: typeof Monaco,
  trigger: Monaco.languages.CodeActionTriggerType | undefined,
): number | null {
  if (trigger === monaco.languages.CodeActionTriggerType.Invoke) return 1;
  return trigger === 2 ? 2 : null;
}

function diagnosticSeverity(monaco: typeof Monaco, severity: Monaco.MarkerSeverity): number | null {
  if (severity === monaco.MarkerSeverity.Error) return 1;
  if (severity === monaco.MarkerSeverity.Warning) return 2;
  if (severity === monaco.MarkerSeverity.Info) return 3;
  return severity === monaco.MarkerSeverity.Hint ? 4 : null;
}
