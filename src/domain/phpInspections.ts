/**
 * Lightweight PHP inspections (PhpStorm-style "this symbol is never used")
 * computed from text/AST only - no phpactor / semantic layer - so they work in
 * both light mode and IDE mode.
 *
 * Two inspections are produced, both intentionally CONSERVATIVE: a miss (not
 * flagging something genuinely unused) is always preferred over a false
 * positive (flagging something that is actually used), which is far more
 * annoying and erodes trust in the markers.
 *
 *  - "Unused import": a top-level `use X\Y;` whose short name / alias is not
 *    referenced anywhere in the file (code or PHPDoc type tags). Reuses the
 *    optimizer's conservative usage analysis ({@link phpUnusedClassImports}),
 *    which already guards docblocks, attributes, strings, heredocs, grouped /
 *    comma-list / aliased / function / const imports.
 *
 *  - "Unused private method": a `private function` in a CLASS that is never
 *    referenced via `$this->m`, `self::m`, `static::m`, `ClassName::m` or as a
 *    string callable `'m'`. Only private methods are considered (protected /
 *    public can be invoked from outside the file). The whole inspection is
 *    suppressed for a class that contains ANY dynamic dispatch (`$this->$x`,
 *    `call_user_func`, variable variables), because such a class can reach a
 *    method by a name we cannot see statically.
 */

import { phpUnusedClassImports } from "./phpImportsOrganizer";
import {
  parsePhpClassStructure,
  type PhpMethodMember,
} from "./phpClassStructure";

export type PhpInspectionKind = "unused-import" | "unused-private-method";

export interface PhpInspectionDiagnostic {
  character: number;
  endCharacter: number;
  endLine: number;
  kind: PhpInspectionKind;
  line: number;
  message: string;
  severity: "warning";
  /** Render the marker with Monaco's "Unnecessary" tag (faded/struck). */
  unnecessary: true;
}

/**
 * Magic methods are invoked by the PHP runtime, not by an in-file call site, so
 * a private/uncalled magic method is never "unused". Conservatively skip any
 * `__*` method.
 */
const MAGIC_METHOD_PATTERN = /^__/;

/**
 * Markers of dynamic dispatch that make static "is this method called?"
 * analysis unsafe for a whole class. When ANY of these appears in the class
 * body we suppress the unused-private-method inspection for that class.
 *  - `$this->$x(` / `$obj->$x(`        variable method name
 *  - `static::$x(` / `self::$x(`        variable static method name
 *  - `call_user_func` / `call_user_func_array`  reflective dispatch
 *  - `->{`  /  `::{`                    dynamic member expression
 */
