import {
  collectLatteMaskedRegions,
  LATTE_TAG_NAMES,
} from "./latteSyntax";

export interface LatteIncludeSourceSpan {
  end: number;
  start: number;
}

export interface LatteIncludeNamedArgument {
  name: string;
  nameSpan: LatteIncludeSourceSpan;
  value: string;
  valueSpan: LatteIncludeSourceSpan;
}

export interface LatteStaticFileInclude {
  arguments: LatteIncludeNamedArgument[];
  path: string;
  pathSpan: LatteIncludeSourceSpan;
}

interface LatteTagRange {
  contentEnd: number;
  expressionStart: number;
  isClosing: boolean;
  isValid: boolean;
  nextOffset: number;
  tagName: string | null;
}

interface Target {
  path: string;
  span: LatteIncludeSourceSpan;
  tokenEnd: number;
}

interface ScanState {
  delimiters: string[];
  index: number;
  isMalformed: boolean;
}

interface CommentRange {
  end: number;
  isClosed: boolean;
}

const LATTE_TAG_NAME_SET = new Set(LATTE_TAG_NAMES);
const IDENTIFIER_START = /[A-Za-z_]/;
const IDENTIFIER_PART = /[A-Za-z0-9_]/;
const STATIC_PATH = /^[A-Za-z0-9_./@-]+$/;

/** Collects static file includes and their named argument source ranges. */
export function latteStaticFileIncludes(
  source: string,
): LatteStaticFileInclude[] {
  const includes: LatteStaticFileInclude[] = [];
  const masks = collectLatteMaskedRegions(source);
  let maskIndex = 0;
  let index = 0;

  while (index < source.length) {
    const mask = masks[maskIndex];

    if (mask && index >= mask.end) {
      maskIndex += 1;
      continue;
    }

    if (mask && index >= mask.start) {
      index = Math.max(index + 1, mask.end);
      maskIndex += 1;
      continue;
    }

    if (source[index] !== "{" || isEscaped(source, index)) {
      index += 1;
      continue;
    }

    const tag = scanLatteTag(source, index);

    if (!tag) {
      index += 1;
      continue;
    }

    if (tag.isValid && !tag.isClosing && tag.tagName === "include") {
      const parsed = parseStaticInclude(
        source,
        tag.expressionStart,
        tag.contentEnd,
      );

      if (parsed) {
        includes.push(parsed);
      }
    }

    index = tag.nextOffset;
  }

  return includes;
}

function scanLatteTag(source: string, openBrace: number): LatteTagRange | null {
  const head = readLatteTagHead(source, openBrace);

  if (!head) {
    return null;
  }

  const range = scanTagContent(source, head.expressionStart);

  return {
    ...range,
    expressionStart: head.expressionStart,
    isClosing: head.isClosing,
    tagName: head.tagName,
  };
}

function readLatteTagHead(
  source: string,
  openBrace: number,
): {
  expressionStart: number;
  isClosing: boolean;
  tagName: string | null;
} | null {
  let index = openBrace + 1;
  let isClosing = false;

  if (source[index] === "/") {
    isClosing = true;
    index += 1;
  }

  if (!isClosing && (source[index] === "$" || source[index] === "=")) {
    const expressionStart =
      source[index] === "="
        ? skipWhitespace(source, index + 1, source.length)
        : index;

    return { expressionStart, isClosing: false, tagName: null };
  }

  if (!IDENTIFIER_START.test(source[index] ?? "")) {
    return null;
  }

  const nameStart = index;
  index += 1;

  while (IDENTIFIER_PART.test(source[index] ?? "")) {
    index += 1;
  }

  const tagName = source.slice(nameStart, index);

  if (!LATTE_TAG_NAME_SET.has(tagName)) {
    return null;
  }

  const next = source[index] ?? "";

  if (next !== "}" && !isWhitespace(next)) {
    return null;
  }

  return {
    expressionStart: skipWhitespace(source, index, source.length),
    isClosing,
    tagName,
  };
}

function scanTagContent(source: string, from: number): Omit<
  LatteTagRange,
  "expressionStart" | "isClosing" | "tagName"
