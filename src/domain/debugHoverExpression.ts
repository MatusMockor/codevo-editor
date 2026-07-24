import {
  MAX_DEBUG_EVALUATION_EXPRESSION_BYTES,
  debugUtf8ByteLength,
  validateDebugExpression,
} from "./debugEvaluationPolicy";
import { maskJavaScriptSource } from "./javascriptSourceMask";
import { computeLineStartOffsets } from "./sourceLineOffsets";
import { isWellFormedUnicode } from "./unicodeText";

export const MAX_DEBUG_HOVER_SOURCE_BYTES = 256 * 1_024;
export const MAX_DEBUG_HOVER_SOURCE_LINES = 5_000;
export const MAX_DEBUG_HOVER_LINE_BYTES = 16 * 1_024;
export const MAX_DEBUG_HOVER_EXPRESSION_BYTES = MAX_DEBUG_EVALUATION_EXPRESSION_BYTES;

export interface DebugHoverPosition {
  readonly column: number;
  readonly lineNumber: number;
}

export interface DebugHoverRange {
  readonly endColumn: number;
  readonly endLineNumber: number;
  readonly startColumn: number;
  readonly startLineNumber: number;
}

export interface DebugHoverExpression {
  readonly expression: string;
  readonly range: DebugHoverRange;
}

export interface DebugHoverExpressionIndex {
  at(position: DebugHoverPosition): DebugHoverExpression | null;
}

interface IdentifierSpan {
  readonly end: number;
  readonly start: number;
  readonly value: string;
}

const identifierPattern = /(?:[$_]|\p{ID_Start})(?:[$_\u200c\u200d]|\p{ID_Continue})*/gu;
const memberSeparatorPattern = /^\s*(?:\?\.|\.)\s*$/u;
const memberPrefixPattern = /(?:\?\.|\.)\s*$/u;
const memberSuffixPattern = /^\s*(?:\?\.|\.)/u;
const unsupportedPrivateMemberPrefixPattern = /(?:\?\.|\.)\s*#\s*$/u;
const reservedWords = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "null",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

/** Builds the immutable, model-version-scoped lexical index used by debug hover providers. */
export function createDebugHoverExpressionIndex(source: string): DebugHoverExpressionIndex | null {
  if (!isWellFormedUnicode(source) || debugUtf8ByteLength(source) > MAX_DEBUG_HOVER_SOURCE_BYTES) {
    return null;
  }
  const lineStarts = computeLineStartOffsets(source);
  if (lineStarts.length > MAX_DEBUG_HOVER_SOURCE_LINES) return null;
  const masked = maskJavaScriptSource(source);

  return Object.freeze({
    at: (position: DebugHoverPosition) =>
      expressionAtPosition(source, masked, lineStarts, position),
  });
}

function expressionAtPosition(
  source: string,
  masked: string,
  lineStarts: readonly number[],
  position: DebugHoverPosition,
): DebugHoverExpression | null {
  if (!validPosition(position) || position.lineNumber > lineStarts.length) return null;
  const lineStart = lineStarts[position.lineNumber - 1] ?? 0;
  const nextLineStart = lineStarts[position.lineNumber];
  const rawLineEnd = nextLineStart === undefined ? source.length : nextLineStart - 1;
  const lineEnd = source.charCodeAt(rawLineEnd - 1) === 13 ? rawLineEnd - 1 : rawLineEnd;
  const line = source.slice(lineStart, lineEnd);
  if (position.column > line.length + 1 || debugUtf8ByteLength(line) > MAX_DEBUG_HOVER_LINE_BYTES) {
    return null;
  }

  const maskedLine = masked.slice(lineStart, lineEnd);
  const offset = position.column - 1;
  const identifiers = identifierSpans(maskedLine);
  const hoveredIndex = identifiers.findIndex(({ start, end }) => start <= offset && offset < end);
  if (hoveredIndex < 0) return null;

  let first = hoveredIndex;
  while (
    first > 0 &&
    memberSeparatorPattern.test(
      maskedLine.slice(identifiers[first - 1]!.end, identifiers[first]!.start),
    )
  ) {
    first -= 1;
  }
  let last = hoveredIndex;
  while (
    last + 1 < identifiers.length &&
    memberSeparatorPattern.test(
      maskedLine.slice(identifiers[last]!.end, identifiers[last + 1]!.start),
    )
  ) {
    last += 1;
  }

  const firstIdentifier = identifiers[first]!;
  const lastIdentifier = identifiers[last]!;
  if (
    memberPrefixPattern.test(maskedLine.slice(0, firstIdentifier.start)) ||
    unsupportedPrivateMemberPrefixPattern.test(maskedLine.slice(0, firstIdentifier.start)) ||
    memberSuffixPattern.test(maskedLine.slice(lastIdentifier.end)) ||
    /^\s*\(/u.test(maskedLine.slice(lastIdentifier.end)) ||
    (first === last && reservedWords.has(firstIdentifier.value))
  ) {
    return null;
  }

  const expression = line.slice(firstIdentifier.start, lastIdentifier.end);
  const validation = validateDebugExpression(expression);
  if (
    !validation.ok ||
    debugUtf8ByteLength(validation.expression) > MAX_DEBUG_HOVER_EXPRESSION_BYTES
  ) {
    return null;
  }

  return Object.freeze({
    expression: validation.expression,
    range: Object.freeze({
      endColumn: lastIdentifier.end + 1,
      endLineNumber: position.lineNumber,
      startColumn: firstIdentifier.start + 1,
      startLineNumber: position.lineNumber,
    }),
  });
}

function identifierSpans(line: string): IdentifierSpan[] {
  return [...line.matchAll(identifierPattern)].map((match) => ({
    end: (match.index ?? 0) + match[0].length,
    start: match.index ?? 0,
    value: match[0],
  }));
}

function validPosition(position: DebugHoverPosition): boolean {
  return (
    Number.isSafeInteger(position.lineNumber) &&
    position.lineNumber > 0 &&
    Number.isSafeInteger(position.column) &&
    position.column > 0
  );
}
