/**
 * Pure planning for the "Add parameter" refactoring on PHP source (Change
 * Signature - slice 1). Given a cursor offset on (the signature of, or inside
 * the body of) a class method or free function, this produces a plan an editor
 * adapter applies as a SINGLE zero-length insertion: a placeholder OPTIONAL
 * parameter (`$parameter = null`) appended to the END of the parameter list.
 *
 * Appending an OPTIONAL parameter (one with a default value) keeps every
 * existing call-site valid, so this is a deliberately single-file refactor: no
 * cross-file edits, no call-site rewriting, and therefore no corruption risk on
 * other files. Reordering / removing / making-required a parameter (which would
 * require call-site edits) is intentionally out of scope for this slice.
 *
 * The planner is DELIBERATELY conservative: anywhere there is doubt it returns
 * `null` (a no-op) rather than risk corrupting the user's file. It follows the
 * string/comment/heredoc masking style of `phpExtractVariable.ts` so structural
 * reasoning (matching the parameter-list parentheses, finding the body brace)
 * never trips over punctuation inside literals (a `)` inside a heredoc default
 * value must not be mistaken for the close of the parameter list).
 *
 * Rejected (returns `null`) shapes:
 *   - cursor out of range, or not inside any function signature/body,
 *   - a parameter list with no matching `)` (unbalanced / truncated source),
 *   - an ABSTRACT or INTERFACE method (declaration terminated by `;`, no `{}`):
 *     adding a parameter there would force every override/implementation to
 *     change too (cross-file) - out of scope for this single-file slice,
 *   - a trailing VARIADIC parameter (`...$args`): a parameter after a variadic
 *     is illegal PHP, so we never append one.
 */

const PLACEHOLDER_PARAMETER = "$parameter = null";

/**
 * Sentinels written by {@link maskPhpLineComments}. Every character that lives
 * inside a `//` / `#` line comment becomes {@link LINE_COMMENT_MARK}; every
 * position OUTSIDE a line comment becomes {@link NON_LINE_COMMENT_MARK} (newlines
 * preserved), so an exact `=== LINE_COMMENT_MARK` check identifies, and only
 * identifies, the comment interior.
 */
const LINE_COMMENT_MARK = "c";
const NON_LINE_COMMENT_MARK = ".";

export interface AddParameterPlan {
  /** Offset (original-document coordinates) of the zero-length insertion. */
  insertOffset: number;
  /** Text to insert at {@link insertOffset}. */
  insertText: string;
  /** The placeholder parameter name the user is expected to rename. */
  parameterName: string;
}

export function planAddParameter(
  source: string,
  offset: number,
): AddParameterPlan | null {
  if (!Number.isInteger(offset) || offset < 0 || offset > source.length) {
    return null;
  }

  const masked = maskPhpStringsAndComments(source);
  const signature = enclosingFunctionSignature(source, masked, offset);

  if (!signature) {
    return null;
  }

  // The raw parameter-list body (between the matched parentheses) drives both
  // the variadic guard and the separator/whitespace decision. Structural
  // reasoning uses the masked view; the inserted text uses the raw view.
  const rawParameters = source.slice(
    signature.openParen + 1,
    signature.closeParen,
  );
  const maskedParameters = masked.slice(
    signature.openParen + 1,
    signature.closeParen,
  );
  // A view that marks ONLY line-comment (`//` / `#`) bodies, so the insertion
  // anchor can tell a raw-significant string/heredoc DEFAULT value apart from a
  // raw-significant trailing line comment (which must never be written into).
  const lineCommentMaskParameters = maskPhpLineComments(source).slice(
    signature.openParen + 1,
    signature.closeParen,
  );

  if (hasTrailingVariadic(maskedParameters)) {
    return null;
  }

  const insertion = buildInsertion(
    rawParameters,
    maskedParameters,
    lineCommentMaskParameters,
    signature.openParen,
  );

  return {
    insertOffset: insertion.offset,
    insertText: insertion.text,
    parameterName: PLACEHOLDER_PARAMETER.split("=")[0]?.trim() ?? "$parameter",
  };
}

