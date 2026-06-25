/**
 * Pure domain logic for the "Complete Current Statement" editor action
 * (PhpStorm Cmd+Shift+Enter).
 *
 * Given the text of the current line plus the caret column, it figures out the
 * smallest safe edit that turns the line into a syntactically complete PHP
 * statement and reports where the caret should land:
 *
 *   - `$x = 5`        -> `$x = 5;`            (caret after the `;`)
 *   - `foo(1, 2`      -> `foo(1, 2);`         (unbalanced `(` closed first)
 *   - `$arr[0`        -> `$arr[0]`            (subscript closed, no `;`)
 *   - `if ($x)`       -> `if ($x) {` + body   (block opened, caret in body)
 *
 * The analysis is intentionally line-scoped and conservative: when the line is
 * already complete, or the situation is ambiguous, it prefers to do nothing
 * rather than guess wrong. String / comment contents are masked (mirroring
 * `phpScopeCompletions.ts`) so a `(`, `[` or `;` inside a literal never drives
 * the decision.
 *
 * The module is free of Monaco / React dependencies so it can be unit-tested in
 * isolation; the editor surface translates the result into an `executeEdits`
 * call (for `replaceLine`) or a snippet insertion (for `insertBlock`).
 */

export interface ReplaceLineCompletion {
  /** 1-based column the caret should move to within the rewritten line. */
  caretColumn: number;
  kind: "replaceLine";
  /** Full replacement text for the current line. */
  newText: string;
}

export interface InsertBlockCompletion {
  /** Leading whitespace of the header line, reused to indent the new body. */
  indent: string;
  kind: "insertBlock";
  /** The header line rewritten to open a brace block (e.g. `if ($x) {`). */
  keepHeader: string;
}

export type PhpStatementCompletion =
  | InsertBlockCompletion
  | ReplaceLineCompletion;

const CONTROL_HEADER_KEYWORDS = [
  "if",
  "elseif",
  "else if",
  "for",
  "foreach",
  "while",
  "function",
  "catch",
] as const;

export function completePhpStatement(
  lineText: string,
  _caretColumn: number,
): PhpStatementCompletion | null {
  const trimmedEnd = lineText.replace(/\s+$/, "");

  if (trimmedEnd.trim().length === 0) {
    return null;
  }

  const masked = maskLineStringsAndComments(trimmedEnd);
  const commentStart = lineCommentStart(masked);
  const codeEnd = commentStart === null ? trimmedEnd.length : commentStart;
  const code = trimmedEnd.slice(0, codeEnd).replace(/\s+$/, "");
  const codeMasked = masked.slice(0, code.length);

  if (code.trim().length === 0) {
    return null;
  }

  if (leadingControlKeyword(codeMasked)) {
    return controlHeaderCompletion(code, codeMasked, lineText);
  }

  return expressionCompletion(trimmedEnd, code, codeMasked, commentStart);
}

// A line whose leading keyword is a control header is handled exclusively here:
// it either opens a brace block or (when it is already complete) yields no edit,
// never falling through to the generic expression terminator.
function controlHeaderCompletion(
  code: string,
  codeMasked: string,
  lineText: string,
): InsertBlockCompletion | null {
  if (/[{};:]\s*$/.test(codeMasked)) {
    return null;
  }

  const closers = unbalancedClosers(codeMasked);
  const closedCode = `${code}${closers}`;

  if (!/\)\s*$/.test(maskLineStringsAndComments(closedCode))) {
    return null;
  }

  return {
    indent: leadingWhitespace(lineText),
    kind: "insertBlock",
    keepHeader: `${closedCode} {`,
  };
}

function expressionCompletion(
  fullLine: string,
  code: string,
  codeMasked: string,
  commentStart: number | null,
): ReplaceLineCompletion | null {
  const closers = unbalancedClosers(codeMasked);
  const closedMasked = maskLineStringsAndComments(`${code}${closers}`);
  const needsSemicolon =
    !isLoneSubscriptAccess(closedMasked) && !endsStatement(closedMasked);

  if (closers.length === 0 && !needsSemicolon) {
    return null;
  }

  const terminator = needsSemicolon ? ";" : "";
  const insertion = `${closers}${terminator}`;
  const trailing = commentStart === null ? "" : ` ${fullLine.slice(commentStart).trim()}`;
  const newCode = `${code}${insertion}`;

  return {
    caretColumn: newCode.length + 1,
    kind: "replaceLine",
    newText: `${newCode}${trailing}`,
  };
}

