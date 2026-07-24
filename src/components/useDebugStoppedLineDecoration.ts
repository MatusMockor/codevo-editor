import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";

export interface DebugStoppedLocation {
  readonly filePath: string;
  readonly lineNumber: number;
}

export function useDebugStoppedLineDecoration({
  activeDocumentPath,
  editor,
  location,
  model,
  monaco,
}: {
  readonly activeDocumentPath: string | undefined;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly location: DebugStoppedLocation | null;
  readonly model: Monaco.editor.ITextModel | null;
  readonly monaco: typeof Monaco | null;
}) {
  const decorationIds = useRef<string[]>([]);
  const stoppedFilePath = location?.filePath;
  const stoppedLineNumber = location?.lineNumber;

  useEffect(() => {
    if (!editor || !monaco) return;

    const clear = () => {
      decorationIds.current = editor.deltaDecorations(decorationIds.current, []);
    };
    if (
      !activeDocumentPath ||
      !stoppedFilePath ||
      stoppedLineNumber === undefined ||
      stoppedFilePath !== activeDocumentPath ||
      !model ||
      editor.getModel() !== model ||
      !Number.isInteger(stoppedLineNumber) ||
      stoppedLineNumber < 1
    ) {
      clear();
      return;
    }

    decorationIds.current = editor.deltaDecorations(decorationIds.current, [
      {
        options: {
          className: "debug-stopped-line",
          isWholeLine: true,
          overviewRuler: {
            color: "#e7c66c",
            position: monaco.editor.OverviewRulerLane.Left,
          },
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
        range: new monaco.Range(stoppedLineNumber, 1, stoppedLineNumber, 1),
      },
    ]);
    editor.revealLineInCenter(stoppedLineNumber);

    return clear;
  }, [activeDocumentPath, editor, model, monaco, stoppedFilePath, stoppedLineNumber]);
}
