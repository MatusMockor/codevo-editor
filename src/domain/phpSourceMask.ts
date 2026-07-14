const MASK_MEMO_CAPACITY = 4;

export function memoizePhpMask(
  mask: (source: string) => string,
  capacity: number = MASK_MEMO_CAPACITY,
): (source: string) => string {
  const memo = new Map<string, string>();

  return (source: string): string => {
    const cached = memo.get(source);

    if (cached !== undefined) {
      memo.delete(source);
      memo.set(source, cached);
      return cached;
    }

    const masked = mask(source);

    if (memo.size >= capacity) {
      const oldest = memo.keys().next().value;

      if (oldest !== undefined) {
        memo.delete(oldest);
      }
    }

    memo.set(source, masked);
    return masked;
  };
}

/**
 * Masks PHP strings, comments, heredocs/nowdocs, and attributes while preserving
 * source length and newlines. Structural scanners can then reason about braces
 * and tokens without being confused by literal content.
 */
export const maskPhpSource: (source: string) => string = memoizePhpMask(
  maskPhpSourceUncached,
);

function maskPhpSourceUncached(source: string): string {
  let output = "";
  let quote: string | null = null;
  let attributeInBlockComment = false;
  let attributeInLineComment = false;
  let attributeDepth = 0;
  let attributeQuote: string | null = null;
  let heredocTerminator: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] || "";
    const next = source[index + 1] || "";

    if (heredocTerminator !== null) {
      const closing = heredocClosingLength(source, index, heredocTerminator);

      if (closing > 0) {
        output += " ".repeat(closing);
        index += closing - 1;
        heredocTerminator = null;
        continue;
      }

      output += maskedCharacter(character);
      continue;
    }

    if (attributeDepth > 0) {
      output += maskedCharacter(character);

      if (attributeInLineComment) {
        if (character === "\n") {
          attributeInLineComment = false;
        }

        continue;
      }

      if (attributeInBlockComment) {
        if (character === "*" && next === "/") {
          output += " ";
          index += 1;
          attributeInBlockComment = false;
        }

        continue;
      }

      if (attributeQuote) {
        if (character === "\\") {
          output += maskedCharacter(next);
          index += 1;
          continue;
        }

        if (character === attributeQuote) {
          attributeQuote = null;
        }

        continue;
      }

      if (character === "/" && next === "/") {
        output += " ";
        index += 1;
        attributeInLineComment = true;
        continue;
      }

      if (character === "/" && next === "*") {
        output += " ";
        index += 1;
        attributeInBlockComment = true;
        continue;
      }

      if (character === "#") {
        attributeInLineComment = true;
        continue;
      }

      if (character === "'" || character === '"') {
        attributeQuote = character;
        continue;
      }

      if (character === "[") {
        attributeDepth += 1;
        continue;
      }

      if (character === "]") {
        attributeDepth -= 1;
      }

      continue;
    }

    if (inLineComment) {
      output += maskedCharacter(character);

      if (character === "\n") {
        inLineComment = false;
      }

      continue;
    }

    if (inBlockComment) {
      output += maskedCharacter(character);

      if (character === "*" && next === "/") {
        output += " ";
        index += 1;
        inBlockComment = false;
      }

      continue;
    }

    if (quote) {
      output += maskedCharacter(character);

      if (character === "\\" && quote !== "`") {
        output += maskedCharacter(next);
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "/" && next === "/") {
      output += "  ";
      index += 1;
      inLineComment = true;
      continue;
    }

    if (character === "#" && next === "[") {
      output += "  ";
      index += 1;
      attributeDepth = 1;
      continue;
    }

    if (character === "#") {
      output += " ";
      inLineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      output += "  ";
      index += 1;
      inBlockComment = true;
      continue;
    }

    const heredocStart = heredocOpening(source, index);

    if (heredocStart) {
      output += " ".repeat(heredocStart.length);
      index += heredocStart.length - 1;
      heredocTerminator = heredocStart.terminator;
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      output += " ";
      quote = character;
      continue;
    }

    output += character;
  }

  return output;
}

function maskedCharacter(character: string): string {
  return character === "\n" ? "\n" : " ";
}

function heredocOpening(
  source: string,
  index: number,
): { length: number; terminator: string } | null {
  if (source.slice(index, index + 3) !== "<<<") {
    return null;
  }

  const match = /^<<<[ \t]*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1[ \t]*\r?\n/.exec(
    source.slice(index),
  );
  const terminator = match?.[2];

  if (!match || !terminator) {
    return null;
  }

  return { length: match[0].length, terminator };
}

function heredocClosingLength(
  source: string,
  index: number,
  terminator: string,
): number {
  if (source[index - 1] !== "\n") {
    return 0;
  }

  const match = new RegExp(`^[ \\t]*${terminator}\\b`).exec(source.slice(index));

  if (!match) {
    return 0;
  }

  return match[0].length;
}
