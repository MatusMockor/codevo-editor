import {
  phpLaravelConfigKeysFromSource,
  phpLaravelConfigTargetFromSource,
  type PhpLaravelConfigSourceTarget,
} from "./phpLaravelConfig";
import type { EditorPosition } from "./languageServerFeatures";

export type PhpLaravelTranslationReferenceCall =
  | "__"
  | "Lang::choice"
  | "Lang::get"
  | "Lang::has"
  | "trans"
  | "trans_choice";

export interface PhpLaravelTranslationReferenceContext {
  call: PhpLaravelTranslationReferenceCall;
  key: string;
  position: EditorPosition;
  prefix: string;
}

export interface PhpLaravelTranslationTarget {
  key: string;
  path: string;
  position: EditorPosition;
  relativePath: string;
}

export type PhpLaravelTranslationSourceTarget = PhpLaravelConfigSourceTarget;

interface PhpStringLiteral {
  closed: boolean;
  quote: "'" | "\"";
  quoteEnd: number;
  quoteStart: number;
  value: string;
}

interface PhpArgumentContext {
  argumentIndex: number;
  argumentName: string | null;
  openParen: number;
}

interface ParsedJsonStringLiteral {
  endOffset: number;
  quoteStart: number;
  value: string;
}

export function phpLaravelTranslationReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelTranslationReferenceContext | null {
  const offset = offsetAtPosition(source, position);
  const literal = stringLiteralAtOffset(source, offset);

  if (!literal) {
    return null;
  }

  const prefix = source.slice(
    literal.quoteStart + 1,
    Math.min(offset, literal.quoteEnd),
  );
  const key = literal.closed ? literal.value : prefix;

  if (
    !isUsableLaravelTranslationReferencePrefix(prefix) ||
    !isUsableLaravelTranslationReferencePrefix(key)
  ) {
    return null;
  }

  const argument = argumentContextAt(source, literal);

  if (!argument || !isPhpCodeOffset(source, argument.openParen)) {
    return null;
  }

  const call = laravelTranslationReferenceCallAt(source, argument);

  if (!call) {
    return null;
  }

  return {
    call,
    key,
    position: editorPositionAtOffset(source, literal.quoteStart + 1),
    prefix,
  };
}

export function phpLaravelTranslationFileNameFromKey(
  translationKey: string,
): string | null {
  if (!isUsableLaravelTranslationArrayKey(translationKey)) {
    return null;
  }

  const [fileName] = translationKey.split(".");

  return fileName && isUsableLaravelTranslationSegment(fileName)
    ? fileName
    : null;
}

export function phpLaravelTranslationFileNameFromRelativePath(
  relativePath: string,
): string | null {
  const normalized = relativePath.split("\\").join("/").replace(/^\/+/, "");
  const match =
    /^(?:resources\/)?lang\/([^/]+)\/([^/]+)\.php$/.exec(normalized);
  const locale = match?.[1] ?? null;
  const fileName = match?.[2] ?? null;

  return locale &&
    isUsableLaravelTranslationLocale(locale) &&
    fileName &&
    isUsableLaravelTranslationSegment(fileName)
    ? fileName
    : null;
}

export function phpLaravelJsonTranslationLocaleFromRelativePath(
  relativePath: string,
): string | null {
  const normalized = relativePath.split("\\").join("/").replace(/^\/+/, "");
  const match = /^(?:resources\/)?lang\/([^/]+)\.json$/.exec(normalized);
  const locale = match?.[1] ?? null;

  return locale && isUsableLaravelTranslationLocale(locale) ? locale : null;
}

export function phpLaravelTranslationKeysFromSource(
  source: string,
  fileName: string,
): PhpLaravelTranslationSourceTarget[] {
  return phpLaravelConfigKeysFromSource(source, fileName);
}

export function phpLaravelTranslationTargetFromSource(
  source: string,
  fileName: string,
  translationKey: string,
): PhpLaravelTranslationSourceTarget | null {
  return phpLaravelConfigTargetFromSource(source, fileName, translationKey);
}