const DYNAMIC_DISPATCH_PATTERNS: readonly RegExp[] = [
  /->\s*\$[A-Za-z_]/,
  /::\s*\$[A-Za-z_]/,
  /\bcall_user_func(?:_array)?\b/,
  /->\s*\{/,
  /::\s*\{/,
];

export function phpInspectionDiagnostics(
  source: string,
): PhpInspectionDiagnostic[] {
  return [
    ...unusedImportDiagnostics(source),
    ...unusedPrivateMethodDiagnostics(source),
  ];
}

/**
 * A removable unused symbol, with the exact character span the remove quick-fix
 * deletes. The span is whitespace-aware so removal leaves no dangling blank
 * line: it covers the symbol's statement plus its single trailing newline.
 */
export interface PhpUnusedSymbolRemoval {
  /** End character offset (exclusive) of the removal span. */
  end: number;
  /** Short label for the action title, e.g. `App\Foo` or `helper`. */
  label: string;
  /** Start character offset of the removal span. */
  start: number;
}

/**
 * The unused-import removal whose statement covers `offset` (a cursor anywhere
 * on the `use` line), or `null` when the cursor is not on an unused import.
 * Used by the "Remove unused import" quick-fix. Conservative: only single,
 * non-grouped class imports are ever offered (see {@link phpUnusedClassImports}).
 */
export function phpUnusedImportRemovalAt(
  source: string,
  offset: number,
): PhpUnusedSymbolRemoval | null {
  for (const unused of phpUnusedClassImports(source)) {
    if (offset < unused.start || offset > unused.end) {
      continue;
    }

    return {
      end: removalEndIncludingTrailingNewline(source, unused.end),
      label: unused.label,
      start: unused.start,
    };
  }

  return null;
}

/**
 * The unused-private-method removal whose declaration encloses `offset`, or
 * `null` when the cursor is not on an unused private method (or the method's
 * span cannot be resolved confidently). Used by the "Remove unused method"
 * quick-fix. Conservative: the body's closing brace is located by balanced
 * brace matching over a fully masked source; if it cannot be found, no action
 * is offered.
 */
export function phpUnusedPrivateMethodRemovalAt(
  source: string,
  offset: number,
): PhpUnusedSymbolRemoval | null {
  const masked = maskPhpForBraceMatching(source);

  for (const method of findUnusedPrivateMethods(source)) {
    const span = methodRemovalSpan(source, masked, method);

    if (!span || offset < span.start || offset > span.end) {
      continue;
    }

    return { end: span.end, label: method.name, start: span.start };
  }

  return null;
}

/**
 * Computes the whitespace-aware removal span for a private method: from the
 * start of the method's first decorated line (so leading indentation goes too)
 * through the body's closing brace and its trailing newline. Returns `null`
 * when the brace cannot be matched (conservative no-op over corruption).
 */
function methodRemovalSpan(
  source: string,
  masked: string,
  method: PhpMethodMember,
): { end: number; start: number } | null {
  const openBrace = masked.indexOf("{", method.declarationOffset);

  if (openBrace < 0) {
    return null;
  }

  const closeBrace = matchingBraceOffset(masked, openBrace);

  if (closeBrace === null) {
    return null;
  }

  const start = lineStartOffset(source, method.memberStartOffset);
  const end = removalEndIncludingTrailingNewline(source, closeBrace + 1);

  return { end, start };
}

function matchingBraceOffset(masked: string, openOffset: number): number | null {
  let depth = 0;

  for (let index = openOffset; index < masked.length; index += 1) {
    const character = masked[index];

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character !== "}") {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
}

/** Offset of the first character of the line containing `offset`. */
function lineStartOffset(source: string, offset: number): number {
  const newlineIndex = source.lastIndexOf("\n", offset - 1);

  return newlineIndex < 0 ? 0 : newlineIndex + 1;
}

/**
 * Extends a removal end offset to also swallow a single trailing newline (and
 * any blank-line whitespace up to it), so deleting the statement does not leave
 * an empty line behind.
 */
function removalEndIncludingTrailingNewline(
  source: string,
  end: number,
): number {
  let index = end;

  while (index < source.length && (source[index] === " " || source[index] === "\t")) {
    index += 1;
  }

  if (source[index] === "\r") {
    index += 1;
  }

  if (source[index] === "\n") {
    index += 1;
  }

  return index;
}

function unusedImportDiagnostics(source: string): PhpInspectionDiagnostic[] {
  return phpUnusedClassImports(source).map((unused) => {
    const start = offsetToLineCharacter(source, unused.start);
    const end = offsetToLineCharacter(source, unused.end);

    return {
      character: start.character,
      endCharacter: end.character,
      endLine: end.line,
      kind: "unused-import",
      line: start.line,
      message: `Unused import ${unused.label}.`,
      severity: "warning",
      unnecessary: true,
    };
  });
}

function unusedPrivateMethodDiagnostics(
  source: string,
): PhpInspectionDiagnostic[] {
  return findUnusedPrivateMethods(source).map((method) =>
    buildUnusedMethodDiagnostic(source, method),
  );
}

/**
 * Shared analysis behind both the unused-private-method diagnostic and the
 * remove quick-fix: returns every CLASS-level `private function` that is never
 * referenced statically, or `[]` when the inspection is suppressed for the
 * whole class (dynamic dispatch present, no candidates, or not a class).
 */
function findUnusedPrivateMethods(source: string): PhpMethodMember[] {
  const structure = parsePhpClassStructure(source);

  // Only plain / abstract classes participate. Interfaces have no bodies to
  // call from; trait methods are reached from the using class (out of file);
  // enum cases / methods are likewise externally reachable.
  if (structure.kind !== "class" && structure.kind !== "abstract-class") {
    return [];
  }

  const privateMethods = structure.methods.filter(isCandidatePrivateMethod);

  if (privateMethods.length === 0) {
    return [];
  }

  const masked = maskStringsKeepingCallableNames(source);

  // A class with any dynamic dispatch could reach a private method by a name we
  // cannot resolve statically - suppress the whole inspection for it.
  if (hasDynamicDispatch(masked)) {
    return [];
  }

  // A class that ADOPTS a trait (`use SomeTrait;` inside the class body) can
  // have its private methods invoked from that trait's code, which lives in
  // another file we cannot see. Suppress the whole inspection for such a class
  // - a cheap, safe over-keep (false negative) that avoids deleting a method
  // the trait relies on.
  if (hasTraitAdoption(source)) {
    return [];
  }

  return privateMethods.filter(
    (method) => !isMethodReferenced(masked, source, method.name),
  );
}

/**
 * True when the source contains a `use ...;` statement INSIDE a brace block
 * (i.e. a trait adoption inside a class body), as opposed to a top-level import.
 * Scanned over the brace-matching mask so a `use` inside a string / comment /
 * heredoc / attribute never triggers it. Conservative: any nested `use` counts,
 * even `use A, B;` or `use T { ... }` trait-conflict-resolution forms.
 */
function hasTraitAdoption(source: string): boolean {
  const masked = maskPhpForBraceMatching(source);
  const pattern = /(^|[;{}\s])use\b[^;{]*[;{]/g;

  for (const match of masked.matchAll(pattern)) {
    const useKeywordOffset = (match.index ?? 0) + match[1].length;

    if (braceDepthAt(masked, useKeywordOffset) > 0) {
      return true;
    }
  }

  return false;
}

function braceDepthAt(masked: string, offset: number): number {
  let depth = 0;

  for (let index = 0; index < offset && index < masked.length; index += 1) {
    const character = masked[index];

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth = Math.max(0, depth - 1);
    }
  }

  return depth;
}

function isCandidatePrivateMethod(method: PhpMethodMember): boolean {
  return (
    method.visibility === "private" &&
    !method.isAbstract &&
    !MAGIC_METHOD_PATTERN.test(method.name)
  );
}

function buildUnusedMethodDiagnostic(
  source: string,
  method: PhpMethodMember,
): PhpInspectionDiagnostic {
  const nameOffset = source.indexOf(method.name, method.declarationOffset);
  const start = offsetToLineCharacter(
    source,
    nameOffset < 0 ? method.declarationOffset : nameOffset,
  );

  return {
    character: start.character,
    endCharacter: start.character + method.name.length,
    endLine: start.line,
    kind: "unused-private-method",
    line: start.line,
    message: `Unused private method "${method.name}".`,
    severity: "warning",
    unnecessary: true,
  };
}

/**
 * True when `name` is referenced as a method anywhere in `masked` other than at
 * its own declaration. Checks the structural call forms (`->name(`, `::name(`)
 * plus the string-callable form (`'name'` / `"name"`), the latter against the
 * ORIGINAL source because the masked source has blanked string interiors.
 *
 * Declarations (`function name(`) are excluded so a method never counts as
 * calling itself.
 */
function isMethodReferenced(
  masked: string,
  source: string,
  name: string,
): boolean {
  const escaped = escapeRegExp(name);

  // `->name(` or `::name(`, but NOT `->$name`/`::$name` (handled by the dynamic
  // guard) and NOT the `function name(` declaration.
  const callPattern = new RegExp(
    `(?:->|::)\\s*${escaped}\\s*\\(`,
  );

  if (callPattern.test(masked)) {
    return true;
  }

  // String callable: `[$this, 'name']`, `'name'` passed to a callable slot, or
  // a `@method`/closure reference. Matched against the original source so the
  // quoted name survives (it is blanked in `masked`). Conservative: any quoted
  // occurrence of the bare name keeps the method.
  const stringCallablePattern = new RegExp(
    `(['"])${escaped}\\1`,
  );

  return stringCallablePattern.test(source);
}

function hasDynamicDispatch(masked: string): boolean {
  return DYNAMIC_DISPATCH_PATTERNS.some((pattern) => pattern.test(masked));
}

/**
 * Masks string and comment INTERIORS (so a method name inside a comment is not
 * mistaken for a call) while preserving newlines for stable line math. String
 * delimiters are kept so the callable-name check against the original source
 * still finds quoted names; this helper is used only for the structural
 * call/dynamic checks.
 */
function maskStringsKeepingCallableNames(source: string): string {
  let output = "";
  let quote: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] || "";
    const next = source[index + 1] || "";

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

    if (character === "#" && next !== "[" && source[index - 1] !== "$") {
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

    if (character === "'" || character === '"' || character === "`") {
      output += character;
      quote = character;
      continue;
    }

    output += character;
  }

  return output;
}

/**
 * Masks string literals, comments, heredocs and attribute blocks (replacing
 * their contents with spaces, newlines preserved) so a `{` / `}` appearing
 * inside them is never counted when balancing a method body. Self-contained
 * copy of the domain masking strategy, kept local to this module's write-scope.
 */
function maskPhpForBraceMatching(source: string): string {
  let output = "";
  let quote: string | null = null;
  let heredocTerminator: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  let attributeDepth = 0;

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

    if (attributeDepth > 0) {
      if (character === "[") {
        attributeDepth += 1;
      }

      if (character === "]") {
        attributeDepth -= 1;
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

    if (character === "#" && next === "[") {
      output += "  ";
      index += 1;
      attributeDepth = 1;
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

function offsetToLineCharacter(
  source: string,
  offset: number,
): { character: number; line: number } {
  let line = 0;
  let lineStart = 0;

  for (let index = 0; index < offset && index < source.length; index += 1) {
    if (source[index] !== "\n") {
      continue;
    }

    line += 1;
    lineStart = index + 1;
  }

  return {
    character: offset - lineStart,
    line,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