interface EnclosingFunctionSignature {
  openParen: number;
  closeParen: number;
}

/**
 * The innermost `function <name>(...)` whose parameter list OR body contains the
 * cursor `offset`, expressed as the offsets of its parameter-list `(` and `)`.
 *
 * A method/function qualifies only when:
 *   - the parameter-list parentheses are balanced (a `)` exists), AND
 *   - it has a real body `{ ... }` (the next non-trivial token after `)` is `{`,
 *     not `;`) - this excludes abstract/interface declarations, AND
 *   - the cursor sits anywhere from the `function` keyword through the end of the
 *     body (so the action fires on the signature OR inside the body).
 *
 * When several functions qualify (e.g. a closure nested in a method body) the
 * one with the LATEST `function` keyword at or before a body containing the
 * cursor wins, which is the innermost enclosing function.
 */
function enclosingFunctionSignature(
  source: string,
  masked: string,
  offset: number,
): EnclosingFunctionSignature | null {
  const pattern = /\bfunction\b\s*&?\s*[A-Za-z_][A-Za-z0-9_]*\s*\(/g;
  let best: EnclosingFunctionSignature | null = null;

  for (
    let match = pattern.exec(masked);
    match !== null;
    match = pattern.exec(masked)
  ) {
    const functionOffset = match.index;
    const openParen = masked.indexOf("(", functionOffset);

    if (openParen < 0) {
      continue;
    }

    const closeParen = matchingPair(masked, openParen, "(", ")");

    if (closeParen === null) {
      continue;
    }

    const bodyStart = bodyBraceOffset(masked, closeParen + 1);

    if (bodyStart < 0) {
      // Abstract / interface method (`;` before `{`) or no body at all: skip.
      continue;
    }

    const bodyEnd = matchingPair(masked, bodyStart, "{", "}");

    if (bodyEnd === null) {
      continue;
    }

    // Fire when the cursor is on the signature (function keyword .. close paren)
    // OR anywhere inside the body. Using the function keyword as the lower bound
    // lets the action trigger from the leading modifiers region too.
    const withinSignatureOrBody =
      offset >= functionOffset && offset <= bodyEnd;

    if (!withinSignatureOrBody) {
      continue;
    }

    best = { closeParen, openParen };
  }

  if (!best) {
    return null;
  }

  // Defensive: confirm the matched parentheses are real `(`/`)` in the RAW
  // source (masking never alters bracket characters, but this keeps the
  // contract explicit before we splice around them).
  if (source[best.openParen] !== "(" || source[best.closeParen] !== ")") {
    return null;
  }

  return best;
}

/**
 * The offset of the body-opening `{` that follows the parameter list, or `-1`
 * when a `;` (abstract/interface declaration) or end-of-source is reached first.
 * A return-type declaration (`: void`, `: ?Foo`, `: A|B`) may sit between `)`
 * and `{`; those characters are skipped while scanning for the brace.
 */
function bodyBraceOffset(masked: string, from: number): number {
  for (let index = from; index < masked.length; index += 1) {
    const character = masked[index];

    if (character === "{") {
      return index;
    }

    if (character === ";") {
      return -1;
    }
  }

  return -1;
}

/**
 * True when the LAST parameter is variadic (`...$x`). PHP forbids any parameter
 * after a variadic, so appending one would corrupt the file - the action must
 * decline. A variadic is the token `...` in the parameter DECLARATION, which can
 * be spelled `...$x`, `int ...$x`, `... $x` (spaced) or, for a by-reference
 * variadic, `&...$x` (the only legal by-ref-variadic spelling; `...&$x` is a
 * PHP parse error). The `...` always sits at bracket-depth 0 BEFORE the
 * parameter's top-level `=` default, so a literal `...` inside a default value
 * (e.g. an array spread `[...$a]`, or any masked-out string body) is correctly
 * NOT treated as a variadic marker.
 */
function hasTrailingVariadic(maskedParameters: string): boolean {
  const lastParameterStart = lastTopLevelCommaIndex(maskedParameters) + 1;
  const lastParameterMasked = maskedParameters.slice(lastParameterStart);
  const declaration = beforeTopLevelDefault(lastParameterMasked);

  return containsTopLevelSpread(declaration);
}

/**
 * The slice of a (masked) single-parameter string up to its top-level `=`
 * (default-value) sign, or the whole string when it has none. Mirrors the
 * depth-aware scan of `topLevelEqualsIndex` in `phpMethodCompletions.ts` but
 * operates on the already string/comment-masked view, so an `=` inside a default
 * value's nested brackets or a masked literal never ends the declaration early.
 */
function beforeTopLevelDefault(maskedParameter: string): string {
  let depth = 0;

  for (let index = 0; index < maskedParameter.length; index += 1) {
    const character = maskedParameter[index];

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character === "=" && depth === 0) {
      return maskedParameter.slice(0, index);
    }
  }

  return maskedParameter;
}

