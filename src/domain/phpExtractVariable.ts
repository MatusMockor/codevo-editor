/**
 * Pure planning for the "Extract variable" refactoring on PHP source.
 *
 * Given a character selection that forms an expression, this produces a plan
 * that an editor adapter can apply as two edits:
 *   1. insert `<indent>$name = <expr>;\n` on its own line before the enclosing
 *      statement, and
 *   2. replace the original selection with `$name`.
 *
 * The planner is intentionally conservative: when the selection is not a
 * confidently-usable expression (empty, whitespace, contains a statement
 * terminator, has unbalanced brackets/quotes, or sits at out-of-range offsets)
 * it returns `null` rather than offering a risky extraction.
 *
 * It follows the masking/balanced/offset style of `phpClassStructure.ts`:
 * strings and comments are masked to spaces before structural reasoning so
 * that punctuation inside literals never affects validation or line detection.
 */

export interface ExtractVariablePlan {
  declarationOffset: number;
  declarationText: string;
  replaceStart: number;
  replaceEnd: number;
  replacementText: string;
}

const DEFAULT_VARIABLE_NAME = "$extracted";

export function planExtractVariable(
  source: string,
  selectionStart: number,
  selectionEnd: number,
  variableName?: string,
): ExtractVariablePlan | null {
  const range = normalizeSelection(source, selectionStart, selectionEnd);

  if (!range) {
    return null;
  }

  const trimmed = trimSelection(source, range.start, range.end);

  if (!trimmed) {
    return null;
  }

  const masked = maskPhpStringsAndComments(source);
  const maskedSelection = masked.slice(trimmed.start, trimmed.end);
  const rawSelection = source.slice(trimmed.start, trimmed.end);

  if (!isExtractableExpression(rawSelection, maskedSelection)) {
    return null;
  }

  const name = normalizeVariableName(variableName);

  if (!name) {
    return null;
  }

  const expression = source.slice(trimmed.start, trimmed.end);
  const lineStart = lineStartOffset(source, trimmed.start);
  const indent = indentOf(source, lineStart);

  return {
    declarationOffset: lineStart,
    declarationText: `${indent}${name} = ${expression};\n`,
    replaceStart: trimmed.start,
    replaceEnd: trimmed.end,
    replacementText: name,
  };
}

function normalizeSelection(
  source: string,
  selectionStart: number,
  selectionEnd: number,
): { start: number; end: number } | null {
  if (!Number.isInteger(selectionStart) || !Number.isInteger(selectionEnd)) {
    return null;
  }

  if (selectionStart < 0 || selectionEnd > source.length) {
    return null;
  }

  if (selectionStart >= selectionEnd) {
    return null;
  }

  return { start: selectionStart, end: selectionEnd };
}

function trimSelection(
  source: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  let trimmedStart = start;
  let trimmedEnd = end;

  while (trimmedStart < trimmedEnd && isWhitespace(source[trimmedStart])) {
    trimmedStart += 1;
  }

  while (trimmedEnd > trimmedStart && isWhitespace(source[trimmedEnd - 1])) {
    trimmedEnd -= 1;
  }

  if (trimmedStart >= trimmedEnd) {
    return null;
  }

  return { start: trimmedStart, end: trimmedEnd };
}

function isExtractableExpression(
  rawSelection: string,
  maskedSelection: string,
): boolean {
  if (!rawSelection.trim()) {
    return false;
  }

  if (containsStatementTerminator(maskedSelection)) {
    return false;
  }

  if (!hasBalancedBrackets(maskedSelection)) {
    return false;
  }

  return hasExpressionContent(rawSelection, maskedSelection);
}

function containsStatementTerminator(maskedSelection: string): boolean {
  return (
    maskedSelection.includes(";") ||
    maskedSelection.includes("{") ||
    maskedSelection.includes("}")
  );
}

/**
 * Rejects selections whose masked form is nothing but operators/whitespace.
 * A usable expression must contain an identifier, variable, literal digit, or a
 * balanced bracket group in its masked (structural) form. A selection that
 * masks down to whitespace is only accepted when its raw form is a complete,
 * single string literal (e.g. `'a;b'`) rather than a comment fragment.
 */
function hasExpressionContent(
  rawSelection: string,
  maskedSelection: string,
): boolean {
  if (/[A-Za-z0-9_$]/.test(maskedSelection) || /[(\[]/.test(maskedSelection)) {
    return true;
  }

  return isCompleteStringLiteral(rawSelection);
}

function isCompleteStringLiteral(rawSelection: string): boolean {
  return /^'(?:\\.|[^'\\])*'$/s.test(rawSelection) || /^"(?:\\.|[^"\\])*"$/s.test(rawSelection);
}

function hasBalancedBrackets(maskedSelection: string): boolean {
  const stack: string[] = [];
  const closing: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

  for (const character of maskedSelection) {
    if (character === "(" || character === "[" || character === "{") {
      stack.push(character);
      continue;
    }

    const expectedOpen = closing[character];

    if (!expectedOpen) {
      continue;
    }

    if (stack.pop() !== expectedOpen) {
      return false;
    }
  }

  return stack.length === 0;
}

function normalizeVariableName(variableName: string | undefined): string | null {
  if (variableName === undefined) {
    return DEFAULT_VARIABLE_NAME;
  }

  const withoutDollar = variableName.trim().replace(/^\$+/, "");

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(withoutDollar)) {
    return null;
  }

  return `$${withoutDollar}`;
}

function lineStartOffset(source: string, offset: number): number {
  const newline = source.lastIndexOf("\n", offset - 1);

  return newline + 1;
}

function indentOf(source: string, lineStart: number): string {
  let index = lineStart;

  while (index < source.length && isHorizontalWhitespace(source[index])) {
    index += 1;
  }

  return source.slice(lineStart, index);
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character);
}

function isHorizontalWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t";
}

/**
 * Masks string literals, comments and heredocs to spaces (newlines preserved)
 * so structural punctuation inside them is ignored. Mirrors the masking style
 * used by `phpClassStructure.ts` but kept self-contained to this module.
 */
function maskPhpStringsAndComments(source: string): string {
  let output = "";
  let quote: string | null = null;
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

      output += character === "\n" ? "\n" : " ";
      continue;
    }

    if (inLineComment) {
      output += character === "\n" ? "\n" : " ";

      if (character === "\n") {
        inLineComment = false;
      }

      continue;
    }

    if (inBlockComment) {
      output += character === "\n" ? "\n" : " ";

      if (character === "*" && next === "/") {
        output += " ";
        index += 1;
        inBlockComment = false;
      }

      continue;
    }

    if (quote) {
      output += character === "\n" ? "\n" : " ";

      if (character === "\\" && quote !== "`") {
        output += next === "\n" ? "\n" : " ";
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

    if (character === "#" && source[index - 1] !== "$") {
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

  const leadingWhitespace = match[0].length - terminator.length;

  return leadingWhitespace + terminator.length;
}
