import {
  innermostLatteExpressionSpanAt,
  innermostLatteNAttributeExpressionSpanAt,
} from "../domain/latteSyntax";

export interface LatteMemberAccess {
  end: number;
  prefix: string;
  receiverExpression: string;
  start: number;
  variableName: string;
}

export interface LatteMemberReference {
  memberName: string;
  receiverExpression: string;
  variableName: string;
}

export interface LatteFilterCompletionContext {
  end: number;
  prefix: string;
  start: number;
}

export interface LatteVariableCompletionContext {
  end: number;
  prefix: string;
  start: number;
}

export type LatteExpressionCompletionTarget =
  | { kind: "member"; member: LatteMemberAccess }
  | { kind: "filter"; filter: LatteFilterCompletionContext }
  | { kind: "variable"; variable: LatteVariableCompletionContext };

const LATTE_MEMBER_ACCESS =
  /(\$([A-Za-z_][A-Za-z0-9_]*)(?:\s*\??->\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*\??->\s*([A-Za-z_][A-Za-z0-9_]*)?$/;
const LATTE_MEMBER_REFERENCE =
  /(\$([A-Za-z_][A-Za-z0-9_]*)(?:\s*\??->\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*\??->\s*([A-Za-z_][A-Za-z0-9_]*)/g;
const LATTE_FILTER_TAIL = /\|\s*([A-Za-z_][A-Za-z0-9_]*)?$/;
const LATTE_VARIABLE_REFERENCE = /\$([A-Za-z_][A-Za-z0-9_]*)/g;
const LATTE_VARIABLE_TAIL = /(?<![A-Za-z0-9_>])\$([A-Za-z_][A-Za-z0-9_]*)?$/;

interface LatteDetectedExpressionSpan {
  contentEnd: number;
  contentStart: number;
  expressionStart: number;
}

function latteDetectedExpressionSpanAt(
  source: string,
  offset: number,
): LatteDetectedExpressionSpan | null {
  const span = innermostLatteExpressionSpanAt(source, offset);

  if (span) {
    return span;
  }

  const attribute = innermostLatteNAttributeExpressionSpanAt(source, offset);

  if (!attribute) {
    return null;
  }

  return {
    contentEnd: attribute.contentEnd,
    contentStart: attribute.expressionStart,
    expressionStart: attribute.expressionStart,
  };
}

export function latteExpressionCompletionTargetAt(
  source: string,
  offset: number,
): LatteExpressionCompletionTarget | null {
  const span = latteDetectedExpressionSpanAt(source, offset);

  if (!span) {
    return null;
  }

  const before = source.slice(span.contentStart, offset);

  if (hasUnclosedStringLiteral(before)) {
    return null;
  }

  const member = latteMemberAccessAt(before, offset);

  if (member) {
    return { kind: "member", member };
  }

  const filter = latteFilterAt(before, offset);

  if (filter) {
    return { kind: "filter", filter };
  }

  const variable = latteVariableCompletionAt(before, offset);

  if (variable) {
    return { kind: "variable", variable };
  }

  return null;
}

export function isLatteMemberReferenceAt(source: string, offset: number): boolean {
  return latteMemberReferenceAt(source, offset) !== null;
}

export function latteVariableNameAt(
  source: string,
  offset: number,
): string | null {
  const span = latteDetectedExpressionSpanAt(source, offset);

  if (!span) {
    return null;
  }

  const expression = source.slice(span.expressionStart, span.contentEnd);
  const relativeOffset = offset - span.expressionStart;
  const before = expression.slice(0, Math.max(0, relativeOffset));

  if (hasUnclosedStringLiteral(before)) {
    return null;
  }

  for (const match of expression.matchAll(LATTE_VARIABLE_REFERENCE)) {
    const name = match[1] ?? "";
    const start = match.index ?? 0;
    const end = start + match[0].length;

    if (relativeOffset < start || relativeOffset > end) {
      continue;
    }

    const previous = expression[start - 1] ?? "";

    if (/[A-Za-z0-9_>]/.test(previous)) {
      continue;
    }

    return name || null;
  }

  return null;
}

export function latteMemberReferenceAt(
  source: string,
  offset: number,
): LatteMemberReference | null {
  const span = latteDetectedExpressionSpanAt(source, offset);

  if (!span) {
    return null;
  }

  const expression = source.slice(span.expressionStart, span.contentEnd);
  const relativeOffset = offset - span.expressionStart;
  const before = expression.slice(0, Math.max(0, relativeOffset));

  if (hasUnclosedStringLiteral(before)) {
    return null;
  }

  for (const match of expression.matchAll(LATTE_MEMBER_REFERENCE)) {
    const receiver = match[1];
    const variableName = match[2];
    const memberName = match[3];

    if (!receiver || !variableName || !memberName || match.index === undefined) {
      continue;
    }

    const memberStart = match.index + match[0].lastIndexOf(memberName);
    const memberEnd = memberStart + memberName.length;

    if (relativeOffset < memberStart || relativeOffset > memberEnd) {
      continue;
    }

    return {
      memberName,
      receiverExpression: normalizeMemberReceiver(receiver),
      variableName,
    };
  }

  return null;
}

/**
 * True when `before` (an expression-tag slice ending at the cursor) has an
 * unterminated `'...'` / `"..."` literal, i.e. the cursor sits inside a string.
 * Single bounded pass with escape handling, mirroring the quote tracking the
 * domain's `stripLatteFilterChain` uses.
 */
export function hasUnclosedStringLiteral(before: string): boolean {
  let quote: string | null = null;
  let index = 0;

  while (index < before.length) {
    const char = before[index];

    if (quote) {
      if (char === "\\") {
        index += 2;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      index += 1;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
    }

    index += 1;
  }

  return quote !== null;
}

/**
 * Detects a `{$var->}` / `{$var->rel->prop}` member access ending at `offset`
 * from `before` (the expression-tag slice up to the cursor, already confirmed
 * to sit outside string literals). `receiverExpression` is the chain up to the
 * last `->` (whitespace / nullsafe `?->` normalized to `->`), so the injected
 * PHP engine resolves it exactly like Blade's `$var->`; `prefix` is the partial
 * member being typed.
 */
function latteMemberAccessAt(
  before: string,
  offset: number,
): LatteMemberAccess | null {
  const match = LATTE_MEMBER_ACCESS.exec(before);

  if (!match?.[1] || !match[2]) {
    return null;
  }

  const prefix = match[3] ?? "";

  return {
    end: offset,
    prefix,
    receiverExpression: normalizeMemberReceiver(match[1]),
    start: offset - prefix.length,
    variableName: match[2],
  };
}

/**
 * Detects a `|filter` name being typed at `offset` from `before` (the
 * expression-tag slice up to the cursor, already confirmed outside string
 * literals). Rejects a `||` logical-or so it never offers filters after a
 * boolean expression.
 */
function latteFilterAt(
  before: string,
  offset: number,
): LatteFilterCompletionContext | null {
  const match = LATTE_FILTER_TAIL.exec(before);

  if (!match) {
    return null;
  }

  if (before[match.index - 1] === "|") {
    return null;
  }

  const prefix = match[1] ?? "";

  return { end: offset, prefix, start: offset - prefix.length };
}

/**
 * Detects a `$var` reference being typed at `offset` from `before` (the
 * expression-tag slice up to the cursor, already confirmed outside string
 * literals; not part of a `->` member chain - the lookbehind rejects a `$`
 * preceded by a word char or `>`).
 */
function latteVariableCompletionAt(
  before: string,
  offset: number,
): LatteVariableCompletionContext | null {
  const match = LATTE_VARIABLE_TAIL.exec(before);

  if (!match) {
    return null;
  }

  const prefix = match[1] ?? "";

  return { end: offset, prefix, start: offset - prefix.length - 1 };
}

function normalizeMemberReceiver(receiver: string): string {
  return receiver.replace(/\s*\??->\s*/g, "->");
}
