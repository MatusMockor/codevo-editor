/**
 * Pure domain logic for the "Move Statement Up / Down" editor action
 * (PhpStorm Cmd+Shift+Up / Cmd+Shift+Down).
 *
 * Unlike "Move Line" (which shifts a single physical line), this moves the
 * whole statement under the caret as one unit and swaps it with the adjacent
 * statement. When the caret sits on (or inside) a brace block - `if`,
 * `foreach`, `while`, `for`, `function`, `try`/`catch`, `match`, a closure body
 * and friends - the entire block travels together:
 *
 *   $before = 1;            if ($ready) {
 *   if ($ready) {     ->        doStuff();
 *       doStuff();          }
 *   }                       $before = 1;
 *
 * The analysis is intentionally conservative. It works on physical-line ranges
 * whose braces balance (after masking strings and comments). The moment a range
 * is ambiguous - an unbalanced block, a multi-line expression fragment, a
 * continuation line, a blank line, or a file edge - it returns `null` and the
 * caller leaves the document untouched (or falls back to Move Line). Better to
 * do nothing than to corrupt code.
 *
 * The module is free of Monaco / React dependencies so it can be unit-tested in
 * isolation; the editor surface translates the result into an `executeEdits`
 * call over the combined line range.
 */

export type MoveStatementDirection = "down" | "up";

export interface MoveStatementEdit {
  /** 1-based line the caret should land on after the swap. */
  caretLine: number;
  /** 1-based last line of the combined range that is rewritten. */
  endLine: number;
  /** Replacement text for the combined range (the swapped order). */
  newText: string;
  /** 1-based first line of the combined range that is rewritten. */
  startLine: number;
}

interface StatementRange {
  end: number;
  start: number;
}

export function phpMoveStatement(
  source: string,
  caretLine: number,
  direction: MoveStatementDirection,
): MoveStatementEdit | null {
  const lines = source.split("\n");

  if (caretLine < 1 || caretLine > lines.length) {
    return null;
  }

  if (lines[caretLine - 1].trim().length === 0) {
    return null;
  }

  const masked = maskSourceLines(lines);
  const current = statementRangeAt(lines, masked, caretLine);

  if (!current) {
    return null;
  }

  const neighbour = neighbourRange(lines, masked, current, direction);

  if (!neighbour) {
    return null;
  }

  return buildSwapEdit(lines, current, neighbour, direction);
}

// Resolves the full statement range covering `caretLine`. The range starts on
// the line that owns the statement (walking up past body / continuation lines)
// and ends on the line that closes it (matching `}` for a block, otherwise the
// owning line itself). Returns null when the boundaries cannot be trusted.
function statementRangeAt(
  lines: string[],
  masked: string[],
  caretLine: number,
): StatementRange | null {
  const start = statementStartLine(lines, masked, caretLine);

  if (start === null) {
    return null;
  }

  return statementRangeFrom(masked, start);
}

// Resolves the line that begins the statement under the caret. Two ways a caret
// line is not itself the start:
//   1. The caret sits on a block's closing line (net negative brackets, e.g. a
//      lone `}`); the statement begins on the matching opener line above.
//   2. The caret continues a multi-line expression opened on the line(s) above
//      (an unclosed `(` / `[`, or a trailing operator / comma / `=>`).
// Block bodies are NOT treated as part of the enclosing statement: a complete
// statement inside a block moves within that block (PhpStorm parity).
function statementStartLine(
  lines: string[],
  masked: string[],
  caretLine: number,
): number | null {
  const caretMasked = stripLineComment(masked[caretLine - 1]);

  if (bracketDelta(caretMasked) < 0) {
    return blockOpenerLineFor(masked, caretLine);
  }

  let line = caretLine;

  while (line > 1) {
    const previous = previousCodeLine(lines, line);

    if (previous === null) {
      return line;
    }

    if (!continuesPrevious(masked, previous)) {
      return line;
    }

    line = previous;
  }

  return line;
}