/**
 * True when the (masked) parameter declaration contains a `...` spread token at
 * bracket-depth 0 - the variadic marker. Bracket depth is tracked so a `...`
 * nested inside `(...)`/`[...]`/`{...}` (which cannot appear in a real
 * declaration anyway) is ignored defensively.
 */
function containsTopLevelSpread(maskedDeclaration: string): boolean {
  let depth = 0;

  for (let index = 0; index < maskedDeclaration.length; index += 1) {
    const character = maskedDeclaration[index];

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0 && maskedDeclaration.startsWith("...", index)) {
      return true;
    }
  }

  return false;
}

/**
 * The index of the last top-level (bracket-depth 0) comma in the masked
 * parameter list, or `-1` when there is none. Brackets inside default values
 * (`= max(1, 2)`, `= [1, 2]`) are skipped via depth tracking.
 */
function lastTopLevelCommaIndex(maskedParameters: string): number {
  let depth = 0;
  let last = -1;

  for (let index = 0; index < maskedParameters.length; index += 1) {
    const character = maskedParameters[index];

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character === "," && depth === 0) {
      last = index;
    }
  }

  return last;
}

interface ParameterInsertion {
  offset: number;
  text: string;
}

/**
 * Where (absolute offset) and what to insert. The insertion always lands right
 * after the LAST SIGNIFICANT character of the parameter list, so any trailing
 * whitespace / newline / indent before the close `)` is preserved untouched
 * (clean multiline output) and existing parameters are never disturbed:
 *   - empty list (`()`)            -> `$parameter = null` at `(` + 1
 *   - last significant char is `,` -> ` $parameter = null` right after the comma
 *   - otherwise                    -> `, $parameter = null` right after the value
 *
 * `openParen` is the absolute offset of the parameter-list `(`; offsets inside
 * the masked/raw parameter slices are relative to `openParen + 1`.
 */
function buildInsertion(
  rawParameters: string,
  maskedParameters: string,
  lineCommentMaskParameters: string,
  openParen: number,
): ParameterInsertion {
  const parametersStart = openParen + 1;

  if (maskedParameters.trim().length === 0) {
    return { offset: parametersStart, text: PLACEHOLDER_PARAMETER };
  }

  const lastSignificantIndex = lastSignificantParameterIndex(
    rawParameters,
    maskedParameters,
    lineCommentMaskParameters,
  );
  const afterLast = parametersStart + lastSignificantIndex + 1;
  const lastSignificantChar = rawParameters[lastSignificantIndex];

  if (lastSignificantChar === ",") {
    return { offset: afterLast, text: ` ${PLACEHOLDER_PARAMETER}` };
  }

  return { offset: afterLast, text: `, ${PLACEHOLDER_PARAMETER}` };
}

/**
 * The index of the last character that carries REAL content in the parameter
 * list: a character is significant when it is non-whitespace in the masked view
 * (structural punctuation/identifiers) OR non-whitespace in the RAW view (a
 * string/heredoc default-value body that masking blanked to spaces). This is
 * what keeps the insertion landing AFTER a `= "world"` or `= <<<HTML ... HTML`
 * default value rather than right after the `=` sign that masking leaves bare.
 *
 * A TRAILING line comment (`// ...` / `# ...`) is raw-significant but masked
 * blank, exactly like a string default body - yet it must NOT anchor the
 * insertion (writing after its last raw char lands the new parameter INSIDE the
 * comment, silently commenting it out). The line-comment mask lets us exclude
 * those characters from the raw-significant clause, so the anchor walks back to
 * the real last parameter (or its string/heredoc default) BEFORE the comment.
 */
