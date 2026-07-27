import type * as Monaco from "monaco-editor";
import { MAX_MONACO_DIAGNOSTIC_ITEMS } from "./editorDiagnosticMonacoMappings";

const LOCAL_PHP_MARKER_OWNER = "php-syntax";

export class LocalPhpMarkerWriter {
  private readonly markerSignatures = new WeakMap<Monaco.editor.ITextModel, string>();

  write(
    monaco: typeof Monaco,
    model: Monaco.editor.ITextModel,
    markers: readonly Monaco.editor.IMarkerData[],
  ): void {
    if (markers.length === 0) {
      this.markerSignatures.delete(model);
      monaco.editor.setModelMarkers(model, LOCAL_PHP_MARKER_OWNER, []);
      return;
    }

    const retainedMarkers =
      markers.length <= MAX_MONACO_DIAGNOSTIC_ITEMS
        ? markers
        : markers.slice(0, MAX_MONACO_DIAGNOSTIC_ITEMS);
    const signature = JSON.stringify(retainedMarkers);
    if (this.markerSignatures.get(model) === signature) {
      return;
    }

    monaco.editor.setModelMarkers(model, LOCAL_PHP_MARKER_OWNER, [...retainedMarkers]);
    this.markerSignatures.set(model, signature);
  }
}
