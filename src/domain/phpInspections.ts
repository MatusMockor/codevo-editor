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

export type PhpInspectionKind =
  | "unused-import"
  | "unused-private-method"
  | "unused-variable";

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
 *  - `[$this, $x]` / `[self::class, $x]` variable callable method name
 *  - `->{`  /  `::{`                    dynamic member expression
 */
const DYNAMIC_DISPATCH_PATTERNS: readonly RegExp[] = [
  /->\s*\$[A-Za-z_]/,
  /::\s*\$[A-Za-z_]/,
  /\bcall_user_func(?:_array)?\b/,
  /\[\s*(?:\$this|(?:self|static|[A-Za-z_\\][A-Za-z0-9_\\]*)::class)\s*,\s*\$[A-Za-z_]/,
  /\bmethod_exists\s*\([^,]+,\s*\$[A-Za-z_]/,
  /->\s*\{/,
  /::\s*\{/,
];

export function phpInspectionDiagnostics(
  source: string,
): PhpInspectionDiagnostic[] {
  return [
    ...unusedImportDiagnostics(source),
    ...unusedPrivateMethodDiagnostics(source),
    ...unusedVariableDiagnostics(source),
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
 * The unused-variable removal whose assignment statement covers `offset` (a
 * cursor anywhere on the `$x = ...;` line), or `null` when the cursor is not on
 * a side-effect-FREE unused variable assignment. Used by the "Remove unused
 * variable" quick-fix.
 *
 * Conservative on TWO axes: (1) only variables the inspection itself reports as
 * unused are candidates, and (2) of those only assignments whose right-hand
 * side is a simple literal (`5`, `'str'`, `[]`, `true`, `null`, ...) get a
 * removal - any call / member access / non-trivial expression has a potential
 * side effect, so removing it would change behaviour and NO quick-fix is
 * offered (the warning alone stands).
 */
export function phpUnusedVariableRemovalAt(
  source: string,
  offset: number,
): PhpUnusedSymbolRemoval | null {
  for (const unused of findUnusedVariables(source)) {
    if (offset < unused.nameOffset || offset > unused.statementEnd) {
      continue;
    }

    if (!unused.removable) {
      return null;
    }

    return {
      ...unusedVariableRemovalSpan(source, unused),
      label: unused.name,
    };
  }

  return null;
}

/**
 * Whitespace-aware removal span for a side-effect-free unused assignment.
 *
 * CRITICAL correctness: an assignment may share its physical line with an
 * EARLIER statement (`$a = 1; $x = 5;`). Deleting the whole line there would
 * destroy `$a = 1;` (live, possibly side-effecting code) - the exact corruption
 * this inspection must never cause. So the start is the line start ONLY when
 * everything from the line start to the variable is whitespace (the assignment
 * owns its line); otherwise the start is the variable itself, with the single
 * space before it consumed so the surviving preceding statement keeps clean
 * spacing. The trailing newline is swallowed only in the own-the-line case, so
 * a following same-line statement keeps its position.
 */
function unusedVariableRemovalSpan(
  source: string,
  unused: UnusedVariable,
): { end: number; start: number } {
  const lineStart = lineStartOffset(source, unused.nameOffset);
  const ownsLineStart = /^[ \t]*$/.test(
    source.slice(lineStart, unused.nameOffset),
  );
  const trailing = restOfLineAfter(source, unused.statementEnd);

  // The assignment is the ONLY statement on its physical line: delete the whole
  // line including its leading indentation and trailing newline (no dangling
  // blank line).
  if (ownsLineStart && trailing.isBlank) {
    return {
      end: removalEndIncludingTrailingNewline(source, unused.statementEnd),
      start: lineStart,
    };
  }

  // A statement trails on the same line (`    $x = 5; return 1;`): keep the
  // line's leading indentation (it becomes the trailing statement's indent) and
  // delete the assignment plus the separating whitespace after its `;`, so the
  // surviving statement lands cleanly at the original indentation.
  if (ownsLineStart) {
    return { end: trailing.nextStatementOffset, start: unused.nameOffset };
  }

  // A statement precedes on the same line (`$a = 1; $x = 5;`): delete only the
  // assignment, absorbing the whitespace immediately before the variable so the
  // surviving preceding statement keeps clean spacing.
  let start = unused.nameOffset;

  while (
    start > lineStart &&
    (source[start - 1] === " " || source[start - 1] === "\t")
  ) {
    start -= 1;
  }

  return { end: unused.statementEnd, start };
}

/**
 * Inspects the remainder of the physical line after `offset` (just past a
 * statement's `;`). `isBlank` is true when only whitespace remains before the
 * newline / end of input. `nextStatementOffset` is where the next on-line
 * statement begins (used to swallow the inter-statement whitespace when the
 * line is NOT blank); it equals `offset` when blank.
 */
function restOfLineAfter(
  source: string,
  offset: number,
): { isBlank: boolean; nextStatementOffset: number } {
  let index = offset;

  while (index < source.length && (source[index] === " " || source[index] === "\t")) {
    index += 1;
  }

  if (index >= source.length || source[index] === "\n" || source[index] === "\r") {
    return { isBlank: true, nextStatementOffset: offset };
  }

  return { isBlank: false, nextStatementOffset: index };
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
 * plus conservatively recognizable callable string/array forms, the latter
 * against a comment-masked source so a quoted name in a comment does not keep a
 * dead method alive.
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

  return isMethodReferencedByCallableString(source, escaped);
}

function isMethodReferencedByCallableString(
  source: string,
  escapedName: string,
): boolean {
  const searchable = maskCommentsKeepingAllStrings(source);
  const receiver =
    String.raw`\$this|(?:self|static|[A-Za-z_\\][A-Za-z0-9_\\]*)::class`;
  const quotedName = String.raw`(['"])${escapedName}\1`;

  // Array callable: `[$this, 'name']`, `[self::class, 'name']`,
  // `[Foo::class, 'name']`.
  if (
    new RegExp(String.raw`\[\s*(?:${receiver})\s*,\s*${quotedName}\s*\]`).test(
      searchable,
    )
  ) {
    return true;
  }

  // Static callable string: `'self::name'`, `'static::name'`,
  // `'Foo::name'`, including namespaced class names.
  if (
    new RegExp(
      String.raw`(['"])(?:self|static|[A-Za-z_\\][A-Za-z0-9_\\]*)::${escapedName}\1`,
    ).test(searchable)
  ) {
    return true;
  }

  // Reflection/introspection references often exist specifically to reach a
  // private method by name.
  return new RegExp(
    String.raw`\b(?:method_exists|new\s+\\?ReflectionMethod)\s*\(\s*(?:${receiver})\s*,\s*${quotedName}`,
  ).test(searchable);
}

function hasDynamicDispatch(masked: string): boolean {
  return DYNAMIC_DISPATCH_PATTERNS.some((pattern) => pattern.test(masked));
}

/**
 * One conservatively-detected unused local variable binding in a
 * function/method body whose `$name` is never referenced again anywhere in that
 * body (in code or string interpolation). Assignment bindings may be removable
 * when their RHS is safe; foreach bindings are warning-only.
 */
interface UnusedVariable {
  /** Character offset of the `$` of the assignment-target variable. */
  nameOffset: number;
  /** Variable token including the leading `$`, e.g. `$x`. */
  name: string;
  /**
   * True when the right-hand side is a side-effect-free simple literal, so a
   * "Remove unused variable" quick-fix is safe. False for any call / member
   * access / non-trivial expression - warning only, no auto-remove.
   */
  removable: boolean;
  /**
   * Character offset (exclusive) of the end of the assignment statement (the
   * position just past its terminating `;`), used for the removal span.
   */
  statementEnd: number;
}

function unusedVariableDiagnostics(
  source: string,
): PhpInspectionDiagnostic[] {
  return findUnusedVariables(source).map((variable) => {
    const start = offsetToLineCharacter(source, variable.nameOffset);

    return {
      character: start.character,
      endCharacter: start.character + variable.name.length,
      endLine: start.line,
      kind: "unused-variable",
      line: start.line,
      message: `Unused variable "${variable.name}".`,
      severity: "warning",
      unnecessary: true,
    };
  });
}

/**
 * Names that are NEVER reported as unused even when they appear assigned but
 * unread: `$this`, the PHP superglobals, and `$GLOBALS`. Assigning to a
 * superglobal is intentional even if the function does not read it back.
 */
const NEVER_UNUSED_VARIABLES: ReadonlySet<string> = new Set([
  "$this",
  "$GLOBALS",
  "$_GET",
  "$_POST",
  "$_REQUEST",
  "$_SERVER",
  "$_SESSION",
  "$_COOKIE",
  "$_ENV",
  "$_FILES",
  "$http_response_header",
  "$argc",
  "$argv",
]);

/**
 * Patterns that, if present ANYWHERE in a function body, make unused-variable
 * analysis unsafe for that ENTIRE body - the body is skipped (no warnings).
 * Each introduces a way a variable can be read or created that a simple
 * "is `$x` mentioned again?" scan cannot see:
 *  - `extract(`            creates locals from an array at runtime
 *  - `compact(`            reads locals by name from string args
 *  - `$$x` / `${`          variable variables (read/write via a dynamic name)
 *  - `eval(`               arbitrary code that can read/write any local
 *  - `get_defined_vars(`   reflects over every local
 */
const SCOPE_SUPPRESSING_PATTERNS: readonly RegExp[] = [
  /\bextract\s*\(/,
  /\bcompact\s*\(/,
  /\$\$[A-Za-z_]/,
  /\$\{/,
  /\beval\s*\(/,
  /\bget_defined_vars\s*\(/,
];

/**
 * Shared analysis behind the unused-variable diagnostic and its remove
 * quick-fix. Returns every conservatively-detected unused local across all
 * function/method bodies in the file, or `[]` when nothing qualifies.
 *
 * ULTRA-conservative: any uncertainty about whether a variable is read drops
 * the candidate (a missed warning is always preferred over a false positive
 * that a Remove quick-fix could turn into corruption).
 */
function findUnusedVariables(source: string): UnusedVariable[] {
  const structural = maskStringsKeepingDelimiters(source);
  const interpolated = maskCommentsKeepingInterpolatedStrings(source);
  const bodies = findFunctionBodies(structural);
  const results: UnusedVariable[] = [];

  for (const body of bodies) {
    collectUnusedVariablesInBody(
      structural,
      interpolated,
      body,
      nestedBodiesFor(body, bodies),
      results,
    );
  }

  return results;
}

/** A function/method body span: offsets of its opening and closing braces. */
interface FunctionBodySpan {
  closeBrace: number;
  openBrace: number;
  /**
   * Offset of the `(` opening the parameter list, so the parameter list (which
   * may contain `&$ref` by-ref params or default values) can be scanned for the
   * by-ref guard and excluded from the assignment scan.
   */
  paramOpen: number;
}

/**
 * Finds every `function` body in the masked source by locating each `function`
 * keyword, its parameter list, and the brace-balanced `{ ... }` that follows.
 * Abstract / interface declarations (`function foo();`) have no body and are
 * skipped. Bodies are returned in source order; nested closures are reported as
 * their own bodies. The variable scan masks nested bodies while inspecting the
 * outer scope, so closure locals do not leak into their parent, but closure
 * `use (...)` clauses remain visible as outer-scope reads.
 */
function findFunctionBodies(masked: string): FunctionBodySpan[] {
  const bodies: FunctionBodySpan[] = [];
  const pattern = /\bfunction\b/g;

  for (const match of masked.matchAll(pattern)) {
    const keywordOffset = match.index ?? 0;
    const paramOpen = masked.indexOf("(", keywordOffset);

    if (paramOpen < 0) {
      continue;
    }

    const paramClose = matchingPairOffset(masked, paramOpen, "(", ")");

    if (paramClose === null) {
      continue;
    }

    const openBrace = nextBodyBrace(masked, paramClose + 1);

    if (openBrace === null) {
      continue;
    }

    const closeBrace = matchingBraceOffset(masked, openBrace);

    if (closeBrace === null) {
      continue;
    }

    bodies.push({ closeBrace, openBrace, paramOpen });
  }

  return bodies;
}

/**
 * From just after a function's `)` , returns the offset of the body's opening
 * `{`, or `null` when no body follows before the statement-terminating `;`
 * (an abstract / interface method declaration) or before another `{`/`}`
 * structural token. Skips the optional return-type annotation (`: Foo`, even
 * union / nullable / `\Fully\Qualified`) that may sit between `)` and `{`.
 */
function nextBodyBrace(masked: string, from: number): number | null {
  for (let index = from; index < masked.length; index += 1) {
    const character = masked[index];

    if (character === "{") {
      return index;
    }

    if (character === ";" || character === "}") {
      return null;
    }
  }

  return null;
}

function matchingPairOffset(
  masked: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  let depth = 0;

  for (let index = openOffset; index < masked.length; index += 1) {
    const character = masked[index];

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

function nestedBodiesFor(
  body: FunctionBodySpan,
  bodies: readonly FunctionBodySpan[],
): FunctionBodySpan[] {
  return bodies.filter(
    (candidate) =>
      candidate.openBrace > body.openBrace &&
      candidate.closeBrace < body.closeBrace,
  );
}

function maskNestedBodyRanges(
  source: string,
  nestedBodies: readonly FunctionBodySpan[],
): string {
  if (nestedBodies.length === 0) {
    return source;
  }

  const characters = source.split("");

  for (const body of nestedBodies) {
    for (let index = body.openBrace; index <= body.closeBrace; index += 1) {
      characters[index] = characters[index] === "\n" ? "\n" : " ";
    }
  }

  return characters.join("");
}

/**
 * Scans a single function body for unused locals and appends them to `results`.
 * The whole body is skipped (no warnings) when it contains any
 * scope-suppressing construct (extract/compact/variable-variables/eval/...),
 * the most important false-positive guard.
 */
function collectUnusedVariablesInBody(
  structural: string,
  interpolated: string,
  body: FunctionBodySpan,
  nestedBodies: readonly FunctionBodySpan[],
  results: UnusedVariable[],
): void {
  const currentScopeStructural = maskNestedBodyRanges(
    structural,
    nestedBodies,
  );
  const currentScopeInterpolated = maskNestedBodyRanges(
    interpolated,
    nestedBodies,
  );
  const bodyText = currentScopeStructural.slice(
    body.openBrace,
    body.closeBrace + 1,
  );

  if (SCOPE_SUPPRESSING_PATTERNS.some((pattern) => pattern.test(bodyText))) {
    return;
  }

  const byRefNames = collectByRefNames(currentScopeStructural, body);

  for (const binding of findVariableBindings(currentScopeStructural, body)) {
    if (NEVER_UNUSED_VARIABLES.has(binding.name)) {
      continue;
    }

    if (byRefNames.has(binding.name)) {
      continue;
    }

    if (
      isVariableReadInBody(
        currentScopeStructural,
        currentScopeInterpolated,
        body,
        binding.name,
        binding.nameOffset,
      )
    ) {
      continue;
    }

    results.push(binding);
  }
}

interface AssignmentSite {
  name: string;
  nameOffset: number;
  removable: boolean;
  statementEnd: number;
}

function findVariableBindings(
  structural: string,
  body: FunctionBodySpan,
): AssignmentSite[] {
  return [
    ...findAssignments(structural, body),
    ...findDestructuringAssignments(structural, body),
    ...findForeachBindings(structural, body),
  ];
}

/**
 * Every top-level simple-assignment target `$name = ...;` inside a body. Only
 * the FIRST `$name` on a statement (the assignment target) is considered, and
 * only when the assignment is a plain `=` (not `==`, `===`, `=>`, `+=`, ...) and
 * not a by-reference assignment (`$name = &...`). Compound / destructuring /
 * augmented forms are skipped (conservative).
 */
function findAssignments(
  structural: string,
  body: FunctionBodySpan,
): AssignmentSite[] {
  const assignments: AssignmentSite[] = [];
  const region = structural.slice(body.openBrace + 1, body.closeBrace);
  const base = body.openBrace + 1;
  // `$name` (capture), optional ws, a single `=` NOT followed by `=` or `>`,
  // and NOT preceded by an operator char (so `+=`, `.=`, `==` never match).
  const pattern = /\$[A-Za-z_][A-Za-z0-9_]*/g;

  for (const match of region.matchAll(pattern)) {
    const name = match[0];
    const localOffset = match.index ?? 0;
    const nameOffset = base + localOffset;
    const afterName = base + localOffset + name.length;

    const assignment = readSimpleAssignment(structural, body, afterName);

    if (!assignment) {
      continue;
    }

    if (!isAssignmentTarget(structural, body, nameOffset)) {
      continue;
    }

    assignments.push({
      name,
      nameOffset,
      removable: assignment.removable,
      statementEnd: assignment.statementEnd,
    });
  }

  return assignments;
}

/**
 * Simple `[$a, $b] = ...;` and `list($a, $b) = ...;` targets. These are
 * warning-only bindings: they behave like assignments for diagnostics, but
 * quick-fixing one target out of a destructuring statement is intentionally out
 * of scope for this lightweight inspection.
 */
function findDestructuringAssignments(
  structural: string,
  body: FunctionBodySpan,
): AssignmentSite[] {
  const bindings: AssignmentSite[] = [];
  const region = structural.slice(body.openBrace + 1, body.closeBrace);
  const base = body.openBrace + 1;

  for (const match of region.matchAll(/\blist\s*\(|\[/g)) {
    const start = base + (match.index ?? 0);
    const listParen = structural.slice(start, start + 4).toLowerCase() === "list";

    if (!isStatementStartLike(structural, body, start)) {
      continue;
    }

    const openOffset = listParen ? structural.indexOf("(", start) : start;
    const closeOffset = matchingPairOffset(
      structural,
      openOffset,
      listParen ? "(" : "[",
      listParen ? ")" : "]",
    );

    if (closeOffset === null || closeOffset > body.closeBrace) {
      continue;
    }

    const assignment = readDestructuringAssignmentAfter(
      structural,
      body,
      closeOffset + 1,
    );

    if (!assignment) {
      continue;
    }

    bindings.push(
      ...readDestructuringVariableBindings(
        structural,
        openOffset + 1,
        closeOffset,
        assignment.statementEnd,
      ),
    );
  }

  return bindings;
}

function isStatementStartLike(
  structural: string,
  body: FunctionBodySpan,
  offset: number,
): boolean {
  let index = offset - 1;

  while (index > body.openBrace && isInlineWhitespace(structural[index])) {
    index -= 1;
  }

  return (
    index <= body.openBrace ||
    structural[index] === ";" ||
    structural[index] === "{" ||
    structural[index] === "}" ||
    structural[index] === ":"
  );
}

function readDestructuringAssignmentAfter(
  structural: string,
  body: FunctionBodySpan,
  afterTarget: number,
): { statementEnd: number } | null {
  let index = afterTarget;

  while (index < body.closeBrace && isInlineWhitespace(structural[index])) {
    index += 1;
  }

  if (structural[index] !== "=" || structural[index + 1] === "=" || structural[index + 1] === ">") {
    return null;
  }

  const semicolon = statementSemicolon(structural, index + 1, body.closeBrace);

  return semicolon === null ? null : { statementEnd: semicolon + 1 };
}

function readDestructuringVariableBindings(
  structural: string,
  start: number,
  end: number,
  statementEnd: number,
): AssignmentSite[] {
  const target = structural.slice(start, end);

  if (target.includes("&") || target.includes("->")) {
    return [];
  }

  const bindings: AssignmentSite[] = [];
  const pattern = /\$[A-Za-z_][A-Za-z0-9_]*/g;

  for (const match of target.matchAll(pattern)) {
    const name = match[0];
    const nameOffset = start + (match.index ?? 0);
    const afterName = nextNonWhitespaceOffset(
      structural,
      nameOffset + name.length,
      end,
    );

    if (afterName !== null && structural[afterName] === "[") {
      continue;
    }

    bindings.push({
      name,
      nameOffset,
      removable: false,
      statementEnd,
    });
  }

  return bindings;
}

/**
 * Every simple non-reference `foreach (... as $value)` or
 * `foreach (... as $key => $value)` binding inside a body. These are
 * warning-only because deleting or rewriting a foreach binding safely would
 * require broader control-flow and syntax transforms than this lightweight
 * inspection owns.
 */
function findForeachBindings(
  structural: string,
  body: FunctionBodySpan,
): AssignmentSite[] {
  const bindings: AssignmentSite[] = [];
  const region = structural.slice(body.openBrace + 1, body.closeBrace);
  const base = body.openBrace + 1;
  const pattern = /\bforeach\b/g;

  for (const match of region.matchAll(pattern)) {
    const keywordOffset = base + (match.index ?? 0);
    const parenOpen = nextNonWhitespaceOffset(
      structural,
      keywordOffset + "foreach".length,
      body.closeBrace,
    );

    if (parenOpen === null || structural[parenOpen] !== "(") {
      continue;
    }

    const parenClose = matchingPairOffset(structural, parenOpen, "(", ")");

    if (parenClose === null || parenClose > body.closeBrace) {
      continue;
    }

    bindings.push(...readForeachBindings(structural, parenOpen, parenClose));
  }

  return bindings;
}

function readForeachBindings(
  structural: string,
  parenOpen: number,
  parenClose: number,
): AssignmentSite[] {
  const asOffset = topLevelAsOffset(structural, parenOpen + 1, parenClose);

  if (asOffset === null) {
    return [];
  }

  const bindingStart = asOffset + "as".length;
  const arrowOffset = topLevelArrowOffset(structural, bindingStart, parenClose);

  if (arrowOffset === null) {
    return readForeachBindingTargets(
      structural,
      bindingStart,
      parenClose,
    );
  }

  const key = readForeachBindingTargets(structural, bindingStart, arrowOffset);
  const value = readForeachBindingTargets(
    structural,
    arrowOffset + "=>".length,
    parenClose,
  );
  const bindings: AssignmentSite[] = [];

  bindings.push(...key, ...value);

  return bindings;
}

function readForeachBindingTargets(
  structural: string,
  start: number,
  end: number,
): AssignmentSite[] {
  const variable = readForeachVariableBinding(structural, start, end);

  if (variable) {
    return [variable];
  }

  const destructuring = readForeachDestructuringBindings(structural, start, end);

  return destructuring;
}

function readForeachVariableBinding(
  structural: string,
  start: number,
  end: number,
): AssignmentSite | null {
  let index = start;

  while (index < end && isInlineWhitespace(structural[index])) {
    index += 1;
  }

  if (structural[index] === "&") {
    return null;
  }

  const match = /^\$[A-Za-z_][A-Za-z0-9_]*/.exec(structural.slice(index, end));

  if (!match) {
    return null;
  }

  const name = match[0];
  const afterName = index + name.length;

  if (!/^[\s]*$/.test(structural.slice(afterName, end))) {
    return null;
  }

  return {
    name,
    nameOffset: index,
    removable: false,
    statementEnd: afterName,
  };
}

function readForeachDestructuringBindings(
  structural: string,
  start: number,
  end: number,
): AssignmentSite[] {
  let index = start;

  while (index < end && isInlineWhitespace(structural[index])) {
    index += 1;
  }

  const listParen = structural.slice(index, index + 4).toLowerCase() === "list";
  const openOffset = listParen ? structural.indexOf("(", index) : index;
  const open = listParen ? "(" : "[";
  const close = listParen ? ")" : "]";

  if (structural[openOffset] !== open) {
    return [];
  }

  const closeOffset = matchingPairOffset(structural, openOffset, open, close);

  if (closeOffset === null || closeOffset >= end) {
    return [];
  }

  if (!/^[\s]*$/.test(structural.slice(closeOffset + 1, end))) {
    return [];
  }

  return readDestructuringVariableBindings(
    structural,
    openOffset + 1,
    closeOffset,
    closeOffset + 1,
  );
}

function topLevelAsOffset(
  structural: string,
  start: number,
  end: number,
): number | null {
  let depth = 0;

  for (let index = start; index < end; index += 1) {
    const character = structural[index];

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      continue;
    }

    if (
      depth === 0 &&
      structural.slice(index, index + 2).toLowerCase() === "as" &&
      !isIdentifierCharacter(structural[index - 1]) &&
      !isIdentifierCharacter(structural[index + 2])
    ) {
      return index;
    }
  }

  return null;
}

function topLevelArrowOffset(
  structural: string,
  start: number,
  end: number,
): number | null {
  let depth = 0;

  for (let index = start; index < end - 1; index += 1) {
    const character = structural[index];

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      continue;
    }

    if (depth === 0 && character === "=" && structural[index + 1] === ">") {
      return index;
    }
  }

  return null;
}

function nextNonWhitespaceOffset(
  source: string,
  start: number,
  end: number,
): number | null {
  for (let index = start; index < end; index += 1) {
    if (!isInlineWhitespace(source[index])) {
      return index;
    }
  }

  return null;
}

/**
 * True when the `$name` at `nameOffset` is the LEFT-HAND target of its
 * statement (i.e. the first non-whitespace thing on the statement is this
 * variable). Guards against treating a read like `$y = $x;`'s `$x`, or a
 * variable inside an expression, as an assignment target. The statement start
 * is the nearest preceding `;`, `{` or `}` in the structural mask.
 */
function isAssignmentTarget(
  structural: string,
  body: FunctionBodySpan,
  nameOffset: number,
): boolean {
  let index = nameOffset - 1;

  while (index > body.openBrace) {
    const character = structural[index];

    if (character === ";" || character === "{" || character === "}") {
      return true;
    }

    if (character === " " || character === "\t" || character === "\n" || character === "\r") {
      index -= 1;
      continue;
    }

    return false;
  }

  return true;
}

/**
 * Reads the right-hand side of a candidate `$name <here> = <rhs> ;`. Returns
 * `null` when this is not a plain top-level `=` assignment (e.g. `==`, `=>`,
 * `+=`, a by-ref `= &`, or no terminating `;` on the same statement). On
 * success returns the statement end (just past `;`) and whether the RHS is a
 * side-effect-free simple literal (safe to auto-remove).
 */
function readSimpleAssignment(
  structural: string,
  body: FunctionBodySpan,
  afterName: number,
): { removable: boolean; statementEnd: number } | null {
  let index = afterName;

  while (index < body.closeBrace && isInlineWhitespace(structural[index])) {
    index += 1;
  }

  if (structural[index] !== "=") {
    return null;
  }

  const next = structural[index + 1];

  // `==`, `===`, `=>` are not assignments.
  if (next === "=" || next === ">") {
    return null;
  }

  let rhsStart = index + 1;

  while (rhsStart < body.closeBrace && isInlineWhitespace(structural[rhsStart])) {
    rhsStart += 1;
  }

  // `$x = &$y` is a reference alias - never treat as a removable / dead store.
  if (structural[rhsStart] === "&") {
    return null;
  }

  const semicolon = statementSemicolon(structural, rhsStart, body.closeBrace);

  if (semicolon === null) {
    return null;
  }

  const rhs = structural.slice(rhsStart, semicolon).trim();

  return {
    removable: isSideEffectFreeLiteral(rhs),
    statementEnd: semicolon + 1,
  };
}

/**
 * Offset of the `;` that terminates the assignment statement starting at
 * `rhsStart`, found by scanning forward at brace/bracket/paren depth 0. Returns
 * `null` when the statement does not terminate cleanly before the body ends, or
 * when a `{` is encountered at depth 0 (a control-structure body - not a simple
 * assignment), so such forms are skipped.
 */
function statementSemicolon(
  structural: string,
  rhsStart: number,
  limit: number,
): number | null {
  let depth = 0;

  for (let index = rhsStart; index < limit; index += 1) {
    const character = structural[index];

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

    if (character === ";" && depth === 0) {
      return index;
    }
  }

  return null;
}

/**
 * True when an assignment right-hand side is a simple, side-effect-free literal
 * safe to delete: a number, a quoted string (now blanked to a delimiter pair in
 * the structural mask), a bare `[]` empty array, or a keyword literal
 * (`true`/`false`/`null`). Anything containing a call `(`, a member access
 * `->`/`::`, a `new`, an index/property read, or any other token is treated as
 * potentially side-effecting and is NOT removable.
 */
function isSideEffectFreeLiteral(rhs: string): boolean {
  if (rhs === "[]") {
    return true;
  }

  if (/^-?\d[\d_]*(\.\d[\d_]*)?$/.test(rhs)) {
    return true;
  }

  // A string literal is blanked to its two delimiter characters by the
  // structural mask, with the interior collapsed to whitespace in between
  // (e.g. `''`, `'   '`, `""`). Offsets are preserved, so the interior is
  // spaces rather than removed.
  if (/^(['"`])\s*\1$/.test(rhs)) {
    return true;
  }

  if (/^(true|false|null)$/i.test(rhs)) {
    return true;
  }

  return false;
}

/**
 * Collects every variable that is bound by-reference and so must NEVER be
 * reported unused: by-ref parameters (`&$x` in the signature) and `foreach
 * (... as &$v)` loop values. Such a variable mutates an aliased / outer value
 * even when never read locally.
 */
function collectByRefNames(
  structural: string,
  body: FunctionBodySpan,
): Set<string> {
  const names = new Set<string>();
  const paramRegion = structural.slice(body.paramOpen, body.openBrace);

  for (const match of paramRegion.matchAll(/&\s*(\$[A-Za-z_][A-Za-z0-9_]*)/g)) {
    names.add(match[1]);
  }

  const bodyRegion = structural.slice(body.openBrace, body.closeBrace + 1);

  for (const match of bodyRegion.matchAll(
    /\bas\s*&\s*(\$[A-Za-z_][A-Za-z0-9_]*)/g,
  )) {
    names.add(match[1]);
  }

  // `foreach ($a as $k => &$v)` - the value after `=>`.
  for (const match of bodyRegion.matchAll(
    /=>\s*&\s*(\$[A-Za-z_][A-Za-z0-9_]*)/g,
  )) {
    names.add(match[1]);
  }

  return names;
}

/**
 * True when `$name` is referenced anywhere in the body OTHER THAN at its own
 * assignment-target occurrence (`selfOffset`). A reference is:
 *  - any other code occurrence of the exact token in the structural mask, OR
 *  - an occurrence inside a string literal / heredoc body (interpolation), seen
 *    via the interpolation mask (which preserves string interiors).
 *
 * The token is matched on a word boundary that also rejects a longer variable
 * (`$count` must not match inside `$countTotal`).
 */
function isVariableReadInBody(
  structural: string,
  interpolated: string,
  body: FunctionBodySpan,
  name: string,
  selfOffset: number,
): boolean {
  const escaped = escapeRegExp(name);
  // `\$name` not followed by another identifier char (so `$count` != `$countA`)
  // and not preceded by `$` (so `$$name` variable-variable does not match here;
  // that case already suppressed the whole scope).
  const pattern = new RegExp(`(?<![\\$A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "g");

  if (
    hasReferenceOtherThanSelf(structural, body, pattern, selfOffset)
  ) {
    return true;
  }

  pattern.lastIndex = 0;

  // String interpolation: scan the interpolation mask, where string interiors
  // survive. The self assignment's code occurrence is present in BOTH masks at
  // the same offset, so it is excluded here too; any OTHER occurrence (a `$x`
  // inside a string / heredoc, or a later code read) is a genuine use.
  if (hasReferenceOtherThanSelf(interpolated, body, pattern, selfOffset)) {
    return true;
  }

  // Legacy encapsed syntax `${name}` references `$name` without spelling the
  // variable token literally. Keep this check interpolation-only so normal
  // dynamic variables in code remain covered by the scope-suppression guard.
  const bareName = escapeRegExp(name.slice(1));
  const dollarBracePattern = new RegExp(
    String.raw`\$\{\s*${bareName}\s*\}`,
    "g",
  );

  return hasReferenceOtherThanSelf(
    interpolated,
    body,
    dollarBracePattern,
    selfOffset,
  );
}

function hasReferenceOtherThanSelf(
  masked: string,
  body: FunctionBodySpan,
  pattern: RegExp,
  selfOffset: number,
): boolean {
  pattern.lastIndex = body.openBrace;

  let match = pattern.exec(masked);

  while (match && (match.index ?? 0) <= body.closeBrace) {
    if ((match.index ?? 0) !== selfOffset) {
      return true;
    }

    match = pattern.exec(masked);
  }

  return false;
}

function isInlineWhitespace(character: string | undefined): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r"
  );
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/.test(character);
}

/**
 * Offset-preserving mask used for the unused-variable STRUCTURAL scan: blanks
 * the interiors of comments, string literals AND heredoc/nowdoc bodies to
 * spaces (newlines preserved), while keeping the single-character string
 * delimiters (`'`, `"`, `` ` ``) in place so an empty / literal string survives
 * as a `'...'` delimiter pair for the side-effect-free check. A `$x` that
 * appears ONLY inside a string or heredoc therefore does not register as a code
 * read here (it is found by the separate interpolation mask instead).
 */
function maskStringsKeepingDelimiters(source: string): string {
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
        output = output.slice(0, -1) + character;
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

    const heredocStart = heredocOpening(source, index);

    if (heredocStart) {
      output += " ".repeat(heredocStart.length);
      index += heredocStart.length - 1;
      heredocTerminator = heredocStart.terminator;
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
 * Offset-preserving mask used for the unused-variable INTERPOLATION scan:
 * blanks comment interiors and non-interpolating string bodies (single-quoted
 * strings and nowdocs), but keeps double-quoted strings, backticks and heredoc
 * bodies intact. Comments are removed so a `$x` mentioned only in a comment is
 * never treated as a use.
 */
function maskCommentsKeepingInterpolatedStrings(source: string): string {
  let output = "";
  let quote: string | null = null;
  let heredocTerminator: string | null = null;
  let heredocInterpolates = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] || "";
    const next = source[index + 1] || "";

    if (heredocTerminator !== null) {
      const closing = heredocClosingLength(source, index, heredocTerminator);

      if (closing > 0) {
        output += heredocInterpolates
          ? source.slice(index, index + closing)
          : " ".repeat(closing);
        index += closing - 1;
        heredocTerminator = null;
        heredocInterpolates = false;
        continue;
      }

      if (heredocInterpolates && character === "\\" && next === "$") {
        output += "\\ ";
        index += 1;
        continue;
      }

      if (!heredocInterpolates) {
        output += character === "\n" ? "\n" : " ";
        continue;
      }

      output += character;
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
      if (quote === "'") {
        output += character === "\n" ? "\n" : " ";

        if (character === "\\" && next !== "") {
          output += next === "\n" ? "\n" : " ";
          index += 1;
          continue;
        }

        if (character === quote) {
          quote = null;
        }

        continue;
      }

      if (character === "\\" && next === "$") {
        output += "\\ ";
        index += 1;
        continue;
      }

      output += character;

      if (character === "\\" && quote !== "`") {
        output += next;
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

    const heredocStart = heredocOpening(source, index);

    if (heredocStart) {
      output += heredocStart.interpolates
        ? source.slice(index, index + heredocStart.length)
        : " ".repeat(heredocStart.length);
      index += heredocStart.length - 1;
      heredocTerminator = heredocStart.terminator;
      heredocInterpolates = heredocStart.interpolates;
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

function maskCommentsKeepingAllStrings(source: string): string {
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
        output += source.slice(index, index + closing);
        index += closing - 1;
        heredocTerminator = null;
        continue;
      }

      output += character;
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
      output += character;

      if (character === "\\" && quote !== "`") {
        output += next;
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

    const heredocStart = heredocOpening(source, index);

    if (heredocStart) {
      output += source.slice(index, index + heredocStart.length);
      index += heredocStart.length - 1;
      heredocTerminator = heredocStart.terminator;
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
): { interpolates: boolean; length: number; terminator: string } | null {
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

  return {
    interpolates: match[1] !== "'",
    length: match[0].length,
    terminator,
  };
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
