import { isWellFormedUnicode } from "./unicodeText";

export const MAX_DEBUG_LOG_MESSAGE_BYTES = 4_096;
export const MAX_DEBUG_LOG_EXPRESSIONS = 32;
export const MAX_DEBUG_LOG_EXPRESSION_BYTES = 1_024;

export type DebugLogSegment =
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "expression"; readonly value: string };

export interface DebugLogTemplate {
  readonly segments: readonly DebugLogSegment[];
}

const RUST_WHITESPACE =
  /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Mirrors Rust `str::trim`, whose whitespace set differs from ECMAScript `trim`. */
function rustTrim(value: string): string {
  return value.replace(RUST_WHITESPACE, "");
}

/** Parses the exact escaped-brace template grammar accepted by the Rust debugger core. */
export function parseDebugLogMessage(message: string): DebugLogTemplate | null {
  if (!isWellFormedUnicode(message) || rustTrim(message) === "" || message.includes("\0")) {
    return null;
  }
  if (utf8ByteLength(message) > MAX_DEBUG_LOG_MESSAGE_BYTES) return null;

  const segments: DebugLogSegment[] = [];
  let literal = "";
  let expressionCount = 0;

  for (let index = 0; index < message.length; index += 1) {
    const character = message[index];
    const next = message[index + 1];
    if (character === "{" && next === "{") {
      literal += "{";
      index += 1;
      continue;
    }
    if (character === "}" && next === "}") {
      literal += "}";
      index += 1;
      continue;
    }
    if (character === "}") return null;
    if (character !== "{") {
      literal += character;
      continue;
    }

    if (literal !== "") {
      segments.push({ kind: "literal", value: literal });
      literal = "";
    }
    const closingIndex = message.indexOf("}", index + 1);
    if (closingIndex < 0) return null;
    const untrimmedExpression = message.slice(index + 1, closingIndex);
    if (untrimmedExpression.includes("{")) return null;
    const expression = rustTrim(untrimmedExpression);
    if (
      expression === "" ||
      utf8ByteLength(expression) > MAX_DEBUG_LOG_EXPRESSION_BYTES ||
      expressionCount >= MAX_DEBUG_LOG_EXPRESSIONS
    ) {
      return null;
    }
    segments.push({ kind: "expression", value: expression });
    expressionCount += 1;
    index = closingIndex;
  }

  if (literal !== "") segments.push({ kind: "literal", value: literal });
  return { segments };
}

export function isBreakpointLogMessage(value: unknown): value is string {
  return typeof value === "string" && parseDebugLogMessage(value) !== null;
}

export function breakpointLogMessageError(message: string): string | null {
  if (rustTrim(message) === "") return null;
  if (!isWellFormedUnicode(message)) return "Logpoint messages must contain valid Unicode text.";
  if (message.includes("\0")) return "Logpoint messages cannot contain a NUL character.";
  if (utf8ByteLength(message) > MAX_DEBUG_LOG_MESSAGE_BYTES) {
    return `Logpoint messages must be at most ${MAX_DEBUG_LOG_MESSAGE_BYTES} UTF-8 bytes.`;
  }
  return parseDebugLogMessage(message)
    ? null
    : `Use text and up to ${MAX_DEBUG_LOG_EXPRESSIONS} expressions in {braces}; escape literal braces as {{ or }}.`;
}
