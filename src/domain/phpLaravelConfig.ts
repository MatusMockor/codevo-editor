import type { EditorPosition } from "./languageServerFeatures";
import {
  phpStringAttributeArgumentContextAt,
  type PhpStringAttributeArgumentContext,
} from "./phpStringArgumentContext";

const laravelConfigRepositoryMethods = [
  "get",
  "has",
  "string",
  "integer",
  "float",
  "boolean",
  "array",
  "collection",
] as const;
const laravelConfigAttributeClass = "Illuminate\\Container\\Attributes\\Config";

type LaravelConfigRepositoryMethod =
  (typeof laravelConfigRepositoryMethods)[number];

export type PhpLaravelConfigReferenceCall =
  | "config"
  | "#[Config]"
  | `Config::${LaravelConfigRepositoryMethod}`
  | `config()->${LaravelConfigRepositoryMethod}`;

export interface PhpLaravelConfigReferenceContext {
  call: PhpLaravelConfigReferenceCall;
  key: string;
  position: EditorPosition;
  prefix: string;
}

export interface PhpLaravelConfigSourceTarget {
  key: string;
  position: EditorPosition;
}

export interface PhpLaravelConfigTarget extends PhpLaravelConfigSourceTarget {
  path: string;
  relativePath: string;
}

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

interface PhpArrayOpen {
  close: ")" | "]";
  contentStart: number;
  open: "(" | "[";
  openOffset: number;
}

interface ParsedPhpStringLiteral {
  endOffset: number;
  quoteStart: number;
  value: string;
}

const maxConfigDepth = 8;

export function phpLaravelConfigReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelConfigReferenceContext | null {
  const attributeContext = phpLaravelConfigAttributeReferenceContextAt(
    source,
    position,
  );

  if (attributeContext) {
    return attributeContext;
  }

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
    !isUsableLaravelConfigKeyPrefix(prefix) ||
    !isUsableLaravelConfigKeyPrefix(key)
  ) {
    return null;
  }

  const argument = argumentContextAt(source, literal);

  if (!argument || !isPhpCodeOffset(source, argument.openParen)) {
    return null;
  }

  const call = laravelConfigReferenceCallAt(source, argument);

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

function phpLaravelConfigAttributeReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelConfigReferenceContext | null {
  const argument = phpStringAttributeArgumentContextAt(source, position, [
    laravelConfigAttributeClass,
  ]);

  if (!argument || !isLaravelConfigAttributeKeyArgument(argument)) {
    return null;
  }

  const key = argument.closed ? argument.value : argument.prefix;

  if (
    !isUsableLaravelConfigKeyPrefix(argument.prefix) ||
    !isUsableLaravelConfigKeyPrefix(key)
  ) {
    return null;
  }

  return {
    call: "#[Config]",
    key,
    position: argument.position,
    prefix: argument.prefix,
  };
}

export function phpLaravelConfigKeyCandidateRelativePath(
  configKey: string,
): string | null {
  const fileName = phpLaravelConfigFileNameFromKey(configKey);

  return fileName ? `config/${fileName}.php` : null;
}

export function phpLaravelConfigFileNameFromRelativePath(
  relativePath: string,
): string | null {
  const normalized = relativePath.split("\\").join("/").replace(/^\/+/, "");
  const match = /^config\/([^/]+)\.php$/.exec(normalized);
  const fileName = match?.[1] ?? null;

  return fileName && isUsableLaravelConfigSegment(fileName) ? fileName : null;
}

export function phpLaravelConfigCompletionInsertText(
  configKey: string,
  prefix: string,
): string {
  const lastDotIndex = prefix.lastIndexOf(".");

  if (lastDotIndex < 0) {
    return configKey;
  }

  return configKey.slice(lastDotIndex + 1);
}

