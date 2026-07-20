import type { EditorPosition } from "./languageServerFeatures";

export interface IdentifierAtOffset {
  end: number;
  name: string;
  start: number;
}

export interface StringLiteralRange {
  quoteEnd: number;
  quoteStart: number;
}

export function offsetAtPosition(
  source: string,
  position: EditorPosition,
): number {
  let line = 1;
  let column = 1;

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

export function editorPositionAtOffset(
  source: string,
  offset: number,
): EditorPosition {
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

export function identifierAtOffset(
  source: string,
  offset: number,
): IdentifierAtOffset | null {
  for (const match of source.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;

    if (offset >= start && offset <= end) {
      return {
        end,
        name: match[0],
        start,
      };
    }
  }

  return null;
}

export function stringLiteralAtOffset(
  source: string,
  offset: number,
): { quoteEnd: number; quoteStart: number; value: string } | null {
  let quote: string | null = null;
  let quoteStart = -1;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character !== quote) {
        continue;
      }

      if (offset > quoteStart && offset < index) {
        return {
          quoteEnd: index,
          quoteStart,
          value: source.slice(quoteStart + 1, index),
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

  return null;
}

export function stringLiteralCompletionAtOffset(
  source: string,
  offset: number,
): { prefix: string; quoteEnd: number; quoteStart: number } | null {
  let quote: string | null = null;
  let quoteStart = -1;

  for (let index = 0; index < source.length && index < offset; index += 1) {
    const character = source[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
        quoteStart = -1;
      }

      continue;
    }

    if (character !== "'" && character !== "\"") {
      continue;
    }

    quote = character;
    quoteStart = index;
  }

  if (!quote || quoteStart < 0 || offset <= quoteStart) {
    return null;
  }

  return {
    prefix: source.slice(quoteStart + 1, offset),
    quoteEnd: closingQuoteOffset(source, offset, quote) ?? offset,
    quoteStart,
  };
}

function closingQuoteOffset(
  source: string,
  startOffset: number,
  quote: string,
): number | null {
  for (let index = startOffset; index < source.length; index += 1) {
    const character = source[index] || "";

    if (character === "\\" && quote !== "`") {
      index += 1;
      continue;
    }

    if (character === quote) {
      return index;
    }
  }

  return null;
}

export function matchingBracketOffset(
  source: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  let depth = 0;
  let quote: string | null = null;

  for (let index = openOffset; index < source.length; index += 1) {
    const character = source[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
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

export function topLevelArgumentIndexAtOffset(
  source: string,
  openParenOffset: number,
  targetOffset: number,
): number {
  let argumentIndex = 0;
  let depth = 0;
  let quote: string | null = null;

  for (
    let index = openParenOffset + 1;
    index < source.length && index < targetOffset;
    index += 1
  ) {
    const character = source[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
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
      argumentIndex += 1;
    }
  }

  return argumentIndex;
}

export function enclosingBracketStart(
  source: string,
  targetOffset: number,
  open: string,
  close: string,
): number | null {
  const stack: number[] = [];
  let quote: string | null = null;

  for (let index = 0; index < source.length && index < targetOffset; index += 1) {
    const character = source[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
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
      stack.push(index);
      continue;
    }

    if (character === close) {
      stack.pop();
    }
  }

  return stack.length > 0 ? stack[stack.length - 1] ?? null : null;
}

export function isTopLevelBetween(
  source: string,
  startOffset: number,
  targetOffset: number,
): boolean {
  let topLevel = true;

  scanTopLevel(source, startOffset, targetOffset, () => undefined, (depth) => {
    if (depth > 0) {
      topLevel = false;
    }
  });

  return topLevel;
}

export function isTopLevelWhitespaceBetween(
  source: string,
  startOffset: number,
  targetOffset: number,
): boolean {
  let whitespace = true;

  scanTopLevel(source, startOffset, targetOffset, (_index, character) => {
    if (!/\s/.test(character)) {
      whitespace = false;
    }
  });

  return whitespace && isTopLevelBetween(source, startOffset, targetOffset);
}

export function scanTopLevel(
  source: string,
  startOffset: number,
  endOffset: number,
  onTopLevelCharacter: (index: number, character: string) => void,
  onDepth?: (depth: number) => void,
): void {
  let depth = 0;
  let quote: string | null = null;

  for (
    let index = startOffset;
    index < source.length && index < endOffset;
    index += 1
  ) {
    const character = source[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
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
      onDepth?.(depth);
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      onDepth?.(depth);
      continue;
    }

    if (depth === 0) {
      onTopLevelCharacter(index, character);
    }
  }
}

export function topLevelCallArgumentIndexAt(
  source: string,
  openParen: number,
  closeParen: number,
  targetOffset: number,
): number | null {
  let argumentIndex = 0;
  let found: number | null = null;

  scanTopLevel(source, openParen + 1, closeParen, (index, character) => {
    if (found !== null) {
      return;
    }

    if (index >= targetOffset) {
      found = argumentIndex;
      return;
    }

    if (character === ",") {
      argumentIndex += 1;
    }
  });

  return found ?? argumentIndex;
}

export function topLevelCallArgumentNameAtOffset(
  source: string,
  openParen: number,
  closeParen: number | null,
  targetOffset: number,
): string | null {
  let argumentStart = openParen + 1;
  let foundStart: number | null = null;
  const endOffset = closeParen ?? targetOffset;

  scanTopLevel(source, openParen + 1, endOffset, (index, character) => {
    if (foundStart !== null) {
      return;
    }

    if (index >= targetOffset) {
      foundStart = argumentStart;
      return;
    }

    if (character === ",") {
      argumentStart = index + 1;
    }
  });

  const start = foundStart ?? argumentStart;
  const prefix = source.slice(start, targetOffset);
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*$/.exec(prefix);

  return match?.[1] ?? null;
}
