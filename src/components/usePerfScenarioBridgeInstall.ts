import { useEffect, useRef } from "react";
import type { editor as MonacoEditor } from "monaco-editor";
import type { LatencySnapshotEntry } from "../domain/latencyTracker";
import { installPerfScenarioBridge, perfScenarioBridgeEnabled } from "./perfScenarioBridge";

export interface PerfScenarioBridgeHost {
  readonly getLatencySnapshot: () => LatencySnapshotEntry[];
  readonly clearLatencyMetrics: () => void;
  readonly setActivePath: (path: string) => void;
}

export interface PerfMonacoEditorApi {
  readonly editor: {
    getEditors(): readonly MonacoEditor.ICodeEditor[];
    getModels(): readonly MonacoEditor.ITextModel[];
  };
}

export type PerfMonacoEditorApiLoader = () => Promise<PerfMonacoEditorApi>;

function loadMonacoEditorApi(): Promise<PerfMonacoEditorApi> {
  return import("monaco-editor/esm/vs/editor/editor.api.js");
}

export function usePerfScenarioBridgeInstall(
  host: PerfScenarioBridgeHost,
  loadEditorApi: PerfMonacoEditorApiLoader = loadMonacoEditorApi,
): void {
  const hostRef = useRef(host);

  useEffect(() => {
    hostRef.current = host;
  }, [host]);

  useEffect(() => {
    if (!perfScenarioBridgeEnabled()) {
      return;
    }

    let disposeBridge: (() => void) | null = null;
    let disposed = false;

    void loadEditorApi().then((monaco) => {
      if (disposed) {
        return;
      }

      disposeBridge = installPerfScenarioBridge({
        getLatencySnapshot: () => hostRef.current.getLatencySnapshot(),
        clearLatencyMetrics: () => {
          hostRef.current.clearLatencyMetrics();
        },
        activateDocument: (path) => {
          hostRef.current.setActivePath(path);
        },
        getActiveEditor: () => {
          const editors = monaco.editor.getEditors();

          return editors.find((editor) => editor.hasTextFocus()) ?? editors[0] ?? null;
        },
        getRetainedCounts: () => ({
          models: monaco.editor.getModels().length,
          editors: monaco.editor.getEditors().length,
        }),
      });
    });

    return () => {
      disposed = true;
      disposeBridge?.();
    };
  }, [loadEditorApi]);
}