export function phpLaravelJsonTranslationKeysFromSource(
  source: string,
): PhpLaravelTranslationSourceTarget[] {
  const openOffset = source.indexOf("{");

  if (openOffset < 0) {
    return [];
  }

  const closeOffset = matchingJsonBracketOffset(source, openOffset, "{", "}");

  if (closeOffset === null) {
    return [];
  }

  const targets = new Map<string, PhpLaravelTranslationSourceTarget>();
  let index = openOffset + 1;

  while (index < closeOffset) {
    index = skipJsonWhitespace(source, index, closeOffset);

    if (index >= closeOffset) {
      break;
    }

    const key = parseJsonStringLiteralAt(source, index);

    if (!key) {
      return [];
    }

    index = skipJsonWhitespace(source, key.endOffset, closeOffset);

    if (source[index] !== ":") {
      return [];
    }

    if (isUsableLaravelTranslationJsonKey(key.value) && !targets.has(key.value)) {
      targets.set(key.value, {
        key: key.value,
        position: editorPositionAtOffset(source, key.quoteStart + 1),
      });
    }

    index = skipJsonValue(source, index + 1, closeOffset);

    if (index < 0) {
      return [];
    }

    index = skipJsonWhitespace(source, index, closeOffset);

    if (source[index] === ",") {
      index += 1;
      continue;
    }

    if (index < closeOffset) {
      return [];
    }
  }

  return Array.from(targets.values()).sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

export function phpLaravelJsonTranslationTargetFromSource(
  source: string,
  translationKey: string,
): PhpLaravelTranslationSourceTarget | null {
  return (
    phpLaravelJsonTranslationKeysFromSource(source).find(
      (target) => target.key === translationKey,
    ) ?? null
  );
}

export function phpLaravelTranslationCompletionInsertText(
  translationKey: string,
  prefix: string,
): string {
  const lastDotIndex = prefix.lastIndexOf(".");

  if (lastDotIndex < 0) {
    return translationKey;
  }

  return translationKey.slice(lastDotIndex + 1);
}

export function phpLaravelJsonTranslationCompletionInsertText(
  translationKey: string,
  prefix: string,
): string {
  const currentWordMatch = /[A-Za-z0-9_]*$/.exec(prefix);
  const currentWordStart =
    currentWordMatch?.index === undefined ? prefix.length : currentWordMatch.index;

  return translationKey.slice(currentWordStart);
}

export function isUsableLaravelTranslationKey(
  translationKey: string,
): boolean {
  return isUsableLaravelTranslationArrayKey(translationKey);
}

function isUsableLaravelTranslationArrayKey(
  translationKey: string,
): boolean {
  return (
    isUsableLaravelTranslationArrayKeyPrefix(translationKey) &&
    !translationKey.endsWith(".")
  );
}

function isUsableLaravelTranslationArrayKeyPrefix(translationKey: string): boolean {
  return (
    translationKey.length > 0 &&
    /^[A-Za-z0-9_.-]+$/.test(translationKey) &&
    !translationKey.startsWith(".") &&
    !translationKey.includes("..")
  );
}

function isUsableLaravelTranslationSegment(segment: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(segment);
}

export function isUsableLaravelTranslationLocale(locale: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(locale);
}

function isUsableLaravelTranslationReferencePrefix(
  translationKey: string,
): boolean {
  return (
    translationKey.length > 0 &&
    !translationKey.includes("::") &&
    !/[\r\n]/.test(translationKey)
  );
}

function isUsableLaravelTranslationJsonKey(translationKey: string): boolean {
  return (
    isUsableLaravelTranslationReferencePrefix(translationKey) &&
    !translationKey.trimStart().startsWith("{")
  );
}

function parseJsonStringLiteralAt(
  source: string,
  offset: number,
): ParsedJsonStringLiteral | null {
  if (source[offset] !== "\"") {
    return null;
  }

  for (let index = offset + 1; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (character === "\\") {
      index += 1;
      continue;
    }

    if (character !== "\"") {
      continue;
    }

    try {
      const value = JSON.parse(source.slice(offset, index + 1)) as unknown;

      if (typeof value !== "string") {
        return null;
      }

      return {
        endOffset: index + 1,
        quoteStart: offset,
        value,
      };
    } catch {
      return null;
    }
  }

  return null;
}

function skipJsonValue(source: string, offset: number, limit: number): number {
  let index = skipJsonWhitespace(source, offset, limit);

  if (index >= limit) {
    return -1;
  }

  const character = source[index] ?? "";

  if (character === "\"") {
    const literal = parseJsonStringLiteralAt(source, index);

    return literal?.endOffset ?? -1;
  }

  if (character === "{") {
    const closeOffset = matchingJsonBracketOffset(source, index, "{", "}");

    return closeOffset === null ? -1 : closeOffset + 1;
  }

  if (character === "[") {
    const closeOffset = matchingJsonBracketOffset(source, index, "[", "]");

    return closeOffset === null ? -1 : closeOffset + 1;
  }

  while (index < limit && !/[,\]}]/.test(source[index] ?? "")) {
    index += 1;
  }

  return index;
}

