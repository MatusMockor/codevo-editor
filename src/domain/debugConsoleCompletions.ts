import { debugUtf8ByteLength } from "./debugEvaluationPolicy";
import { maskJavaScriptSource } from "./javascriptSourceMask";
import { isWellFormedUnicode } from "./unicodeText";

export const MAX_DEBUG_COMPLETION_QUERY_BYTES = 4 * 1_024;
export const MAX_DEBUG_COMPLETION_PREFIX_BYTES = 1_024;
export const MAX_DEBUG_COMPLETION_ITEMS = 200;
export const MAX_DEBUG_COMPLETION_LABEL_BYTES = 1_024;
export const MAX_DEBUG_COMPLETION_RESPONSE_BYTES = 64 * 1_024;
export const MAX_DEBUG_COMPLETION_RECEIVER_SEGMENTS = 8;

export const DEBUG_COMPLETION_ITEM_KINDS = ["variable", "property"] as const;

export type DebugCompletionItemKind = (typeof DEBUG_COMPLETION_ITEM_KINDS)[number];

export interface DebugConsoleCompletionItem {
  readonly label: string;
  readonly kind: DebugCompletionItemKind;
}

export interface DebugConsoleCompletionResponse {
  readonly isIncomplete: boolean;
  readonly items: readonly DebugConsoleCompletionItem[];
}

export type DebugConsoleCompletionQuery =
  | {
      readonly kind: "lexical";
      readonly prefix: string;
    }
  | {
      readonly kind: "member";
      readonly root:
        | { readonly kind: "binding"; readonly name: string }
        | { readonly kind: "this" };
      /** Already-decoded static own-property names; no expression is sent to the adapter. */
      readonly path: readonly string[];
      readonly prefix: string;
    };

export interface DebugConsoleCompletionRequest {
  readonly rootPath: string;
  readonly sessionId: number;
  readonly pauseGeneration: number;
  readonly frameId: number;
  readonly query: DebugConsoleCompletionQuery;
}

export interface DebugConsoleCompletionReplacement {
  /** Inclusive UTF-16 offset in the console input. */
  readonly start: number;
  /** Exclusive UTF-16 offset in the console input. */
  readonly end: number;
}

export interface DebugConsoleCompletionContext {
  readonly prefix: string;
  readonly query: DebugConsoleCompletionQuery;
  readonly replacement: DebugConsoleCompletionReplacement;
}

interface ParsedStaticQuery {
  readonly prefix: string;
  readonly prefixStart: number;
  readonly query: DebugConsoleCompletionQuery;
  readonly segments: number;
}

