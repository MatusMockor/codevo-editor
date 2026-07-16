export interface LatteReceiverMemberCompletion {
  memberSpan: LatteReceiverExpressionSpan;
  prefix: string;
  receiverExpression: string;
  variableName: string;
}

export interface LatteReceiverMemberReference {
  memberName: string;
  memberSpan: LatteReceiverExpressionSpan;
  receiverExpression: string;
  variableName: string;
}

export interface LatteReceiverExpressionSpan {
  end: number;
  start: number;
}

export type LatteExpressionLexicalState = "code" | "comment" | "string";

const MAX_EXPRESSION_LENGTH = 2_000;
const MAX_NESTING_DEPTH = 16;
const MAX_POSTFIX_SEGMENTS = 64;
const MAX_ROOT_CANDIDATES = 64;

interface ParsedReceiverRoot {
  completion: LatteReceiverMemberCompletion | null;
  references: LatteReceiverMemberReference[];
}

interface BalancedEnd {
  end: number;
}

/**
 * Finds the innermost variable-root member chain ending at `offset`.
 * The returned member span is half-open and relative to `source`.
 */
export function latteReceiverMemberCompletionAt(
  source: string,
  offset: number,
): LatteReceiverMemberCompletion | null {
  const safeOffset = Math.max(0, Math.min(source.length, offset));
  const start = Math.max(0, safeOffset - MAX_EXPRESSION_LENGTH);
  const before = source.slice(start, safeOffset);
  const roots = parseReceiverRoots(before, false);

  for (let index = roots.length - 1; index >= 0; index -= 1) {
    const completion = roots[index]?.completion;

    if (!completion) {
      continue;
    }

    return shiftCompletion(completion, start);
  }

  return null;
}

/** Finds the innermost variable-root member whose half-open span contains `offset`. */
export function latteReceiverMemberReferenceAt(
  source: string,
  offset: number,
): LatteReceiverMemberReference | null {
  const safeOffset = Math.max(0, Math.min(source.length, offset));
  const start = Math.max(0, safeOffset - MAX_EXPRESSION_LENGTH);
  const end = Math.min(source.length, safeOffset + MAX_EXPRESSION_LENGTH);
  const window = source.slice(start, end);
  const relativeOffset = safeOffset - start;
  const roots = parseReceiverRoots(window, true);

  for (let rootIndex = roots.length - 1; rootIndex >= 0; rootIndex -= 1) {
    const references = roots[rootIndex]?.references ?? [];

    for (let index = references.length - 1; index >= 0; index -= 1) {
      const reference = references[index];

      if (!reference || !spanContains(reference.memberSpan, relativeOffset)) {
        continue;
      }

      return shiftReference(reference, start);
    }
  }

  return null;
}

export function latteExpressionLexicalStateAtEnd(
  source: string,
): LatteExpressionLexicalState {
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (char === "'" || char === '"') {
      const end = quotedStringEnd(source, index, char);

      if (end < 0) {
        return "string";
      }

      index = end;
      continue;
    }

    const commentEnd = commentTriviaEnd(source, index);

    if (commentEnd === index) {
      index += 1;
      continue;
    }

    if (commentEnd < 0) {
      return "comment";
    }

    index = commentEnd;
  }

  return "code";
}

function parseReceiverRoots(
  source: string,
  preserveCompletedReferences: boolean,
): ParsedReceiverRoot[] {
  const roots: ParsedReceiverRoot[] = [];
  const code = codeCharacterMap(source);
  let candidates = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (candidates >= MAX_ROOT_CANDIDATES) {
      break;
    }

    if (source[index] !== "$" || !code[index]) {
      continue;
    }

    if (!isVariableRootBoundary(source[index - 1])) {
      continue;
    }

    if (identifierEnd(source, index + 1) === index + 1) {
      continue;
    }

    candidates += 1;

    const root = parseReceiverRoot(
      source,
      index,
      enclosingClosingDelimitersAt(source, index),
      preserveCompletedReferences,
    );

    if (!root) {
      continue;
    }

    roots.push(root);
  }

  return roots;
}

