import type { EditorPosition } from "./languageServerFeatures";
import { JsTestDeclarationBudgetError, jsTestDeclarations } from "./jsTestDeclarations";
import { computeLineStartOffsets } from "./sourceLineOffsets";
import type { TestGutterTarget } from "./testGutterTargets";

export function jsTestGutterTargets(source: string): TestGutterTarget[] {
  try {
    return jsTestDeclarations(source).map(({ target }) => target);
  } catch (error) {
    if (error instanceof JsTestDeclarationBudgetError) return [];
    throw error;
  }
}

export function runAllJsTestsTarget(
  source: string,
  targets: readonly TestGutterTarget[],
): TestGutterTarget | null {
  const describeTarget = targets.find((target) => target.kind === "class");

  if (!describeTarget) {
    return null;
  }

  const lineStartOffsets = computeLineStartOffsets(source);
  const declaration = jsTestDeclarations(source).find(
    ({ target }) =>
      target.kind === describeTarget.kind &&
      target.filter === describeTarget.filter &&
      target.position.lineNumber === describeTarget.position.lineNumber &&
      target.position.column === describeTarget.position.column,
  );
  const span = declaration?.callSpan;

  if (!span) {
    return null;
  }

  const covered = targets.every((target) => {
    if (target === describeTarget) {
      return true;
    }

    const offset = offsetAt(lineStartOffsets, target.position);

    return offset > span.startOffset && offset < span.endOffset;
  });

  if (!covered) {
    return null;
  }

  return describeTarget;
}

function offsetAt(lineStartOffsets: number[], position: EditorPosition): number {
  return (lineStartOffsets[position.lineNumber - 1] ?? 0) + position.column - 1;
}