// Walks upward from a closing line until the bracket depth balances, returning
// the line that opened the block. Null when the brackets never balance (an
// unterminated fragment), which keeps the move conservative.
function blockOpenerLineFor(masked: string[], closingLine: number): number | null {
  let depth = 0;

  for (let line = closingLine; line >= 1; line -= 1) {
    depth += bracketDelta(stripLineComment(masked[line - 1]));

    if (depth === 0) {
      return line;
    }

    if (depth > 0) {
      return null;
    }
  }

  return null;
}

// True when a statement starting on `line` continues an expression opened on the
// `previous` code line: either `previous` leaves a bracket open (`(` / `[`) that
// has not been balanced by `line`, or it ends with a token demanding more input
// (`,`, `=>`, `->`, `.`, an arithmetic / logical operator, `=`). A trailing block
// brace (`{`) is excluded so block bodies are not folded into their header.
function continuesPrevious(masked: string[], previous: number): boolean {
  const previousMasked = stripLineComment(masked[previous - 1]).replace(
    /\s+$/,
    "",
  );

  if (previousMasked.length === 0) {
    return false;
  }

  if (parenDelta(previousMasked) > 0) {
    return true;
  }

  return endsWithInlineContinuation(previousMasked);
}

function endsWithInlineContinuation(previousMasked: string): boolean {
  return /(?:,|=>|->|\?\?|\.|\+|-|\*|\/|&&|\|\||=|\b(?:and|or)\b)\s*$/.test(
    previousMasked,
  );
}

// Net change in `(` / `[` depth only (ignores `{`). Used to detect inline
// expression continuations without mistaking a block opener for one.
function parenDelta(maskedLine: string): number {
  let delta = 0;

  for (const character of maskedLine) {
    if (character === "(" || character === "[") {
      delta += 1;
      continue;
    }

    if (character === ")" || character === "]") {
      delta -= 1;
    }
  }

  return delta;
}

// Given a confirmed statement start line, finds the line that ends it. When the
// start line opens more brackets than it closes, the statement is a block and we
// scan forward to the line where the depth returns to zero. Otherwise the
// statement is a single line. Returns null if the block never balances.
function statementRangeFrom(
  masked: string[],
  start: number,
): StatementRange | null {
  let depth = bracketDelta(stripLineComment(masked[start - 1]));

  if (depth < 0) {
    return null;
  }

  if (depth === 0) {
    return { end: start, start };
  }

  for (let line = start + 1; line <= masked.length; line += 1) {
    depth += bracketDelta(stripLineComment(masked[line - 1]));

    if (depth < 0) {
      return null;
    }

    if (depth === 0) {
      return { end: line, start };
    }
  }

  return null;
}

// Locates the adjacent statement to swap with. For "up" it is the statement
// ending on the line directly above the current range; for "down" the statement
// starting directly below. Returns null at a file edge or when the neighbour
// cannot be resolved into a balanced range.
function neighbourRange(
  lines: string[],
  masked: string[],
  current: StatementRange,
  direction: MoveStatementDirection,
): StatementRange | null {
  if (direction === "up") {
    return neighbourAbove(lines, masked, current);
  }

  return neighbourBelow(lines, masked, current);
}

function neighbourAbove(
  lines: string[],
  masked: string[],
  current: StatementRange,
): StatementRange | null {
  const above = current.start - 1;

  if (above < 1) {
    return null;
  }

  if (lines[above - 1].trim().length === 0) {
    return null;
  }

  const neighbour = statementRangeAt(lines, masked, above);

  if (!neighbour || neighbour.end !== above) {
    return null;
  }

  return neighbour;
}

function neighbourBelow(
  lines: string[],
  masked: string[],
  current: StatementRange,
): StatementRange | null {
  const below = current.end + 1;

  if (below > lines.length) {
    return null;
  }

  if (lines[below - 1].trim().length === 0) {
    return null;
  }

  const neighbour = statementRangeAt(lines, masked, below);

  if (!neighbour || neighbour.start !== below) {
    return null;
  }

  return neighbour;
}