> {
  const state: ScanState = { delimiters: [], index: from, isMalformed: false };

  while (state.index < source.length) {
    const char = source[state.index] ?? "";

    if (char === "\n") {
      return {
        contentEnd: state.index,
        isValid: false,
        nextOffset: state.index + 1,
      };
    }

    if (char === "'" || char === '"') {
      const quoteEnd = tagQuotedEnd(source, state.index);

      if (quoteEnd === null) {
        return failedTagLineRange(source, state.index + 1);
      }

      state.index = quoteEnd + 1;
      continue;
    }

    const comment = phpCommentRange(source, state.index, source.length);

    if (comment) {
      if (!comment.isClosed) {
        return failedTagLineRange(source, state.index + 2);
      }

      const commentNewline = source.indexOf("\n", state.index);

      if (commentNewline >= 0 && commentNewline < comment.end) {
        return {
          contentEnd: commentNewline,
          isValid: false,
          nextOffset: comment.end,
        };
      }

      state.index = comment.end;
      continue;
    }

    if (char === "{" && state.delimiters.length > 0) {
      const nestedTag = readLatteTagHead(source, state.index);

      if (nestedTag) {
        state.isMalformed = true;
      }
    }

    if (char === "(" || char === "[" || char === "{") {
      state.delimiters.push(closingDelimiter(char));
      state.index += 1;
      continue;
    }

    if (char === ")" || char === "]") {
      const expected = state.delimiters.pop();

      if (expected !== char) {
        state.isMalformed = true;
      }

      state.index += 1;
      continue;
    }

    if (char === "}") {
      const expected = state.delimiters[state.delimiters.length - 1];

      if (!expected) {
        return {
          contentEnd: state.index,
          isValid: !state.isMalformed,
          nextOffset: state.index + 1,
        };
      }

      if (expected !== "}") {
        return {
          contentEnd: state.index,
          isValid: false,
          nextOffset: state.index + 1,
        };
      }

      state.delimiters.pop();
      state.index += 1;
      continue;
    }

    state.index += 1;
  }

  return {
    contentEnd: source.length,
    isValid: false,
    nextOffset: source.length,
  };
}

function tagQuotedEnd(source: string, start: number): number | null {
  const quote = source[start];
  let index = start + 1;

  while (index < source.length) {
    if (source[index] === "\n") {
      return null;
    }

    if (source[index] === "\\") {
      index += 2;
      continue;
    }

    if (source[index] === quote) {
      return index;
    }

    index += 1;
  }

  return null;
}

function failedTagLineRange(source: string, from: number): {
  contentEnd: number;
  isValid: false;
  nextOffset: number;
} {
  const newline = source.indexOf("\n", from);

  if (newline < 0) {
    return {
      contentEnd: source.length,
      isValid: false,
      nextOffset: source.length,
    };
  }

  return { contentEnd: newline, isValid: false, nextOffset: newline + 1 };
}

function parseStaticInclude(
  source: string,
  from: number,
  limit: number,
): LatteStaticFileInclude | null {
  const targetStart = skipTrivia(source, from, limit);
  const target = readStaticTarget(source, targetStart, limit);

  if (!target) {
    return null;
  }

  const filterStart = topLevelFilterStart(source, target.tokenEnd, limit);
  const argumentsLimit = filterStart ?? limit;
  const argumentsStart = skipTrivia(source, target.tokenEnd, argumentsLimit);
  const argumentsResult = parseNamedArguments(
    source,
    argumentsStart,
    argumentsLimit,
  );

  if (!argumentsResult.validTail) {
    return null;
  }

  return {
    arguments: argumentsResult.arguments,
    path: target.path,
    pathSpan: target.span,
  };
}

function readStaticTarget(
  source: string,
  start: number,
  limit: number,
): Target | null {
  const quote = source[start];

  if (quote === "'" || quote === '"') {
    const end = quotedEnd(source, start, limit);

    if (end === null) {
      return null;
    }

    const path = source.slice(start + 1, end);

    if (!isStaticPath(path)) {
      return null;
    }

    return {
      path,
      span: { end, start: start + 1 },
      tokenEnd: end + 1,
    };
  }

  let end = start;

  while (end < limit && isPathCharacter(source[end] ?? "")) {
    end += 1;
  }

  const path = source.slice(start, end);

  if (!isStaticPath(path) || !looksLikeFilePath(path)) {
    return null;
  }

  return { path, span: { end, start }, tokenEnd: end };
}

function parseNamedArguments(
  source: string,
  from: number,
  limit: number,
): { arguments: LatteIncludeNamedArgument[]; validTail: boolean } {
  const args: LatteIncludeNamedArgument[] = [];
  let index = from;

  if (index >= limit) {
    return { arguments: args, validTail: true };
  }

  if (source[index] === ",") {
    index += 1;
  }

  while (index < limit) {
    index = skipTrivia(source, index, limit);

    if (index >= limit) {
      return { arguments: args, validTail: true };
    }

    const segmentEnd = topLevelComma(source, index, limit) ?? limit;
    const argument = parseNamedArgument(source, index, segmentEnd);

    if (argument) {
      args.push(argument);
    }

    if (!argument && !looksLikeMalformedNamedArgument(source, index)) {
      return { arguments: [], validTail: false };
    }

    if (segmentEnd === limit) {
      return { arguments: args, validTail: true };
    }

    index = segmentEnd + 1;
  }

  return { arguments: args, validTail: true };
}

function parseNamedArgument(
  source: string,
  from: number,
  limit: number,
): LatteIncludeNamedArgument | null {
  const nameToken = readArgumentName(
    source,
    skipTrivia(source, from, limit),
    limit,
  );

  if (!nameToken) {
    return null;
  }

  const operatorStart = skipTrivia(source, nameToken.tokenEnd, limit);
  const operatorLength = source.startsWith("=>", operatorStart)
    ? 2
    : source[operatorStart] === ":"
      ? 1
      : 0;

  if (operatorLength === 0) {
    return null;
  }

  const valueStart = skipTrivia(source, operatorStart + operatorLength, limit);
  const valueEnd = trimWhitespaceEnd(source, valueStart, limit);

  if (valueStart >= valueEnd) {
    return null;
  }

  return {
    name: nameToken.name,
    nameSpan: nameToken.span,
    value: source.slice(valueStart, valueEnd),
    valueSpan: { end: valueEnd, start: valueStart },
  };
}