export function phpLaravelConfigKeysFromSource(
  source: string,
  fileName: string,
): PhpLaravelConfigSourceTarget[] {
  if (!isUsableLaravelConfigSegment(fileName)) {
    return [];
  }

  const arrayOpen = returnArrayOpenAt(source);

  if (!arrayOpen) {
    return [];
  }

  const targets: PhpLaravelConfigSourceTarget[] = [];
  scanPhpArrayConfigKeys(source, arrayOpen, [fileName], targets, 0);

  const unique = new Map<string, PhpLaravelConfigSourceTarget>();

  for (const target of targets) {
    const key = target.key.toLowerCase();

    if (!unique.has(key)) {
      unique.set(key, target);
    }
  }

  return Array.from(unique.values()).sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

export function phpLaravelConfigTargetFromSource(
  source: string,
  fileName: string,
  configKey: string,
): PhpLaravelConfigSourceTarget | null {
  if (configKey.toLowerCase() === fileName.toLowerCase()) {
    return {
      key: fileName,
      position: { column: 1, lineNumber: 1 },
    };
  }

  const normalizedKey = configKey.toLowerCase();

  return (
    phpLaravelConfigKeysFromSource(source, fileName).find(
      (target) => target.key.toLowerCase() === normalizedKey,
    ) ?? null
  );
}

export function isUsableLaravelConfigKey(configKey: string): boolean {
  return (
    isUsableLaravelConfigKeyPrefix(configKey) &&
    !configKey.endsWith(".")
  );
}

function isUsableLaravelConfigKeyPrefix(configKey: string): boolean {
  return (
    configKey.length > 0 &&
    /^[A-Za-z0-9_.-]+$/.test(configKey) &&
    !configKey.startsWith(".") &&
    !configKey.includes("..")
  );
}

function isUsableLaravelConfigSegment(segment: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(segment);
}

function phpLaravelConfigFileNameFromKey(configKey: string): string | null {
  if (!isUsableLaravelConfigKey(configKey)) {
    return null;
  }

  const [fileName] = configKey.split(".");

  return fileName && isUsableLaravelConfigSegment(fileName) ? fileName : null;
}

function laravelConfigReferenceCallAt(
  source: string,
  argument: PhpArgumentContext,
): PhpLaravelConfigReferenceCall | null {
  if (!isFirstArgument(argument)) {
    return null;
  }

  const beforeCall = source.slice(0, argument.openParen);
  const staticMethodMatch = /\bConfig\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
    beforeCall,
  );

  if (staticMethodMatch?.[1]) {
    const method = staticMethodMatch[1].toLowerCase();
    if (isLaravelConfigRepositoryMethod(method)) {
      return `Config::${method}`;
    }
  }

  const helperMethodMatch =
    /\bconfig\s*\(\s*\)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(beforeCall);

  if (helperMethodMatch?.[1]) {
    const method = helperMethodMatch[1].toLowerCase();
    if (isLaravelConfigRepositoryMethod(method)) {
      return `config()->${method}`;
    }
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

  return functionMatch[1].toLowerCase() === "config" ? "config" : null;
}

function isLaravelConfigRepositoryMethod(
  method: string,
): method is LaravelConfigRepositoryMethod {
  return (laravelConfigRepositoryMethods as readonly string[]).includes(method);
}

function isFirstArgument(argument: PhpArgumentContext): boolean {
  return (
    argument.argumentIndex === 0 ||
    argument.argumentName?.toLowerCase() === "key"
  );
}

function isLaravelConfigAttributeKeyArgument(
  argument: PhpStringAttributeArgumentContext,
): boolean {
  return argument.argumentName
    ? argument.argumentName.toLowerCase() === "key"
    : argument.argumentIndex === 0;
}

function returnArrayOpenAt(source: string): PhpArrayOpen | null {
  const returnPattern = /\breturn\b/g;
  let match: RegExpExecArray | null;

  while ((match = returnPattern.exec(source))) {
    const afterReturn = skipWhitespaceAndComments(
      source,
      match.index + match[0].length,
      source.length,
    );
    const arrayOpen = phpArrayOpenAt(source, afterReturn);

    if (arrayOpen) {
      return arrayOpen;
    }
  }

  return null;
}

function scanPhpArrayConfigKeys(
  source: string,
  arrayOpen: PhpArrayOpen,
  prefixSegments: string[],
  targets: PhpLaravelConfigSourceTarget[],
  depth: number,
): void {
  if (depth > maxConfigDepth) {
    return;
  }

  const closeOffset = matchingBracketOffset(
    source,
    arrayOpen.openOffset,
    arrayOpen.open,
    arrayOpen.close,
  );

  if (closeOffset === null) {
    return;
  }

  let index = arrayOpen.contentStart;

  while (index < closeOffset) {
    index = skipWhitespaceAndComments(source, index, closeOffset);

    if (index >= closeOffset) {
      break;
    }

    const parsedKey = parsePhpStringLiteralAt(source, index);

    if (!parsedKey) {
      index = nextTopLevelEntryStart(source, index, closeOffset);
      continue;
    }

    let afterKey = skipWhitespaceAndComments(
      source,
      parsedKey.endOffset,
      closeOffset,
    );

    if (source.slice(afterKey, afterKey + 2) !== "=>") {
      index = nextTopLevelEntryStart(source, parsedKey.endOffset, closeOffset);
      continue;
    }

    if (!isUsableLaravelConfigSegment(parsedKey.value)) {
      index = nextTopLevelEntryStart(source, afterKey + 2, closeOffset);
      continue;
    }

    const keySegments = [...prefixSegments, parsedKey.value];
    const key = keySegments.join(".");

    targets.push({
      key,
      position: editorPositionAtOffset(source, parsedKey.quoteStart + 1),
    });

    afterKey = skipWhitespaceAndComments(source, afterKey + 2, closeOffset);

    const nestedArray = phpArrayOpenAt(source, afterKey);

    if (nestedArray) {
      scanPhpArrayConfigKeys(source, nestedArray, keySegments, targets, depth + 1);
      const nestedCloseOffset = matchingBracketOffset(
        source,
        nestedArray.openOffset,
        nestedArray.open,
        nestedArray.close,
      );
      index = nextTopLevelEntryStart(
        source,
        nestedCloseOffset === null ? afterKey : nestedCloseOffset + 1,
        closeOffset,
      );
      continue;
    }

    index = nextTopLevelEntryStart(source, afterKey, closeOffset);
  }
}

function phpArrayOpenAt(source: string, offset: number): PhpArrayOpen | null {
  if (source[offset] === "[") {
    return {
      close: "]",
      contentStart: offset + 1,
      open: "[",
      openOffset: offset,
    };
  }

  const match = /^array\b\s*\(/i.exec(source.slice(offset));

  if (!match) {
    return null;
  }

  const openOffset = offset + match[0].lastIndexOf("(");

  return {
    close: ")",
    contentStart: openOffset + 1,
    open: "(",
    openOffset,
  };
}

function parsePhpStringLiteralAt(
  source: string,
  offset: number,
): ParsedPhpStringLiteral | null {
  const quote = source[offset];

  if (quote !== "'" && quote !== "\"") {
    return null;
  }

  for (let index = offset + 1; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (character === "\\") {
      index += 1;
      continue;
    }

    if (character !== quote) {
      continue;
    }

    const value = source.slice(offset + 1, index);

    if (quote === "\"" && hasPhpVariableInterpolation(value)) {
      return null;
    }

    return {
      endOffset: index + 1,
      quoteStart: offset,
      value,
    };
  }

  return null;
}

function nextTopLevelEntryStart(
  source: string,
  offset: number,
  closeOffset: number,
): number {
  let blockComment = false;
  let depth = 0;
  let lineComment = false;
  let quote: "'" | "\"" | null = null;

  for (let index = offset; index < closeOffset; index += 1) {
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

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character === "," && depth === 0) {
      return index + 1;
    }
  }

  return closeOffset;
}

function skipWhitespaceAndComments(
  source: string,
  offset: number,
  limit: number,
): number {
  let index = offset;

  while (index < limit) {
    const character = source[index] ?? "";
    const nextCharacter = source[index + 1] ?? "";

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      index += 2;

      while (index < limit && source[index] !== "\n") {
        index += 1;
      }

      continue;
    }

    if (character === "#") {
      index += 1;

      while (index < limit && source[index] !== "\n") {
        index += 1;
      }

      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      index += 2;

      while (
        index + 1 < limit &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) {
        index += 1;
      }

      index = Math.min(limit, index + 2);
      continue;
    }

    break;
  }

  return index;
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
