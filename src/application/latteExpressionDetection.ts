import { innermostLatteExpressionContextAt } from "../domain/latteSyntax";
import {
  latteExpressionLexicalStateAtEnd,
  latteReceiverMemberCompletionAt,
  latteReceiverMemberReferenceAt,
} from "../domain/latteReceiverExpression";

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

export interface LatteFilterReference {
  name: string;
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

export interface LatteExpressionNavigation {
  memberReference: LatteMemberReference | null;
  variableName: string | null;
}

const LATTE_FILTER_REFERENCE = /\|\s*([A-Za-z_][A-Za-z0-9_]*)/g;
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
  const context = innermostLatteExpressionContextAt(source, offset);

  if (!context) {
    return null;
  }

  if (context.kind === "tag") {
    return context.span;
  }

  return {
    contentEnd: context.span.contentEnd,
    contentStart: context.span.expressionStart,
    expressionStart: context.span.expressionStart,
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

  if (latteExpressionLexicalStateAtEnd(before) !== "code") {
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

/**
 * Computes both navigation views (variable name and member reference) at
 * `offset` from a single expression-context detection, so a definition request
 * scans the template source once instead of once per view.
 */
export function latteExpressionNavigationAt(
  source: string,
  offset: number,
): LatteExpressionNavigation {
  const span = latteDetectedExpressionSpanAt(source, offset);

  if (!span) {
    return { memberReference: null, variableName: null };
  }

  return {
    memberReference: latteMemberReferenceInSpan(source, offset, span),
    variableName: latteVariableNameInSpan(source, offset, span),
  };
}

export function latteVariableNameAt(
  source: string,
  offset: number,
): string | null {
  const span = latteDetectedExpressionSpanAt(source, offset);

  if (!span) {
    return null;
  }

  return latteVariableNameInSpan(source, offset, span);
}

function latteVariableNameInSpan(
  source: string,
  offset: number,
  span: LatteDetectedExpressionSpan,
): string | null {
  const expression = source.slice(span.expressionStart, span.contentEnd);
  const relativeOffset = offset - span.expressionStart;
  const before = expression.slice(0, Math.max(0, relativeOffset));

  if (latteExpressionLexicalStateAtEnd(before) !== "code") {
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

  return latteMemberReferenceInSpan(source, offset, span);
}

export function latteFilterReferenceAt(
  source: string,
  offset: number,
): LatteFilterReference | null {
  const span = latteDetectedExpressionSpanAt(source, offset);

  if (!span) {
    return null;
  }

  const expression = source.slice(span.expressionStart, span.contentEnd);
  const relativeOffset = offset - span.expressionStart;

  for (const match of expression.matchAll(LATTE_FILTER_REFERENCE)) {
    const name = match[1];

    if (!name || match.index === undefined) {
      continue;
    }

    if (expression[match.index - 1] === "|") {
      continue;
    }

    const nameStart = match.index + match[0].lastIndexOf(name);
    const nameEnd = nameStart + name.length;

    if (relativeOffset < nameStart || relativeOffset > nameEnd) {
      continue;
    }

    const beforeName = expression.slice(0, nameStart);

    if (latteExpressionLexicalStateAtEnd(beforeName) !== "code") {
      continue;
    }

    return { name };
  }

  return null;
}

function latteMemberReferenceInSpan(
  source: string,
  offset: number,
  span: LatteDetectedExpressionSpan,
): LatteMemberReference | null {
  const expression = source.slice(span.expressionStart, span.contentEnd);
  const relativeOffset = offset - span.expressionStart;
  const before = expression.slice(0, Math.max(0, relativeOffset));

  if (latteExpressionLexicalStateAtEnd(before) !== "code") {
    return null;
  }

  const member = latteReceiverMemberReferenceAt(expression, relativeOffset);

  if (!member) {
    return null;
  }

  return {
    memberName: member.memberName,
    receiverExpression: member.receiverExpression,
    variableName: member.variableName,
  };
}

/**
 * True when `before` (an expression-tag slice ending at the cursor) has an
 * unterminated `'...'` / `"..."` literal, i.e. the cursor sits inside a string.
 * Delegates to the receiver parser's shared string/comment-aware lexer.
 */
export function hasUnclosedStringLiteral(before: string): boolean {
  return latteExpressionLexicalStateAtEnd(before) === "string";
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
  const member = latteReceiverMemberCompletionAt(before, before.length);

  if (!member) {
    return null;
  }

  return {
    end: offset,
    prefix: member.prefix,
    receiverExpression: member.receiverExpression,
    start: offset - before.length + member.memberSpan.start,
    variableName: member.variableName,
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