// Produces the combined edit that swaps the two adjacent ranges. The caret
// follows the moved statement to its new first line.
function buildSwapEdit(
  lines: string[],
  current: StatementRange,
  neighbour: StatementRange,
  direction: MoveStatementDirection,
): MoveStatementEdit {
  if (direction === "up") {
    const startLine = neighbour.start;
    const endLine = current.end;
    const currentLines = lines.slice(current.start - 1, current.end);
    const neighbourLines = lines.slice(neighbour.start - 1, neighbour.end);

    return {
      caretLine: startLine,
      endLine,
      newText: [...currentLines, ...neighbourLines].join("\n"),
      startLine,
    };
  }

  const startLine = current.start;
  const endLine = neighbour.end;
  const currentLines = lines.slice(current.start - 1, current.end);
  const neighbourLines = lines.slice(neighbour.start - 1, neighbour.end);
  const caretLine = startLine + neighbourLines.length;

  return {
    caretLine,
    endLine,
    newText: [...neighbourLines, ...currentLines].join("\n"),
    startLine,
  };
}

// Returns the index of the closest non-blank line above `line`, or null when
// there is none.
function previousCodeLine(lines: string[], line: number): number | null {
  for (let candidate = line - 1; candidate >= 1; candidate -= 1) {
    if (lines[candidate - 1].trim().length > 0) {
      return candidate;
    }
  }

  return null;
}

// Net change in bracket depth for a masked line, counting `(`, `[`, `{` as +1
// and their closers as -1.
function bracketDelta(maskedLine: string): number {
  let delta = 0;

  for (const character of maskedLine) {
    if (character === "(" || character === "[" || character === "{") {
      delta += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      delta -= 1;
    }
  }

  return delta;
}

// Drops a trailing `//` / `#` comment body so its characters never reach the
// bracket counter. The opener position is found on the already-masked line.
function stripLineComment(maskedLine: string): string {
  const slash = maskedLine.indexOf("//");
  const hash = maskedLine.indexOf("#");
  const candidates = [slash, hash].filter((index) => index >= 0);

  if (candidates.length === 0) {
    return maskedLine;
  }

  return maskedLine.slice(0, Math.min(...candidates));
}

interface MaskState {
  insideBlockComment: boolean;
}

// Masks every line while carrying `/* */` block-comment state across line
// boundaries, so a comment opened on one line keeps masking the brackets on the
// lines below it. Single-line maskers cannot do this, which would otherwise let
// braces inside a multi-line comment corrupt the bracket-depth scan.
function maskSourceLines(lines: string[]): string[] {
  const state: MaskState = { insideBlockComment: false };

  return lines.map((line) => maskLine(line, state));
}

// Replaces the contents of single-line string literals and `/* */` comment
// bodies with spaces so structural characters inside them never affect brace
// balancing. The `//` / `#` openers are preserved so `stripLineComment` can find
// them; their bodies are copied verbatim (safe per line). `state` is mutated to
// report whether the line ends still inside an open block comment.
function maskLine(line: string, state: MaskState): string {
  let masked = "";
  let quote: string | null = null;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] || "";
    const next = line[index + 1] || "";

    if (state.insideBlockComment) {
      if (character === "*" && next === "/") {
        masked += "  ";
        index += 1;
        state.insideBlockComment = false;
        continue;
      }

      masked += " ";
      continue;
    }

    if (quote) {
      if (character === "\\" && quote !== "`") {
        masked += "  ";
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      masked += " ";
      continue;
    }

    if (character === "/" && next === "/") {
      masked += line.slice(index);
      return masked;
    }

    if (character === "#") {
      masked += line.slice(index);
      return masked;
    }

    if (character === "/" && next === "*") {
      masked += "  ";
      index += 1;
      state.insideBlockComment = true;
      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      masked += " ";
      continue;
    }

    masked += character;
  }

  return masked;
}
