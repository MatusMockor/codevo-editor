import type * as Monaco from "monaco-editor";
import type { JsTestCoverageLineDecoration } from "../domain/jsTestCoverageDecorations";

export function toJsTestCoverageDecoration(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  decoration: JsTestCoverageLineDecoration,
): Monaco.editor.IModelDeltaDecoration {
  const coverageTooltip =
    decoration.status === "covered"
      ? `Test coverage: covered (${decoration.hits} ${decoration.hits === 1 ? "hit" : "hits"}).`
      : "Test coverage: uncovered (0 hits).";
  const hitCountNotice = decoration.hitCountsTruncated
    ? `${coverageTooltip} Inline hit counts are limited in large coverage reports.`
    : coverageTooltip;
  const tooltip = decoration.visibleRangesTruncated
    ? `${hitCountNotice} Coverage decorations are limited because the editor reported too many visible ranges.`
    : hitCountNotice;
  const className = `js-test-coverage-${decoration.status}`;
  const column = model.getLineLength(decoration.lineNumber) + 1;
  const after =
    decoration.renderInlineHitCount === false
      ? {}
      : {
          after: {
            content: `${decoration.hits}×`,
            inlineClassName: "js-test-coverage-hit-count",
          },
        };

  return {
    options: {
      ...after,
      className: `js-test-coverage-line ${className}-line`,
      hoverMessage: { value: tooltip },
      isWholeLine: true,
      linesDecorationsClassName: `js-test-coverage-gutter ${className}-gutter`,
      linesDecorationsTooltip: tooltip,
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      zIndex: 4,
    },
    range: new monaco.Range(decoration.lineNumber, column, decoration.lineNumber, column),
  };
}
