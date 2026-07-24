import type { DebugScope } from "./debug";
import { debugUtf8ByteLength } from "./debugEvaluationPolicy";
import {
  debugInspectionOwnersEqual,
  isDebugInspectionOwner,
  type DebugInspectionOwner,
  type DebugVariablePagesState,
} from "./debugVariablePages";
import { maskJavaScriptSource } from "./javascriptSourceMask";
import { computeLineStartOffsets } from "./sourceLineOffsets";
import { isWellFormedUnicode } from "./unicodeText";

export const MAX_DEBUG_INLINE_SOURCE_BYTES = 256 * 1_024;
export const MAX_DEBUG_INLINE_SOURCE_LINES = 5_000;
export const MAX_DEBUG_INLINE_LINE_BYTES = 16 * 1_024;
export const MAX_DEBUG_INLINE_VALUE_BYTES = 256;
export const MAX_DEBUG_INLINE_RENDERED_BYTES = 4 * 1_024;
export const MAX_DEBUG_INLINE_VALUES = 12;
export const MAX_DEBUG_INLINE_ROOT_SCOPES = 2;
export const MAX_DEBUG_INLINE_VARIABLES_PER_SCOPE = 100;

export interface DebugInlineValueRange {
  readonly endColumn: number;
  readonly endLineNumber: number;
  readonly startColumn: number;
  readonly startLineNumber: number;
}

export interface DebugInlineValue {
  readonly content: string;
  readonly name: string;
  readonly range: DebugInlineValueRange;
  readonly value: string;
}

export interface DebugInlineValueSelection {
  readonly lineNumber: number;
  readonly owner: DebugInspectionOwner;
  readonly scopes: readonly DebugScope[];
  readonly source: string;
  readonly variablePages: DebugVariablePagesState;
}

const identifierPattern = /(?:[$_]|\p{ID_Start})(?:[$_\u200c\u200d]|\p{ID_Continue})*/gu;
const completeIdentifierPattern = /^(?:[$_]|\p{ID_Start})(?:[$_\u200c\u200d]|\p{ID_Continue})*$/u;
const propertyPrefixPattern = /(?:\?\.|\.)\s*$/u;
const unsafeInlineValueCharacterPattern = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8NormalizingDecoder = new TextDecoder();

/**
 * Selects already-cached root-scope variables for one exact paused frame and
 * stopped source line. This selector never evaluates expressions or traverses
 * child variable references.
 */
export function selectDebugInlineValues(
  selection: DebugInlineValueSelection,
): readonly DebugInlineValue[] {
  const { lineNumber, owner, scopes, source, variablePages } = selection;
  if (
    !Number.isSafeInteger(lineNumber) ||
    lineNumber <= 0 ||
    !isDebugInspectionOwner(owner) ||
    !isWellFormedUnicode(source) ||
    debugUtf8ByteLength(source) > MAX_DEBUG_INLINE_SOURCE_BYTES ||
    !debugInspectionOwnersEqual(owner, variablePages.owner)
  ) {
    return [];
  }

  const lineStarts = computeLineStartOffsets(source);
  if (lineStarts.length > MAX_DEBUG_INLINE_SOURCE_LINES || lineNumber > lineStarts.length) {
    return [];
  }
  const lineStart = lineStarts[lineNumber - 1] ?? 0;
  const nextLineStart = lineStarts[lineNumber];
  const rawLineEnd = nextLineStart === undefined ? source.length : nextLineStart - 1;
  const lineEnd = source.charCodeAt(rawLineEnd - 1) === 13 ? rawLineEnd - 1 : rawLineEnd;
  const line = source.slice(lineStart, lineEnd);
  if (debugUtf8ByteLength(line) > MAX_DEBUG_INLINE_LINE_BYTES) return [];

  const availableValues = collectRootScopeValues(scopes, variablePages);
  if (availableValues.size === 0) return [];
  const maskedLine = maskJavaScriptSource(source).slice(lineStart, lineEnd);
  const selectedNames = new Set<string>();
  const result: DebugInlineValue[] = [];
  let renderedBytes = 0;

  for (const match of maskedLine.matchAll(identifierPattern)) {
    const name = match[0];
    const start = match.index ?? 0;
    if (
      selectedNames.has(name) ||
      propertyPrefixPattern.test(maskedLine.slice(0, start)) ||
      !availableValues.has(name)
    ) {
      continue;
    }
    const value = availableValues.get(name)!;
    const content = ` = ${value}`;
    const contentBytes = debugUtf8ByteLength(content);
    if (renderedBytes + contentBytes > MAX_DEBUG_INLINE_RENDERED_BYTES) break;

    selectedNames.add(name);
    renderedBytes += contentBytes;
    result.push(
      Object.freeze({
        content,
        name,
        range: Object.freeze({
          endColumn: start + name.length + 1,
          endLineNumber: lineNumber,
          startColumn: start + 1,
          startLineNumber: lineNumber,
        }),
        value,
      }),
    );
    if (result.length === MAX_DEBUG_INLINE_VALUES) break;
  }

  return Object.freeze(result);
}

function collectRootScopeValues(
  scopes: readonly DebugScope[],
  variablePages: DebugVariablePagesState,
): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  const rootReferences: number[] = [];
  const seenReferences = new Set<number>();
  for (const scope of scopes) {
    const variablesReference = scope.variablesReference;
    if (
      scope.expensive ||
      !Number.isSafeInteger(variablesReference) ||
      variablesReference <= 0 ||
      seenReferences.has(variablesReference)
    ) {
      continue;
    }
    seenReferences.add(variablesReference);
    rootReferences.push(variablesReference);
    if (rootReferences.length === MAX_DEBUG_INLINE_ROOT_SCOPES) break;
  }

  for (const variablesReference of rootReferences) {
    const page = variablePages.references[variablesReference]?.pages[0];
    if (!page) continue;
    for (const variable of page.variables.slice(0, MAX_DEBUG_INLINE_VARIABLES_PER_SCOPE)) {
      if (
        values.has(variable.name) ||
        !completeIdentifierPattern.test(variable.name) ||
        typeof variable.value !== "string"
      ) {
        continue;
      }
      values.set(
        variable.name,
        truncateUtf8(normalizeInlineValue(variable.value), MAX_DEBUG_INLINE_VALUE_BYTES),
      );
    }
  }
  return values;
}

function normalizeInlineValue(value: string): string {
  const wellFormed = utf8NormalizingDecoder.decode(utf8Encoder.encode(value));
  return [...wellFormed]
    .map((character) => (unsafeInlineValueCharacterPattern.test(character) ? "�" : character))
    .join("");
}

function truncateUtf8(value: string, maximumBytes: number): string {
  const bytes = utf8Encoder.encode(value);
  if (bytes.byteLength <= maximumBytes) return value;
  const ellipsis = utf8Encoder.encode("…");
  let end = maximumBytes - ellipsis.byteLength;
  while (end > 0) {
    try {
      return `${utf8Decoder.decode(bytes.slice(0, end))}…`;
    } catch {
      end -= 1;
    }
  }
  return "";
}
