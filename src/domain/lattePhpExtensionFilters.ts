import { maskPhpSource } from "./phpSourceMask";

export interface LattePhpExtensionFilter {
  name: string;
  offset: number;
}

interface ArrayReturnRange {
  end: number;
  start: number;
}

const GET_FILTERS_METHOD_PATTERN = /\bfunction\s+getFilters\s*\(/g;

export function lattePhpExtensionFiltersFromSource(
  source: string,
): LattePhpExtensionFilter[] {
  const masked = maskPhpSource(source);
  const filters: LattePhpExtensionFilter[] = [];

  for (
    let match = GET_FILTERS_METHOD_PATTERN.exec(masked);
    match;
    match = GET_FILTERS_METHOD_PATTERN.exec(masked)
  ) {
    const methodBody = getFiltersMethodBody(masked, match.index);

    if (!methodBody) {
      continue;
    }

    const returnedArray = staticArrayReturnRange(masked, methodBody);

    if (!returnedArray) {
      continue;
    }

    filters.push(...stringKeyFiltersFromArray(source, masked, returnedArray));
  }

  return filters;
}

function getFiltersMethodBody(
  masked: string,
  functionOffset: number,
): { end: number; start: number } | null {
  const openParen = masked.indexOf("(", functionOffset);

  if (openParen < 0) {
    return null;
  }

  const closeParen = matchingPair(masked, openParen, "(", ")");

  if (closeParen === null) {
    return null;
  }

  const bodyStart = nextBraceOrSemicolon(masked, closeParen + 1);

  if (bodyStart === null || masked[bodyStart] !== "{") {
    return null;
  }

  const signatureTail = masked.slice(closeParen + 1, bodyStart);

  if (!/:\s*array\b/i.test(signatureTail)) {
    return null;
  }

  const bodyEnd = matchingPair(masked, bodyStart, "{", "}");

  if (bodyEnd === null) {
    return null;
  }

  return { end: bodyEnd, start: bodyStart + 1 };
}

function staticArrayReturnRange(
  masked: string,
  methodBody: { end: number; start: number },
): ArrayReturnRange | null {
  let squareDepth = 0;
  let parenDepth = 0;
  let braceDepth = 0;

  for (let index = methodBody.start; index < methodBody.end; index += 1) {
    const character = masked[index] ?? "";

    if (character === "{") {
      braceDepth += 1;
      continue;
    }

    if (character === "}") {
      braceDepth -= 1;
      continue;
    }

    if (character === "[") {
      squareDepth += 1;
      continue;
    }

    if (character === "]") {
      squareDepth -= 1;
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
      continue;
    }

    if (character === ")") {
      parenDepth -= 1;
      continue;
    }

    if (braceDepth > 0 || squareDepth > 0 || parenDepth > 0) {
      continue;
    }

    if (!keywordAt(masked, index, "return")) {
      continue;
    }

    const arrayStart = skipSpaces(masked, index + "return".length);

    if (masked[arrayStart] === "[") {
      const arrayEnd = matchingPair(masked, arrayStart, "[", "]");

      return arrayEnd === null
        ? null
        : { end: arrayEnd, start: arrayStart + 1 };
    }

    if (keywordAt(masked, arrayStart, "array")) {
      const openParen = skipSpaces(masked, arrayStart + "array".length);

      if (masked[openParen] !== "(") {
        return null;
      }

      const closeParen = matchingPair(masked, openParen, "(", ")");

      return closeParen === null
        ? null
        : { end: closeParen, start: openParen + 1 };
    }

    return null;
  }

  return null;
}

function stringKeyFiltersFromArray(
  source: string,
  masked: string,
  range: ArrayReturnRange,
): LattePhpExtensionFilter[] {
  const filters: LattePhpExtensionFilter[] = [];
  let squareDepth = 0;
  let parenDepth = 0;
  let braceDepth = 0;

  for (let index = range.start; index < range.end; index += 1) {
    const character = masked[index] ?? "";

    if (character === "{") {
      braceDepth += 1;
      continue;
    }

    if (character === "}") {
      braceDepth -= 1;
      continue;
    }

    if (character === "[") {
      squareDepth += 1;
      continue;
    }

    if (character === "]") {
      squareDepth -= 1;
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
      continue;
    }

    if (character === ")") {
      parenDepth -= 1;
      continue;
    }

    if (braceDepth > 0 || squareDepth > 0 || parenDepth > 0) {
      continue;
    }

    const quote = source[index] ?? "";

    if (quote !== "'" && quote !== '"') {
      continue;
    }

    const literal = stringLiteralAt(source, index, quote);

    if (!literal) {
      continue;
    }

    const arrowOffset = skipInlineSpaces(masked, literal.end + 1);

    if (masked.slice(arrowOffset, arrowOffset + 2) !== "=>") {
      index = literal.end;
      continue;
    }

    if (literal.name.length === 0) {
      index = literal.end;
      continue;
    }

    filters.push({ name: literal.name, offset: index + 1 });
    index = literal.end;
  }

  return filters;
}

function stringLiteralAt(
  source: string,
  quoteOffset: number,
  quote: string,
): { end: number; name: string } | null {
  let name = "";

  for (let index = quoteOffset + 1; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (character === "\n" || character === "\r") {
      return null;
    }

    if (character === "\\") {
      const next = source[index + 1];

      if (next === undefined) {
        return null;
      }

      name += next;
      index += 1;
      continue;
    }

    if (character === quote) {
      return { end: index, name };
    }

    name += character;
  }

  return null;
}

function nextBraceOrSemicolon(masked: string, start: number): number | null {
  for (let index = start; index < masked.length; index += 1) {
    const character = masked[index] ?? "";

    if (character === "{" || character === ";") {
      return index;
    }
  }

  return null;
}

function matchingPair(
  masked: string,
  openIndex: number,
  open: string,
  close: string,
): number | null {
  if (openIndex < 0 || masked[openIndex] !== open) {
    return null;
  }

  let depth = 0;

  for (let index = openIndex; index < masked.length; index += 1) {
    const character = masked[index] ?? "";

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

function keywordAt(source: string, offset: number, keyword: string): boolean {
  if (source.slice(offset, offset + keyword.length) !== keyword) {
    return false;
  }

  return (
    !isIdentifierCharacter(source[offset - 1]) &&
    !isIdentifierCharacter(source[offset + keyword.length])
  );
}

function skipSpaces(source: string, start: number): number {
  let index = start;

  while (/\s/.test(source[index] ?? "")) {
    index += 1;
  }

  return index;
}

function skipInlineSpaces(source: string, start: number): number {
  let index = start;

  while (source[index] === " " || source[index] === "\t") {
    index += 1;
  }

  return index;
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/.test(character);
}