function matchingJsonBracketOffset(
  source: string,
  openOffset: number,
  open: "{" | "[",
  close: "}" | "]",
): number | null {
  let depth = 0;
  let quote = false;

  for (let index = openOffset; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === "\"") {
        quote = false;
      }

      continue;
    }

    if (character === "\"") {
      quote = true;
      continue;
    }

    if (character === open) {
      depth += 1;
      continue;
    }

    if (character !== close) {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
}

function skipJsonWhitespace(source: string, offset: number, limit: number): number {
  let index = offset;

  while (index < limit && /\s/.test(source[index] ?? "")) {
    index += 1;
  }

  return index;
}

function laravelTranslationReferenceCallAt(
  source: string,
  argument: PhpArgumentContext,
): PhpLaravelTranslationReferenceCall | null {
  if (!isFirstArgument(argument)) {
    return null;
  }

  const beforeCall = source.slice(0, argument.openParen);

  if (/\bLang\s*::\s*get\s*$/.test(beforeCall)) {
    return "Lang::get";
  }

  if (/\bLang\s*::\s*has\s*$/.test(beforeCall)) {
    return "Lang::has";
  }

  if (/\bLang\s*::\s*choice\s*$/.test(beforeCall)) {
    return "Lang::choice";
  }

  const functionMatch = /(?:^|[^A-Za-z0-9_>$:])([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
    beforeCall,
  );

  if (!functionMatch?.[1]) {
    return null;
  }

  const beforeFunction = beforeCall.slice(0, functionMatch.index);

  if (/(?:->|::)\s*$/.test(beforeFunction)) {
    return null;
  }

  const functionName = functionMatch[1];

  if (functionName === "__") {
    return "__";
  }

  if (functionName === "trans") {
    return "trans";
  }

  if (functionName === "trans_choice") {
    return "trans_choice";
  }

  return null;
}

function isFirstArgument(argument: PhpArgumentContext): boolean {
  return (
    argument.argumentIndex === 0 ||
    argument.argumentName?.toLowerCase() === "key"
  );
}

function argumentContextAt(
  source: string,
  literal: PhpStringLiteral,
): PhpArgumentContext | null {
  for (
    let openParen = source.lastIndexOf("(", literal.quoteStart);
    openParen >= 0;
    openParen = source.lastIndexOf("(", openParen - 1)
  ) {
    const closeParen = matchingBracketOffset(source, openParen, "(", ")");

    if (closeParen !== null && literal.quoteStart > closeParen) {
      continue;
    }

    const argumentIndex = topLevelArgumentIndexAtOffset(
      source,
      openParen,
      literal.quoteStart,
    );

    if (argumentIndex === null) {
      continue;
    }

    const argumentName = namedArgumentNameBeforeLiteral(
      source,
      openParen + 1,
      literal.quoteStart,
    );

    if (argumentName === undefined) {
      continue;
    }

    return { argumentIndex, argumentName, openParen };
  }

  return null;
}

function topLevelArgumentIndexAtOffset(
  source: string,
  openParenOffset: number,
  targetOffset: number,
): number | null {
  let argumentIndex = 0;
  let depth = 0;
  let quote: "'" | "\"" | null = null;

  for (let index = openParenOffset + 1; index < targetOffset; index += 1) {
    const character = source[index] ?? "";

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      if (depth === 0) {
        return null;
      }

      depth -= 1;
      continue;
    }

    if (character === "," && depth === 0) {
      argumentIndex += 1;
    }
  }

  return quote || depth !== 0 ? null : argumentIndex;
}

