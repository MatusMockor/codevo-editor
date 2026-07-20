import type { EditorPosition } from "./languageServerFeatures";
import { resolvePhpClassName } from "./phpClassNameResolution";
import { isPhpCodeOffset } from "./phpLexicalContext";
export { isPhpCodeOffset } from "./phpLexicalContext";

export interface PhpStringArgumentContext {
  argumentIndex: number;
  argumentName: string | null;
  closed: boolean;
  openParen: number;
  position: EditorPosition;
  prefix: string;
  value: string;
}

export interface PhpStringArrayArgumentElementContext
  extends PhpStringArgumentContext {
  arrayElementIndex: number;
  arrayOpen: number;
}

export interface PhpStringArrayArgumentKeyContext
  extends PhpStringArgumentContext {
  arrayOpen: number;
}

export interface PhpStringAttributeArgumentContext
  extends PhpStringArgumentContext {
  attributeName: string;
  attributeShortName: string;
  resolvedAttributeName: string;
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

export function phpStringArgumentContextAt(
  source: string,
  position: EditorPosition,
): PhpStringArgumentContext | null {
  const offset = offsetAtPosition(source, position);
  const literal = stringLiteralAtOffset(source, offset);

  if (!literal) {
    return null;
  }

  const argument = argumentContextAt(source, literal);

  if (!argument || !isPhpCodeOffset(source, argument.openParen)) {
    return null;
  }

  return {
    ...argument,
    closed: literal.closed,
    position: editorPositionAtOffset(source, literal.quoteStart + 1),
    prefix: source.slice(
      literal.quoteStart + 1,
      Math.min(offset, literal.quoteEnd),
    ),
    value: literal.value,
  };
}

export function phpStringArrayArgumentElementContextAt(
  source: string,
  position: EditorPosition,
): PhpStringArrayArgumentElementContext | null {
  const offset = offsetAtPosition(source, position);
  const literal = stringLiteralAtOffset(source, offset);

  if (!literal) {
    return null;
  }

  const arrayOpen = enclosingShortArrayOpenAt(source, literal);

  if (arrayOpen === null) {
    return null;
  }

  const arrayClose = matchingBracketOffset(source, arrayOpen, "[", "]");

  if (arrayClose !== null && literal.quoteStart > arrayClose) {
    return null;
  }

  if (!isTopLevelBetween(source, arrayOpen + 1, literal.quoteStart)) {
    return null;
  }

  const arrayEnd = arrayClose ?? source.length;
  const arrayElementIndex = topLevelArgumentIndexAtOffset(
    source,
    arrayOpen,
    literal.quoteStart,
  );

  if (
    arrayElementIndex === null ||
    topLevelArrayStringLiteralRole(source, arrayOpen, arrayEnd, literal) !==
      "element"
  ) {
    return null;
  }

  const argument = arrayArgumentContextAt(source, arrayOpen);

  if (!argument || !isPhpCodeOffset(source, argument.openParen)) {
    return null;
  }

  return {
    ...argument,
    arrayElementIndex,
    arrayOpen,
    closed: literal.closed,
    position: editorPositionAtOffset(source, literal.quoteStart + 1),
    prefix: source.slice(
      literal.quoteStart + 1,
      Math.min(offset, literal.quoteEnd),
    ),
    value: literal.value,
  };
}

export function phpStringArrayArgumentKeyContextAt(
  source: string,
  position: EditorPosition,
): PhpStringArrayArgumentKeyContext | null {
  const offset = offsetAtPosition(source, position);
  const literal = stringLiteralAtOffset(source, offset);

  if (!literal) {
    return null;
  }

  const arrayOpen = enclosingShortArrayOpenAt(source, literal);

  if (arrayOpen === null) {
    return null;
  }

  const arrayClose = matchingBracketOffset(source, arrayOpen, "[", "]");

  if (arrayClose !== null && literal.quoteStart > arrayClose) {
    return null;
  }

  if (!isTopLevelBetween(source, arrayOpen + 1, literal.quoteStart)) {
    return null;
  }

  const arrayEnd = arrayClose ?? source.length;

  if (
    topLevelArrayStringLiteralRole(source, arrayOpen, arrayEnd, literal) !==
    "key"
  ) {
    return null;
  }

  const argument = arrayArgumentContextAt(source, arrayOpen);

  if (!argument || !isPhpCodeOffset(source, argument.openParen)) {
    return null;
  }

  return {
    ...argument,
    arrayOpen,
    closed: literal.closed,
    position: editorPositionAtOffset(source, literal.quoteStart + 1),
    prefix: source.slice(
      literal.quoteStart + 1,
      Math.min(offset, literal.quoteEnd),
    ),
    value: literal.value,
  };
}

export function phpStringAttributeArgumentContextAt(
  source: string,
  position: EditorPosition,
  attributeNames?: readonly string[],
): PhpStringAttributeArgumentContext | null {
  const argument = phpStringArgumentContextAt(source, position);

  if (!argument) {
    return null;
  }

  const attributeName = phpAttributeConstructorNameAt(
    source,
    argument.openParen,
  );
  const resolvedAttributeName = attributeName
    ? resolvePhpClassName(source, attributeName)
    : null;

  if (
    !attributeName ||
    !resolvedAttributeName ||
    (attributeNames?.length &&
      !attributeNames.some((expectedName) =>
        phpAttributeNameMatches(resolvedAttributeName, expectedName),
      ))
  ) {
    return null;
  }

  return {
    ...argument,
    attributeName,
    attributeShortName: phpShortAttributeName(attributeName),
    resolvedAttributeName,
  };
}

function phpAttributeConstructorNameAt(
  source: string,
  openParen: number,
): string | null {
  const beforeOpenParen = source.slice(0, openParen);
  const match =
    /\\?[A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)*\s*$/.exec(
      beforeOpenParen,
    );

  if (!match?.[0]) {
    return null;
  }

  const attributeName = match[0].trim();
  const attributeNameStart = openParen - match[0].length;
  const attributeOpen = enclosingPhpAttributeOpenAt(
    source,
    attributeNameStart,
    openParen,
  );

  if (attributeOpen === null) {
    return null;
  }

  return attributeName;
}

function enclosingPhpAttributeOpenAt(
  source: string,
  attributeNameStart: number,
  openParen: number,
): number | null {
  for (
    let attributeOpen = source.lastIndexOf("[", attributeNameStart);
    attributeOpen >= 0;
    attributeOpen = source.lastIndexOf("[", attributeOpen - 1)
  ) {
    if (source[attributeOpen - 1] !== "#") {
      continue;
    }

    const attributeClose = matchingBracketOffset(
      source,
      attributeOpen,
      "[",
      "]",
    );

    if (attributeClose !== null && openParen > attributeClose) {
      continue;
    }

    if (!isPhpCodeOffset(source, attributeOpen - 1)) {
      continue;
    }

    if (
      topLevelArgumentIndexAtOffset(source, attributeOpen, openParen) === null ||
      !isTopLevelAttributeItemNameStart(
        source,
        attributeOpen,
        attributeNameStart,
      )
    ) {
      continue;
    }

    return attributeOpen;
  }

  return null;
}

function isTopLevelAttributeItemNameStart(
  source: string,
  attributeOpen: number,
  attributeNameStart: number,
): boolean {
  let itemStart = attributeOpen + 1;

  scanTopLevel(source, attributeOpen + 1, attributeNameStart, (index, character) => {
    if (character === ",") {
      itemStart = index + 1;
    }
  });

  return /^\s*$/.test(source.slice(itemStart, attributeNameStart));
}

function phpAttributeNameMatches(
  resolvedAttributeName: string,
  expectedName: string,
): boolean {
  const normalizedAttributeName = normalizePhpAttributeName(resolvedAttributeName);
  const normalizedExpectedName = normalizePhpAttributeName(expectedName);

  return expectedName.includes("\\")
    ? normalizedAttributeName === normalizedExpectedName
    : phpShortAttributeName(normalizedAttributeName) === normalizedExpectedName;
}

function normalizePhpAttributeName(attributeName: string): string {
  return attributeName.replace(/^\\+/, "").toLowerCase();
}

function phpShortAttributeName(attributeName: string): string {
  return attributeName.replace(/^\\+/, "").split("\\").pop() ?? attributeName;
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

function isDirectArrayArgumentValue(
  source: string,
  openParen: number,
  arrayOpen: number,
  argumentName: string | null,
): boolean {
  const argumentStart = previousTopLevelCallArgumentDelimiter(
    source,
    openParen,
    arrayOpen,
  );
  const beforeArray = source.slice(argumentStart, arrayOpen);

  if (!argumentName) {
    return /^\s*$/.test(beforeArray);
  }

  return new RegExp(
    `^\\s*${escapeRegExp(argumentName)}\\s*:\\s*$`,
    "i",
  ).test(beforeArray);
}

function previousTopLevelCallArgumentDelimiter(
  source: string,
  openParen: number,
  targetOffset: number,
): number {
  let delimiter = openParen + 1;

  scanTopLevel(source, openParen + 1, targetOffset, (index, character) => {
    if (character === ",") {
      delimiter = index + 1;
    }
  });

  return delimiter;
}

function arrayArgumentContextAt(
  source: string,
  arrayOpen: number,
): PhpArgumentContext | null {
  for (
    let openParen = source.lastIndexOf("(", arrayOpen);
    openParen >= 0;
    openParen = source.lastIndexOf("(", openParen - 1)
  ) {
    const closeParen = matchingBracketOffset(source, openParen, "(", ")");

    if (closeParen !== null && arrayOpen > closeParen) {
      continue;
    }

    const argumentIndex = topLevelArgumentIndexAtOffset(
      source,
      openParen,
      arrayOpen,
    );

    if (argumentIndex === null) {
      continue;
    }

    const argumentName = namedArgumentNameBeforeLiteral(
      source,
      openParen + 1,
      arrayOpen,
    );

    if (argumentName === undefined) {
      continue;
    }

    if (
      !isDirectArrayArgumentValue(source, openParen, arrayOpen, argumentName)
    ) {
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
      depth -= 1;

      if (depth < 0) {
        return null;
      }

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
  argumentStart: number,
  literalStart: number,
): string | null | undefined {
  let depth = 0;
  let quote: "'" | "\"" | null = null;
  let lastColon = -1;

  for (let index = argumentStart; index < literalStart; index += 1) {
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
      depth -= 1;

      if (depth < 0) {
        return undefined;
      }

      continue;
    }

    if (character === ":" && depth === 0) {
      if (source[index + 1] === ":") {
        index += 1;
        continue;
      }

      lastColon = index;
    }
  }

  if (quote || depth !== 0) {
    return undefined;
  }

  if (lastColon < 0) {
    return null;
  }

  const beforeColon = source.slice(argumentStart, lastColon);
  const match = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(beforeColon);

  return match?.[1] ?? undefined;
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

function hasPhpVariableInterpolation(value: string): boolean {
  return /(^|[^\\])\$(?:[A-Za-z_]|[{])/.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function enclosingShortArrayOpenAt(
  source: string,
  literal: PhpStringLiteral,
): number | null {
  for (
    let arrayOpen = source.lastIndexOf("[", literal.quoteStart);
    arrayOpen >= 0;
    arrayOpen = source.lastIndexOf("[", arrayOpen - 1)
  ) {
    const arrayClose = matchingBracketOffset(source, arrayOpen, "[", "]");

    if (arrayClose === null || literal.quoteStart <= arrayClose) {
      return arrayOpen;
    }
  }

  return null;
}

function isTopLevelBetween(
  source: string,
  startOffset: number,
  endOffset: number,
): boolean {
  return (
    topLevelArgumentIndexAtOffset(source, startOffset - 1, endOffset) !== null
  );
}

function topLevelArrayStringLiteralRole(
  source: string,
  arrayOpen: number,
  arrayEnd: number,
  literal: PhpStringLiteral,
): "element" | "key" | null {
  const itemStart = previousTopLevelArrayDelimiter(
    source,
    arrayOpen,
    literal.quoteStart,
  );
  const literalAfterOffset =
    literal.quoteEnd > literal.quoteStart
      ? literal.quoteEnd + 1
      : literal.quoteEnd;
  const itemEnd = nextTopLevelArrayDelimiter(
    source,
    literalAfterOffset,
    arrayEnd,
  );
  const beforeLiteral = source.slice(itemStart, literal.quoteStart);
  const afterLiteral = source.slice(literalAfterOffset, itemEnd);

  if (hasTopLevelDoubleArrow(beforeLiteral)) {
    return null;
  }

  if (hasTopLevelDoubleArrow(afterLiteral)) {
    return "key";
  }

  if (/^\s*$/.test(beforeLiteral) && /^\s*$/.test(afterLiteral)) {
    return "element";
  }

  return null;
}

function previousTopLevelArrayDelimiter(
  source: string,
  arrayOpen: number,
  targetOffset: number,
): number {
  let delimiter = arrayOpen + 1;

  scanTopLevel(source, arrayOpen + 1, targetOffset, (index, character) => {
    if (character === ",") {
      delimiter = index + 1;
    }
  });

  return delimiter;
}

function nextTopLevelArrayDelimiter(
  source: string,
  startOffset: number,
  arrayEnd: number,
): number {
  let delimiter = arrayEnd;

  scanTopLevel(source, startOffset, arrayEnd, (index, character) => {
    if (character === "," && delimiter === arrayEnd) {
      delimiter = index;
    }
  });

  return delimiter;
}

function hasTopLevelDoubleArrow(source: string): boolean {
  let found = false;

  scanTopLevel(source, 0, source.length, (index) => {
    if (source[index] === "=" && source[index + 1] === ">") {
      found = true;
      return false;
    }

    return true;
  });

  return found;
}

function scanTopLevel(
  source: string,
  startOffset: number,
  endOffset: number,
  visit: (index: number, character: string) => boolean | void,
): void {
  let depth = 0;
  let quote: "'" | "\"" | null = null;

  for (let index = startOffset; index < endOffset; index += 1) {
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
      depth -= 1;
      continue;
    }

    if (depth === 0 && visit(index, character) === false) {
      return;
    }
  }
}

function matchingBracketOffset(
  source: string,
  openOffset: number,
  open: "(" | "[" | "{",
  close: ")" | "]" | "}",
): number | null {
  let depth = 0;
  let quote: "'" | "\"" | null = null;

  for (let index = openOffset; index < source.length; index += 1) {
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

    if (character === open) {
      depth += 1;
      continue;
    }

    if (character === close) {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
}

function offsetAtPosition(source: string, position: EditorPosition): number {
  let lineNumber = 1;
  let column = 1;

  for (let index = 0; index < source.length; index += 1) {
    if (lineNumber === position.lineNumber && column === position.column) {
      return index;
    }

    if (source[index] === "\n") {
      lineNumber += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return source.length;
}

function editorPositionAtOffset(
  source: string,
  offset: number,
): EditorPosition {
  let lineNumber = 1;
  let column = 1;

  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { column, lineNumber };
}