function readArgumentName(
  source: string,
  start: number,
  limit: number,
): { name: string; span: LatteIncludeSourceSpan; tokenEnd: number } | null {
  const quote = source[start];

  if (quote === "'" || quote === '"') {
    const end = quotedEnd(source, start, limit);

    if (end === null) {
      return null;
    }

    const name = source.slice(start + 1, end);

    if (!isIdentifier(name)) {
      return null;
    }

    return { name, span: { end, start: start + 1 }, tokenEnd: end + 1 };
  }

  if (!IDENTIFIER_START.test(source[start] ?? "")) {
    return null;
  }

  let end = start + 1;

  while (end < limit && IDENTIFIER_PART.test(source[end] ?? "")) {
    end += 1;
  }

  return {
    name: source.slice(start, end),
    span: { end, start },
    tokenEnd: end,
  };
}

function topLevelComma(source: string, from: number, limit: number): number | null {
  return topLevelToken(source, from, limit, (char) => char === ",");
}

function topLevelFilterStart(
  source: string,
  from: number,
  limit: number,
): number | null {
  return topLevelToken(source, from, limit, (_char, index) => {
    if (source[index] !== "|" || source[index + 1] === "|") {
      return false;
    }

    const filterNameStart = skipWhitespace(source, index + 1, limit);

    return IDENTIFIER_START.test(source[filterNameStart] ?? "");
  });
}

function topLevelToken(
  source: string,
  from: number,
  limit: number,
  matches: (char: string, index: number) => boolean,
): number | null {
  const delimiters: string[] = [];
  let index = from;

  while (index < limit) {
    const char = source[index] ?? "";

    if (char === "'" || char === '"') {
      const end = quotedEnd(source, index, limit);

      if (end === null) {
        return null;
      }

      index = end + 1;
      continue;
    }

    const comment = phpCommentRange(source, index, limit);

    if (comment) {
      index = comment.end;
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      delimiters.push(closingDelimiter(char));
      index += 1;
      continue;
    }

    if (char === ")" || char === "]" || char === "}") {
      delimiters.pop();
      index += 1;
      continue;
    }

    if (delimiters.length === 0 && matches(char, index)) {
      return index;
    }

    index += 1;
  }

  return null;
}

function skipTrivia(source: string, from: number, limit: number): number {
  let index = from;

  while (index < limit) {
    if (isWhitespace(source[index] ?? "")) {
      index += 1;
      continue;
    }

    const comment = phpCommentRange(source, index, limit);

    if (!comment) {
      return index;
    }

    index = comment.end;
  }

  return index;
}

function phpCommentRange(
  source: string,
  start: number,
  limit: number,
): CommentRange | null {
  if (source.startsWith("/*", start)) {
    const close = source.indexOf("*/", start + 2);
    const isClosed = close >= 0 && close + 2 <= limit;

    return { end: isClosed ? close + 2 : limit, isClosed };
  }

  if (!source.startsWith("//", start) && source[start] !== "#") {
    return null;
  }

  const newline = source.indexOf("\n", start + 1);

  return {
    end: newline < 0 || newline > limit ? limit : newline + 1,
    isClosed: true,
  };
}

function quotedEnd(source: string, start: number, limit: number): number | null {
  const quote = source[start];
  let index = start + 1;

  while (index < limit) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }

    if (source[index] === quote) {
      return index;
    }

    index += 1;
  }

  return null;
}

function skipWhitespace(source: string, from: number, limit: number): number {
  let index = from;

  while (index < limit && isWhitespace(source[index] ?? "")) {
    index += 1;
  }

  return index;
}

function trimWhitespaceEnd(source: string, start: number, end: number): number {
  let index = end;

  while (index > start && isWhitespace(source[index - 1] ?? "")) {
    index -= 1;
  }

  return index;
}

function closingDelimiter(open: string): string {
  if (open === "(") {
    return ")";
  }

  if (open === "[") {
    return "]";
  }

  return "}";
}

function looksLikeMalformedNamedArgument(source: string, start: number): boolean {
  return IDENTIFIER_START.test(source[start] ?? "");
}

function isEscaped(source: string, index: number): boolean {
  let slashes = 0;
  let cursor = index - 1;

  while (cursor >= 0 && source[cursor] === "\\") {
    slashes += 1;
    cursor -= 1;
  }

  return slashes % 2 === 1;
}

function isStaticPath(path: string): boolean {
  return path.length > 0 && STATIC_PATH.test(path) && !path.includes("::");
}

function looksLikeFilePath(path: string): boolean {
  return path.endsWith(".latte") || path.includes("/") || path.startsWith("@");
}

function isPathCharacter(char: string): boolean {
  return /[A-Za-z0-9_./@-]/.test(char);
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\r" || char === "\n";
}