function parseReceiverRoot(
  source: string,
  rootStart: number,
  enclosingClosings: readonly string[],
  preserveCompletedReferences: boolean,
): ParsedReceiverRoot | null {
  if (enclosingClosings.length > MAX_NESTING_DEPTH) {
    return null;
  }

  const nameStart = rootStart + 1;
  const nameEnd = identifierEnd(source, nameStart);

  if (nameEnd === nameStart) {
    return null;
  }

  const variableName = source.slice(nameStart, nameEnd);
  const references: LatteReceiverMemberReference[] = [];
  let completion: LatteReceiverMemberCompletion | null = null;
  let receiverExpression = `$${variableName}`;
  let cursor = nameEnd;
  let segments = 0;

  while (cursor < source.length) {
    if (cursor - rootStart > MAX_EXPRESSION_LENGTH) {
      return invalidReceiverRoot(references, preserveCompletedReferences);
    }

    const triviaEnd = skipTrivia(source, cursor);

    if (triviaEnd < 0) {
      return invalidReceiverRoot(references, preserveCompletedReferences);
    }

    if (source[triviaEnd] === "[") {
      const balanced = balancedPostfixEnd(source, triviaEnd);

      if (!balanced || segments >= MAX_POSTFIX_SEGMENTS) {
        return invalidReceiverRoot(references, preserveCompletedReferences);
      }

      if (balanced.end - rootStart > MAX_EXPRESSION_LENGTH) {
        return invalidReceiverRoot(references, preserveCompletedReferences);
      }

      receiverExpression += source.slice(triviaEnd, balanced.end);
      cursor = balanced.end;
      segments += 1;
      continue;
    }

    const operatorEnd = memberOperatorEnd(source, triviaEnd);

    if (operatorEnd < 0) {
      const closing = source[triviaEnd] ?? "";

      if (")]}".includes(closing) && !enclosingClosings.includes(closing)) {
        return invalidReceiverRoot(references, preserveCompletedReferences);
      }

      break;
    }

    if (segments >= MAX_POSTFIX_SEGMENTS) {
      return invalidReceiverRoot(references, preserveCompletedReferences);
    }

    const memberStart = skipTrivia(source, operatorEnd);

    if (memberStart < 0) {
      return invalidReceiverRoot(references, preserveCompletedReferences);
    }

    const memberEnd = identifierEnd(source, memberStart);

    if (memberEnd === memberStart) {
      if (memberStart !== source.length) {
        return invalidReceiverRoot(references, preserveCompletedReferences);
      }

      completion = {
        memberSpan: { end: memberStart, start: memberStart },
        prefix: "",
        receiverExpression,
        variableName,
      };
      break;
    }

    const memberName = source.slice(memberStart, memberEnd);
    const reference = {
      memberName,
      memberSpan: { end: memberEnd, start: memberStart },
      receiverExpression,
      variableName,
    };

    const afterName = skipTrivia(source, memberEnd);

    if (afterName < 0) {
      return invalidReceiverRoot(
        [...references, reference],
        preserveCompletedReferences,
      );
    }

    if (source[afterName] === "(") {
      const balanced = balancedPostfixEnd(source, afterName);

      if (!balanced) {
        return invalidReceiverRoot(references, preserveCompletedReferences);
      }

      if (balanced.end - rootStart > MAX_EXPRESSION_LENGTH) {
        return invalidReceiverRoot(references, preserveCompletedReferences);
      }

      receiverExpression += `->${memberName}${source.slice(afterName, balanced.end)}`;
      cursor = balanced.end;
    }

    if (source[afterName] !== "(") {
      receiverExpression += `->${memberName}`;
      cursor = memberEnd;
    }

    references.push(reference);
    segments += 1;

    if (memberEnd === source.length) {
      completion = {
        memberSpan: { end: memberEnd, start: memberStart },
        prefix: memberName,
        receiverExpression:
          references[references.length - 1]?.receiverExpression ?? "",
        variableName,
      };
    }
  }

  if (references.length === 0 && !completion) {
    return null;
  }

  return { completion, references };
}

function invalidReceiverRoot(
  references: LatteReceiverMemberReference[],
  preserveCompletedReferences: boolean,
): ParsedReceiverRoot | null {
  if (!preserveCompletedReferences || references.length === 0) {
    return null;
  }

  return { completion: null, references };
}

function enclosingClosingDelimitersAt(
  source: string,
  offset: number,
): string[] {
  const closings: string[] = [];
  let index = 0;

  while (index < offset) {
    const char = source[index];

    if (char === "'" || char === '"') {
      const end = quotedStringEnd(source, index, char);

      if (end < 0 || end > offset) {
        return closings;
      }

      index = end;
      continue;
    }

    const commentEnd = commentTriviaEnd(source, index);

    if (commentEnd !== index) {
      if (commentEnd < 0 || commentEnd > offset) {
        return closings;
      }

      index = commentEnd;
      continue;
    }

    const closing = closingDelimiter(char);

    if (closing) {
      closings.push(closing);
      index += 1;
      continue;
    }

    if (
      ")]}".includes(char ?? "") &&
      closings[closings.length - 1] === char
    ) {
      closings.pop();
    }

    index += 1;
  }

  return closings;
}

