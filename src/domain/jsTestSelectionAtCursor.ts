import type { EditorPosition } from "./languageServerFeatures";
import {
  JsTestDeclarationBudgetError,
  jsTestDeclarations,
  type JsTestDeclaration,
} from "./jsTestDeclarations";
import { validatedJsTestRunScope } from "./jsTestRunScope";
import { computeLineStartOffsets } from "./sourceLineOffsets";
import { isWellFormedUnicode } from "./unicodeText";

export const MAX_JS_TEST_AT_CURSOR_SOURCE_BYTES = 512 * 1024;
export const MAX_JS_TEST_AT_CURSOR_SOURCE_LINES = 20_000;
export const MAX_JS_TEST_AT_CURSOR_DECLARATIONS = 512;

export type JsTestAtCursorMatch = "containing" | "preceding";

export interface JsTestAtCursorSelection {
  readonly fullName: string;
  readonly kind: "suite" | "test";
  readonly match: JsTestAtCursorMatch;
  readonly nameMatch: "exact" | "prefix";
  readonly parameterized: boolean;
  readonly position: Readonly<EditorPosition>;
  readonly suitePath: readonly string[];
  readonly title: string;
}

/**
 * Resolves a runner-neutral selection over the statically-known Jest/Vitest
 * declaration tree. The deepest complete containing call wins; otherwise the
 * latest complete declaration starting before the cursor wins. Dynamic,
 * incomplete, ambiguous, and over-budget input fails closed.
 */
export function jsTestSelectionAtCursor(
  source: string,
  position: EditorPosition,
): JsTestAtCursorSelection | null {
  if (
    !isWellFormedUnicode(source) ||
    new TextEncoder().encode(source).byteLength > MAX_JS_TEST_AT_CURSOR_SOURCE_BYTES ||
    candidateBudgetExceeded(source)
  ) {
    return null;
  }

  const lineStarts = computeLineStartOffsets(source);
  if (lineStarts.length > MAX_JS_TEST_AT_CURSOR_SOURCE_LINES) return null;
  const cursorOffset = offsetAtPosition(source, lineStarts, position);
  if (cursorOffset === null) return null;

  let parsedDeclarations: readonly JsTestDeclaration[];
  try {
    parsedDeclarations = jsTestDeclarations(source);
  } catch (error) {
    if (error instanceof JsTestDeclarationBudgetError) return null;
    throw error;
  }
  if (parsedDeclarations.length > MAX_JS_TEST_AT_CURSOR_DECLARATIONS) return null;
  const declarations = parsedDeclarations.filter(isRunnableDeclaration);
  const candidates = declarations.map((declaration) => ({
    declaration,
    depth: declaration.suitePath.length + 1,
    endOffset: declaration.callSpan?.endOffset ?? -1,
    startOffset: offsetAtPosition(source, lineStarts, declaration.target.position) ?? -1,
  }));
  const containing = candidates
    .filter(
      ({ endOffset, startOffset }) =>
        startOffset >= 0 && startOffset <= cursorOffset && cursorOffset <= endOffset,
    )
    .sort(
      (left, right) =>
        right.depth - left.depth ||
        left.endOffset - right.endOffset ||
        right.startOffset - left.startOffset,
    )[0];
  if (containing) {
    return unambiguous(containing.declaration, parsedDeclarations)
      ? selection(containing.declaration, "containing")
      : null;
  }

  const preceding = candidates
    .filter(({ startOffset }) => startOffset >= 0 && startOffset <= cursorOffset)
    .sort(
      (left, right) =>
        right.startOffset - left.startOffset ||
        right.depth - left.depth ||
        left.endOffset - right.endOffset,
    )[0];
  if (!preceding) return null;
  return unambiguous(preceding.declaration, parsedDeclarations)
    ? selection(preceding.declaration, "preceding")
    : null;
}

function isRunnableDeclaration(declaration: JsTestDeclaration): boolean {
  if (declaration.callSpan === null) return false;
  try {
    validatedJsTestRunScope({
      fullName: declaration.fullName,
      kind: declaration.kind,
      relativeFilePath: "selection.test.ts",
    });
    return true;
  } catch {
    return false;
  }
}

function unambiguous(
  selected: JsTestDeclaration,
  declarations: readonly JsTestDeclaration[],
): boolean {
  if (selected.kind === "test" && !selected.parameterized) {
    return !declarations.some(
      (candidate) =>
        candidate !== selected &&
        candidate.kind === "test" &&
        candidate.fullName === selected.fullName,
    );
  }

  const selectedSpan = selected.callSpan;
  if (!selectedSpan) return false;
  return !declarations.some((candidate) => {
    if (candidate === selected || !prefixMatches(selected.fullName, candidate.fullName)) {
      return false;
    }
    if (selected.kind === "test") return true;
    const candidateSpan = candidate.callSpan;
    return (
      !candidateSpan ||
      candidateSpan.startOffset <= selectedSpan.startOffset ||
      candidateSpan.endOffset >= selectedSpan.endOffset
    );
  });
}

function prefixMatches(prefix: string, fullName: string): boolean {
  return fullName === prefix || fullName.startsWith(`${prefix} `);
}

function selection(
  declaration: JsTestDeclaration,
  match: JsTestAtCursorMatch,
): JsTestAtCursorSelection {
  return Object.freeze({
    fullName: declaration.fullName,
    kind: declaration.kind,
    match,
    nameMatch: declaration.kind === "suite" || declaration.parameterized ? "prefix" : "exact",
    parameterized: declaration.parameterized,
    position: Object.freeze({ ...declaration.target.position }),
    suitePath: Object.freeze([...declaration.suitePath]),
    title: declaration.title,
  });
}

function offsetAtPosition(
  source: string,
  lineStarts: readonly number[],
  position: EditorPosition,
): number | null {
  if (
    !Number.isSafeInteger(position.lineNumber) ||
    !Number.isSafeInteger(position.column) ||
    position.lineNumber < 1 ||
    position.column < 1 ||
    position.lineNumber > lineStarts.length
  ) {
    return null;
  }
  const lineStart = lineStarts[position.lineNumber - 1];
  if (lineStart === undefined) return null;
  const newline = source.indexOf("\n", lineStart);
  const lineEnd = newline === -1 ? source.length : newline;
  const offset = lineStart + position.column - 1;
  return offset <= lineEnd ? offset : null;
}

function candidateBudgetExceeded(source: string): boolean {
  const broadCandidate = /(?:^|[^\w$])(describe|it|test)\b/g;
  let count = 0;
  while (broadCandidate.exec(source)) {
    count += 1;
    if (count > MAX_JS_TEST_AT_CURSOR_DECLARATIONS) return true;
  }
  return false;
}