const identifierPattern = /(?:[$_]|\p{ID_Start})(?:[$_\u200c\u200d]|\p{ID_Continue})*/uy;
const identifierStartPattern = /(?:[$_]|\p{ID_Start})/u;
const identifierContinuePattern = /(?:[$_\u200c\u200d]|\p{ID_Continue})/u;
const integerPattern = /(?:0|[1-9]\d*)/y;
const forbiddenReceiverWords = new Set([
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

/**
 * Extracts the deliberately side-effect-free subset accepted by Node debug
 * completions. Offsets are JavaScript/Monaco UTF-16 offsets, never code-point
 * or UTF-8 byte offsets.
 */
export function debugConsoleCompletionContextAt(
  source: string,
  cursorOffset: number,
): DebugConsoleCompletionContext | null {
  if (
    source.length > MAX_DEBUG_COMPLETION_QUERY_BYTES ||
    debugUtf8ByteLength(source) > MAX_DEBUG_COMPLETION_QUERY_BYTES ||
    !isWellFormedUnicode(source) ||
    !Number.isSafeInteger(cursorOffset) ||
    cursorOffset < 0 ||
    cursorOffset > source.length
  ) {
    return null;
  }

  const lineStart = Math.max(source.lastIndexOf("\n", cursorOffset - 1) + 1, 0);
  const rawPrefix = source.slice(lineStart, cursorOffset);
  const maskedPrefix = maskJavaScriptSource(source).slice(lineStart, cursorOffset);
  if (rawPrefix.trim() === "" && isLexicalCursor(source, cursorOffset)) {
    return frozenCompletionContext(
      "",
      Object.freeze({ kind: "lexical", prefix: "" }),
      cursorOffset,
      cursorOffset,
    );
  }

  for (let relativeStart = 0; relativeStart < maskedPrefix.length; relativeStart += 1) {
    const character = maskedPrefix[relativeStart] ?? "";
    if (!identifierStartPattern.test(character) || !isSafeQueryBoundary(rawPrefix, relativeStart)) {
      continue;
    }

    const expression = rawPrefix.slice(relativeStart);
    const parsed = parseStaticQuery(expression);
    if (
      parsed === null ||
      debugUtf8ByteLength(JSON.stringify(parsed.query)) > MAX_DEBUG_COMPLETION_QUERY_BYTES ||
      debugUtf8ByteLength(parsed.prefix) > MAX_DEBUG_COMPLETION_PREFIX_BYTES
    ) {
      continue;
    }

    const absolutePrefixStart = lineStart + relativeStart + parsed.prefixStart;
    return frozenCompletionContext(
      parsed.prefix,
      parsed.query,
      absolutePrefixStart,
      cursorOffset,
    );
  }

  return null;
}

export function isDebugCompletionItemKind(value: unknown): value is DebugCompletionItemKind {
  return (
    typeof value === "string" &&
    (DEBUG_COMPLETION_ITEM_KINDS as readonly string[]).includes(value)
  );
}

function parseStaticQuery(query: string): ParsedStaticQuery | null {
  identifierPattern.lastIndex = 0;
  const root = identifierPattern.exec(query);
  if (root === null || root.index !== 0) return null;

  let cursor = root[0].length;
  if (cursor === query.length) {
    return {
      prefix: root[0],
      prefixStart: 0,
      query: Object.freeze({ kind: "lexical", prefix: root[0] }),
      segments: 0,
    };
  }
  if (forbiddenReceiverWords.has(root[0]) && root[0] !== "this") return null;

  let segments = 0;
  let finalPrefix = "";
  let finalPrefixStart = -1;
  const path: string[] = [];

  while (cursor < query.length) {
    if (segments >= MAX_DEBUG_COMPLETION_RECEIVER_SEGMENTS) return null;
    const character = query[cursor] ?? "";

    if (character === ".") {
      if (query[cursor + 1] === "?" || query[cursor + 1] === "#") return null;
      segments += 1;
      cursor += 1;
      const memberStart = cursor;
      identifierPattern.lastIndex = cursor;
      const member = identifierPattern.exec(query);
      if (member !== null && member.index === cursor) cursor += member[0].length;
      if (cursor === query.length) {
        finalPrefix = member?.[0] ?? "";
        finalPrefixStart = memberStart;
        break;
      }
      if (member === null || (query[cursor] !== "." && query[cursor] !== "[")) return null;
      path.push(member[0]);
      continue;
    }

    if (character !== "[") return null;
    const bracket = staticBracketSegment(query, cursor);
    if (bracket === null) return null;
    segments += 1;
    path.push(bracket.name);
    cursor = bracket.end;
    if (cursor === query.length) return null;
  }

  if (finalPrefixStart < 0) return null;
  const rootAuthority =
    root[0] === "this"
      ? Object.freeze({ kind: "this" as const })
      : Object.freeze({ kind: "binding" as const, name: root[0] });
  return {
    prefix: finalPrefix,
    prefixStart: finalPrefixStart,
    query: Object.freeze({
      kind: "member",
      root: rootAuthority,
      path: Object.freeze(path),
      prefix: finalPrefix,
    }),
    segments,
  };
}

function staticBracketSegment(
  query: string,
  start: number,
): { readonly end: number; readonly name: string } | null {
  const valueStart = start + 1;
  integerPattern.lastIndex = valueStart;
  const integer = integerPattern.exec(query);
  const integerEnd = integer === null ? -1 : integer.index + integer[0].length;
  if (integer !== null && query[integerEnd] === "]") {
    return { end: integerEnd + 1, name: integer[0] };
  }

  if (query[valueStart] !== '"') return null;
  let cursor = valueStart + 1;
  let escaped = false;
  for (; cursor < query.length; cursor += 1) {
    const character = query[cursor] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character !== '"') continue;
    if (query[cursor + 1] !== "]") return null;
    const encoded = query.slice(valueStart, cursor + 1);
    let decoded: unknown;
    try {
      decoded = JSON.parse(encoded);
    } catch {
      return null;
    }
    if (
      typeof decoded !== "string" ||
      JSON.stringify(decoded) !== encoded ||
      [...decoded].some((value) => /\p{Cc}/u.test(value))
    ) {
      return null;
    }
    return { end: cursor + 2, name: decoded };
  }
  return null;
}

function isLexicalCursor(source: string, cursorOffset: number): boolean {
  const probe = "__debug_completion_probe__";
  const withProbe = `${source.slice(0, cursorOffset)}${probe}${source.slice(cursorOffset)}`;
  return maskJavaScriptSource(withProbe).slice(cursorOffset, cursorOffset + probe.length) === probe;
}

function frozenCompletionContext(
  prefix: string,
  query: DebugConsoleCompletionQuery,
  start: number,
  end: number,
): DebugConsoleCompletionContext {
  return Object.freeze({
    prefix,
    query,
    replacement: Object.freeze({ start, end }),
  });
}

function isSafeQueryBoundary(linePrefix: string, start: number): boolean {
  if (start === 0) return true;
  const previous = linePrefix[start - 1] ?? "";
  return (
    !identifierContinuePattern.test(previous) &&
    previous !== "." &&
    previous !== "?" &&
    previous !== "#" &&
    previous !== "]" &&
    previous !== ")"
  );
}
