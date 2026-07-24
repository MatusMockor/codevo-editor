import type * as Monaco from "monaco-editor";
import {
  createConservativeWorkspaceRootFromPath,
  parseWorkspacePath,
} from "../domain/workspacePath";
import { modelPath } from "./phpMonacoDocumentContext";
import type { PrecomputedCoverageLineState } from "./usePrecomputedCoverageEditorDecorations";

export function toPrecomputedCoverageMonacoDecoration(
  monaco: typeof Monaco,
  line: PrecomputedCoverageLineState,
): Monaco.editor.IModelDeltaDecoration {
  const tooltip =
    line.status === "covered"
      ? `Coverage: covered (${line.hits} ${line.hits === 1 ? "hit" : "hits"}).`
      : "Coverage: uncovered (0 hits).";
  return {
    options: {
      className: `coverage-line coverage-${line.status}-line`,
      hoverMessage: { value: tooltip },
      isWholeLine: true,
      linesDecorationsClassName: `coverage-gutter coverage-${line.status}-gutter`,
      linesDecorationsTooltip: tooltip,
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      zIndex: 4,
    },
    range: new monaco.Range(line.lineNumber, 1, line.lineNumber, 1),
  };
}

/** Exact-file identity matcher with conservative Windows/UNC alias handling. */
export function phpCoverageModelMatchesDocument(
  model: Monaco.editor.ITextModel,
  documentPath: string,
): boolean {
  const root = createConservativeWorkspaceRootFromPath(documentPath);
  if (!root.ok) return false;
  const candidatePath = modelPath(model);
  if (!candidatePath) return false;
  const candidate = parseWorkspacePath(root.value, candidatePath);
  return candidate.ok && candidate.value.relativePath.length === 0;
}
