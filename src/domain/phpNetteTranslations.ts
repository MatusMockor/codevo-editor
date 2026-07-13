import type { EditorPosition } from "./languageServerFeatures";

export interface PhpNetteTranslationReferenceContext {
  call: "translate";
  key: string;
  position: EditorPosition;
  prefix: string;
}

interface PhpStringLiteral {
  closed: boolean;
  quoteEnd: number;
  quoteStart: number;
  value: string;
}

export function phpNetteTranslationReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpNetteTranslationReferenceContext | null {
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

  if (!isUsableNetteTranslationReferenceKey(prefix)) {
    return null;
  }

  if (!isUsableNetteTranslationReferenceKey(key)) {
    return null;
  }

  const openParen = source.lastIndexOf("(", literal.quoteStart);

  if (openParen < 0 || !isFirstArgument(source, openParen, literal.quoteStart)) {
    return null;
  }

  if (!isPhpCodeOffset(source, openParen)) {
    return null;
  }

  if (!isNetteTranslatorCall(source.slice(0, openParen))) {
    return null;
  }

  return {
    call: "translate",
    key,
    position: editorPositionAtOffset(source, literal.quoteStart + 1),
    prefix,
  };
}

function isNetteTranslatorCall(beforeParen: string): boolean {
  return /(?:\$translator|(?:->|\?->)\s*translator)\s*(?:->|\?->)\s*translate\s*$/.test(
    beforeParen,
  );
}

function isFirstArgument(
  source: string,
  openParen: number,
  literalStart: number,
): boolean {
  let depth = 0;
  let quote: "'" | "\"" | null = null;

  for (let index = openParen + 1; index < literalStart; index += 1) {
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
        return false;
      }

      depth -= 1;
      continue;
    }

    if (character === "," && depth === 0) {
      return false;
    }
  }

  return !quote && depth === 0;
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
    quoteEnd: source.length,
    quoteStart,
    value,
  };
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

function isUsableNetteTranslationReferenceKey(key: string): boolean {
  return /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)*$/.test(key);
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