function namedArgumentNameBeforeLiteral(
  source: string,
  startOffset: number,
  literalStartOffset: number,
): string | null | undefined {
  const prefix = source.slice(startOffset, literalStartOffset);
  const lastComma = topLevelLastCommaOffset(prefix);
  const argumentPrefix = prefix.slice(lastComma + 1);

  if (/^\s*$/.test(argumentPrefix)) {
    return null;
  }

  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*$/.exec(argumentPrefix);

  return match?.[1] ?? undefined;
}

function topLevelLastCommaOffset(source: string): number {
  let depth = 0;
  let lastComma = -1;
  let quote: "'" | "\"" | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character === "," && depth === 0) {
      lastComma = index;
    }
  }

  return lastComma;
}

function stringLiteralAtOffset(
  source: string,
  offset: number,
): PhpStringLiteral | null {
  let quote: "'" | "\"" | null = null;
  let quoteStart = -1;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character !== quote) {
        continue;
      }

      if (offset > quoteStart && offset <= index) {
        const value = source.slice(quoteStart + 1, index);

        if (quote === "\"" && hasPhpVariableInterpolation(value)) {
          return null;
        }

        return {
          closed: true,
          quote,
          quoteEnd: index,
          quoteStart,
          value,
        };
      }

      quote = null;
      quoteStart = -1;
      continue;
    }

    if (character !== "'" && character !== "\"") {
      continue;
    }

    quote = character;
    quoteStart = index;
  }

  if (!quote || offset <= quoteStart) {
    return null;
  }

  const value = source.slice(quoteStart + 1);

  if (quote === "\"" && hasPhpVariableInterpolation(value)) {
    return null;
  }

  return {
    closed: false,
    quote,
    quoteEnd: source.length,
    quoteStart,
    value,
  };
}

function matchingBracketOffset(
  source: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  let blockComment = false;
  let depth = 0;
  let lineComment = false;
  let quote: "'" | "\"" | null = null;

  for (let index = openOffset; index < source.length; index += 1) {
    const character = source[index] ?? "";
    const nextCharacter = source[index + 1] ?? "";

    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
      }
      continue;
    }

    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (character === "#") {
      lineComment = true;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }

    if (character === open) {
      depth += 1;
      continue;
    }

    if (character !== close) {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
}

function isPhpCodeOffset(source: string, targetOffset: number): boolean {
  let blockComment = false;
  let lineComment = false;
  let quote: "'" | "\"" | null = null;

  for (
    let index = 0;
    index < source.length && index < targetOffset;
    index += 1
  ) {
    const character = source[index] ?? "";
    const nextCharacter = source[index + 1] ?? "";

    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
      }
      continue;
    }

    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (character === "#") {
      lineComment = true;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
    }
  }

  return !blockComment && !lineComment && !quote;
}

function hasPhpVariableInterpolation(value: string): boolean {
  return /(^|[^\\])\$\{?[A-Za-z_]/.test(value);
}

function offsetAtPosition(source: string, position: EditorPosition): number {
  let column = 1;
  let line = 1;

  for (let index = 0; index < source.length; index += 1) {
    if (line === position.lineNumber && column === position.column) {
      return index;
    }

    if (source[index] === "\n") {
      line += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return source.length;
}

function editorPositionAtOffset(
  source: string,
  targetOffset: number,
): EditorPosition {
  const offset = Math.max(0, Math.min(source.length, targetOffset));
  let lineNumber = 1;
  let lineStart = 0;

  for (let index = 0; index < offset; index += 1) {
    if (source[index] !== "\n") {
      continue;
    }

    lineNumber += 1;
    lineStart = index + 1;
  }

  return {
    column: offset - lineStart + 1,
    lineNumber,
  };
}