function leadingControlKeyword(codeMasked: string): string | null {
  const match = /^\s*([A-Za-z]+(?:\s+[A-Za-z]+)?)/.exec(codeMasked);

  if (!match) {
    return null;
  }

  const candidate = match[1].toLowerCase().replace(/\s+/g, " ");
  const keyword = CONTROL_HEADER_KEYWORDS.find((entry) =>
    candidate === entry || candidate.startsWith(`${entry} `),
  );

  if (!keyword) {
    return null;
  }

  const afterKeyword = codeMasked.slice(match.index + match[0].length);

  if (!/^\s*\(/.test(afterKeyword)) {
    return null;
  }

  return keyword;
}

// Returns the closing characters needed to balance every still-open `(` / `[`
// on the line, innermost first. Mismatched closers on the line are ignored so a
// stray `)` never produces a negative depth.
function unbalancedClosers(codeMasked: string): string {
  const stack: string[] = [];

  for (const character of codeMasked) {
    if (character === "(" || character === "[" || character === "{") {
      stack.push(character);
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      popMatching(stack, character);
    }
  }

  return stack
    .reverse()
    .map((opener) => closerFor(opener))
    .join("");
}

function popMatching(stack: string[], closer: string): void {
  const expected = openerFor(closer);
  const top = stack[stack.length - 1];

  if (top === expected) {
    stack.pop();
  }
}

function openerFor(closer: string): string {
  if (closer === ")") {
    return "(";
  }

  if (closer === "]") {
    return "[";
  }

  return "{";
}

function closerFor(opener: string): string {
  if (opener === "(") {
    return ")";
  }

  if (opener === "[") {
    return "]";
  }

  return "}";
}

// A bare variable subscript access such as `$arr[0]` or `$grid[1][2]` is treated
// as balancing only: closing the bracket completes the access and PhpStorm does
// not append a `;`. The moment there is an assignment, call, or other tokens it
// becomes a statement and is terminated normally.
function isLoneSubscriptAccess(closedMasked: string): boolean {
  return /^\s*\$[A-Za-z_][A-Za-z0-9_]*(?:\s*\[[^\]]*\])+\s*$/.test(closedMasked);
}

function endsStatement(codeMasked: string): boolean {
  return /[;{}:]\s*$/.test(codeMasked);
}

function lineCommentStart(masked: string): number | null {
  const slash = masked.indexOf("//");
  const hash = masked.indexOf("#");
  const candidates = [slash, hash].filter((index) => index >= 0);

  if (candidates.length === 0) {
    return null;
  }

  return Math.min(...candidates);
}

function leadingWhitespace(value: string): string {
  return /^\s*/.exec(value)?.[0] ?? "";
}

// Replaces the contents of single-line string literals and the `//`/`#`/`/* */`
// comment bodies with spaces so structural characters inside them never affect
// brace / paren balancing. The comment openers themselves are preserved so the
// caller can still locate where a trailing comment begins.
function maskLineStringsAndComments(line: string): string {
  let masked = "";
  let quote: string | null = null;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] || "";
    const next = line[index + 1] || "";

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
      return padToLength(masked, line.length);
    }

    if (character === "#") {
      masked += line.slice(index);
      return padToLength(masked, line.length);
    }

    if (character === "/" && next === "*") {
      masked += "/*";
      index += 1;
      const closeIndex = line.indexOf("*/", index + 1);

      if (closeIndex < 0) {
        masked += " ".repeat(line.length - masked.length);
        return masked;
      }

      masked += " ".repeat(closeIndex - masked.length);
      masked += "*/";
      index = closeIndex + 1;
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

function padToLength(value: string, length: number): string {
  if (value.length >= length) {
    return value.slice(0, length);
  }

  return value + " ".repeat(length - value.length);
}
