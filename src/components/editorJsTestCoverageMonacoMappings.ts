import type * as Monaco from "monaco-editor";
import type { JsTestCoverageLineDecoration } from "../domain/jsTestCoverageDecorations";

export function toJsTestCoverageDecoration(
  monaco: typeof Monaco,
  decoration: JsTestCoverageLineDecoration,
): Monaco.editor.IModelDeltaDecoration {
  const tooltip =
    decoration.status === "covered"
      ? `Test coverage: covered (${decoration.hits} ${decoration.hits === 1 ? "hit" : "hits"}).`
      : "Test coverage: uncovered (0 hits).";
  const className = `js-test-coverage-${decoration.status}`;

  return {
    options: {
      className: `js-test-coverage-line ${className}-line`,
      hoverMessage: { value: tooltip },
      isWholeLine: true,
      linesDecorationsClassName: `js-test-coverage-gutter ${className}-gutter`,
      linesDecorationsTooltip: tooltip,
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      zIndex: 4,
    },
    range: new monaco.Range(decoration.lineNumber, 1, decoration.lineNumber, 1),
  };
}