function lastSignificantParameterIndex(
  rawParameters: string,
  maskedParameters: string,
  lineCommentMaskParameters: string,
): number {
  for (let index = maskedParameters.length - 1; index >= 0; index -= 1) {
    const maskedSignificant = !isWhitespace(maskedParameters[index]);
    const insideLineComment = lineCommentMaskParameters[index] === LINE_COMMENT_MARK;
    const rawSignificant =
      !insideLineComment && !isWhitespace(rawParameters[index]);

    if (maskedSignificant || rawSignificant) {
      return index;
    }
  }

  return -1;
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character);
}

/**
 * The offset of the bracket that matches the `open` bracket at `openIndex`, or
 * `null` when unbalanced. Operates on the masked source so brackets inside
 * literals/comments (already blanked to spaces) never affect the count.
 */
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
    const character = masked[index];

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

/**
 * Masks string literals, comments, heredocs and nowdocs to spaces (newlines
 * preserved) so structural punctuation inside them is ignored. Mirrors the
 * masking used by `phpExtractVariable.ts`, kept self-contained to this module.
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

/**
 * A view the same length as `source` where every character INSIDE a `//` / `#`
 * line comment (the opener through the char before its terminating newline) is
 * {@link LINE_COMMENT_MARK}, newlines are preserved, and every other position is
 * {@link NON_LINE_COMMENT_MARK}. It reuses the exact string/heredoc/block-comment
 * state machine of {@link maskPhpStringsAndComments} so a `//` or `#` inside a
 * string, heredoc, block comment, or a `$#`-style sequence is NOT mistaken for a
 * line-comment opener. Only LINE comments are marked: block comments and
 * string/heredoc default bodies are deliberately left as non-comment, because
 * the insertion must still land AFTER a string/heredoc default value.
 */
function maskPhpLineComments(source: string): string {
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
        output += NON_LINE_COMMENT_MARK.repeat(closing);
        index += closing - 1;
        heredocTerminator = null;
        continue;
      }

      output += character === "\n" ? "\n" : NON_LINE_COMMENT_MARK;
      continue;
    }

    if (inLineComment) {
      if (character === "\n") {
        output += "\n";
        inLineComment = false;
        continue;
      }

      output += LINE_COMMENT_MARK;
      continue;
    }

    if (inBlockComment) {
      output += character === "\n" ? "\n" : NON_LINE_COMMENT_MARK;

      if (character === "*" && next === "/") {
        output += NON_LINE_COMMENT_MARK;
        index += 1;
        inBlockComment = false;
      }

      continue;
    }

    if (quote) {
      output += character === "\n" ? "\n" : NON_LINE_COMMENT_MARK;

      if (character === "\\" && quote !== "`") {
        output += next === "\n" ? "\n" : NON_LINE_COMMENT_MARK;
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "/" && next === "/") {
      output += `${LINE_COMMENT_MARK}${LINE_COMMENT_MARK}`;
      index += 1;
      inLineComment = true;
      continue;
    }

    if (character === "#" && source[index - 1] !== "$") {
      output += LINE_COMMENT_MARK;
      inLineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      output += `${NON_LINE_COMMENT_MARK}${NON_LINE_COMMENT_MARK}`;
      index += 1;
      inBlockComment = true;
      continue;
    }

    const heredocStart = heredocOpening(source, index);

    if (heredocStart) {
      output += NON_LINE_COMMENT_MARK.repeat(heredocStart.length);
      index += heredocStart.length - 1;
      heredocTerminator = heredocStart.terminator;
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      output += NON_LINE_COMMENT_MARK;
      quote = character;
      continue;
    }

    output += character === "\n" ? "\n" : NON_LINE_COMMENT_MARK;
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