function balancedPostfixEnd(source: string, start: number): BalancedEnd | null {
  const opening = source[start];
  const closing = closingDelimiter(opening);

  if (!closing) {
    return null;
  }

  const delimiters: string[] = [closing];
  let index = start + 1;

  while (index < source.length) {
    const char = source[index];

    if (char === "'" || char === '"') {
      const stringEnd = quotedStringEnd(source, index, char);

      if (stringEnd < 0) {
        return null;
      }

      index = stringEnd;
      continue;
    }

    const commentEnd = commentTriviaEnd(source, index);

    if (commentEnd !== index) {
      if (commentEnd < 0) {
        return null;
      }

      index = commentEnd;
      continue;
    }

    const nestedClosing = closingDelimiter(char);

    if (nestedClosing) {
      if (delimiters.length >= MAX_NESTING_DEPTH) {
        return null;
      }

      delimiters.push(nestedClosing);
      index += 1;
      continue;
    }

    if (char !== ")" && char !== "]" && char !== "}") {
      index += 1;
      continue;
    }

    if (delimiters[delimiters.length - 1] !== char) {
      return null;
    }

    delimiters.pop();
    index += 1;

    if (delimiters.length === 0) {
      return { end: index };
    }
  }

  return null;
}

function codeCharacterMap(source: string): boolean[] {
  const code = Array.from({ length: source.length }, () => true);
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (char === "'" || char === '"') {
      const end = quotedStringEnd(source, index, char);
      const maskedEnd = end < 0 ? source.length : end;
      maskRange(code, index, maskedEnd);
      index = maskedEnd;
      continue;
    }

    const commentEnd = commentTriviaEnd(source, index);

    if (commentEnd === index) {
      index += 1;
      continue;
    }

    const maskedEnd = commentEnd < 0 ? source.length : commentEnd;
    maskRange(code, index, maskedEnd);
    index = maskedEnd;
  }

  return code;
}

function skipTrivia(source: string, start: number): number {
  let index = start;

  while (index < source.length) {
    if (/\s/.test(source[index] ?? "")) {
      index += 1;
      continue;
    }

    const commentEnd = commentTriviaEnd(source, index);

    if (commentEnd === index) {
      break;
    }

    if (commentEnd < 0) {
      return -1;
    }

    index = commentEnd;
  }

  return index;
}

function commentTriviaEnd(source: string, start: number): number {
  if (source.startsWith("/*", start)) {
    const end = source.indexOf("*/", start + 2);
    return end < 0 ? -1 : end + 2;
  }

  if (source.startsWith("//", start) || source[start] === "#") {
    const end = source.indexOf("\n", start + 1);
    return end < 0 ? -1 : end + 1;
  }

  return start;
}

function quotedStringEnd(
  source: string,
  start: number,
  quote: string,
): number {
  let index = start + 1;

  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }

    if (source[index] === quote) {
      return index + 1;
    }

    index += 1;
  }

  return -1;
}

function identifierEnd(source: string, start: number): number {
  if (!/[A-Za-z_]/.test(source[start] ?? "")) {
    return start;
  }

  let end = start + 1;

  while (/[A-Za-z0-9_]/.test(source[end] ?? "")) {
    end += 1;
  }

  return end;
}

function memberOperatorEnd(source: string, start: number): number {
  if (source.startsWith("?->", start)) {
    return start + 3;
  }

  if (source.startsWith("->", start)) {
    return start + 2;
  }

  return -1;
}

function closingDelimiter(opening: string | undefined): string | null {
  if (opening === "(") {
    return ")";
  }

  if (opening === "[") {
    return "]";
  }

  if (opening === "{") {
    return "}";
  }

  return null;
}

function isVariableRootBoundary(previous: string | undefined): boolean {
  return !previous || !/[A-Za-z0-9_$\\>:]/.test(previous);
}

function spanContains(span: LatteReceiverExpressionSpan, offset: number): boolean {
  return offset >= span.start && offset < span.end;
}

function maskRange(values: boolean[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    values[index] = false;
  }
}

function shiftCompletion(
  completion: LatteReceiverMemberCompletion,
  amount: number,
): LatteReceiverMemberCompletion {
  return {
    ...completion,
    memberSpan: shiftSpan(completion.memberSpan, amount),
  };
}

function shiftReference(
  reference: LatteReceiverMemberReference,
  amount: number,
): LatteReceiverMemberReference {
  return {
    ...reference,
    memberSpan: shiftSpan(reference.memberSpan, amount),
  };
}

function shiftSpan(
  span: LatteReceiverExpressionSpan,
  amount: number,
): LatteReceiverExpressionSpan {
  return { end: span.end + amount, start: span.start + amount };
}
