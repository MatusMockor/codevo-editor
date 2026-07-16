/**
 * Pure Latte (Nette) SYNTAX primitives - the counterpart of the Blade helpers
 * (`innermostBladeEchoSpanAt`, `bladeForeachLoopBindingsAt`,
 * `parseBladeForeachCollection`) that the application layer will consume to make
 * `{$var->}` member completion, `{foreach}` loop-variable typing and
 * `{varType}` / `{parameters}` variable resolution work in `.latte` templates.
 *
 * Everything here is PURE: no filesystem, no async, no shared state. Each entry
 * point is a single bounded pass over the source string. There is deliberately
 * no `lastIndexOf` back-scanning with a decrementing bound (the source of a real
 * Blade infinite loop) and no unbounded regex that could straddle a whole
 * document - every tag scan advances the cursor by at least one character, every
 * string/close search stops at the end of the current line or the end of the
 * document, and every parser guards its input length before running a lazy
 * regex.
 *
 * MASKING: the tag scanner respects the contexts where Latte does NOT parse a
 * `{...}` construct - `{* comment *}` and `{syntax off}...{/syntax}` bodies are
 * skipped, and `{l}` / `{r}` literal-brace escapes never yield an expression
 * span. `<script>` / `<style>` blocks are intentionally NOT masked: Latte parses
 * tags there too, and member completion inside a Latte tag in a script block is
 * legitimate. A JS/CSS brace such as `{foo: 1}` is rejected structurally because
 * `foo` is not on the tag-name allowlist (mirroring the Shiki grammar).
 */

import { latteReceiverMemberCompletionAt } from "./latteReceiverExpression";

/**
 * Fixed allowlist of Latte tag names - the single source of truth for the
 * domain layer. `latteNavigation.ts` re-exports this list as `LATTE_TAGS`
 * rather than carrying its own copy, so the two can never drift from each
 * other. It is KEPT IN SYNC with `LATTE_TAG_NAMES` in
 * `src/infrastructure/grammars/latteGrammar.ts` (the Shiki highlighting
 * grammar) by `latteNavigation.test.ts`'s drift test - it is intentionally
 * duplicated there rather than imported so this pure domain module carries no
 * dependency on the highlighter infrastructure layer. If you add a Latte tag
 * to the grammar, add it here too (and vice versa).
 */
export const LATTE_TAG_NAMES: string[] = [
  "if",
  "elseif",
  "else",
  "ifset",
  "elseifset",
  "ifchanged",
  "switch",
  "case",
  "default",
  "foreach",
  "for",
  "while",
  "first",
  "last",
  "sep",
  "iterateWhile",
  "var",
  "varType",
  "varPrint",
  "parameters",
  "templateType",
  "templatePrint",
  "capture",
  "include",
  "includeblock",
  "sandbox",
  "extends",
  "layout",
  "import",
  "embed",
  "block",
  "define",
  "contentType",
  "spaceless",
  "syntax",
  "dump",
  "debugbreak",
  "l",
  "r",
  "link",
  "plink",
  "control",
  "snippet",
  "snippetArea",
  "cache",
  "form",
  "formContainer",
  "formContext",
  "formPrint",
  "label",
  "input",
  "inputError",
  "translate",
  "_",
  "php",
  "do",
];

const LATTE_TAG_NAME_SET = new Set(LATTE_TAG_NAMES);
const LATTE_TAG_NAME_HEAD = /^[A-Za-z_][A-Za-z0-9_]*/;
const LATTE_SYNTAX_OFF = /^\{syntax\s+off\s*\}/;
const LATTE_SYNTAX_CLOSE = "{/syntax}";

export const LATTE_N_ATTRIBUTE_EXPRESSION_NAMES: readonly string[] = [
  "n:attr",
  "n:class",
  "n:elseif",
  "n:for",
  "n:foreach",
  "n:if",
  "n:ifchanged",
  "n:ifset",
  "n:inner-foreach",
  "n:inner-if",
  "n:show",
  "n:tag",
  "n:tag-if",
  "n:while",
];

const LATTE_N_ATTRIBUTE_EXPRESSION_NAME_SET = new Set(
  LATTE_N_ATTRIBUTE_EXPRESSION_NAMES,
);

/** The kinds of variable declarations a `.latte` template can carry inline. */
export type LatteVariableDeclarationKind =
  | "var"
  | "default"
  | "varType"
  | "parameters"
  | "templateType";

const LATTE_DECLARATION_KINDS = new Set<string>([
  "var",
  "default",
  "varType",
  "parameters",
  "templateType",
]);

/**
 * A resolved Latte expression tag around a cursor offset. `expressionStart` is
 * where the PHP-like expression begins (after the tag keyword + whitespace, at
 * the `$` of a `{$var}` echo, or after the `=` of a `{= expr}` echo);
 * `contentEnd` is the offset of the closing `}` (or the end of the line / the
 * document when the tag is left unclosed while typing).
 */
export interface LatteExpressionSpan {
  contentEnd: number;
  contentStart: number;
  expressionStart: number;
  openBrace: number;
  tagName: string | null;
}

/** A `{foreach}` / `n:foreach` binding enclosing an offset. */
export interface LatteForeachLoopBinding {
  collectionExpression: string;
  keyVariableName: string | null;
  loopVariableName: string;
}

/**
 * A bounded variable-root receiver expression used as a foreach collection.
 * `expression` preserves the complete trimmed Latte source, including method
 * arguments and array offsets, for synthetic PHP type resolution.
 */
export interface LatteForeachCollection {
  expression: string;
  rootVariableName: string;
}

/** One inline Latte variable declaration with its type / expression / offset. */
export interface LatteVariableDeclaration {
  expression: string | null;
  kind: LatteVariableDeclarationKind;
  offset: number;
  typeName: string | null;
  variableName: string | null;
}

/**
 * Conservative static list of Latte 3 built-in filters (for `|filter`
 * completion). Sorted, de-duplicated. Version-specific / non-core names that the
 * design brief listed but that are NOT real Latte 3 filters are deliberately
 * omitted: `count` (use `length`) and `slug` (use `webalize`).
 */
export const LATTE_BUILTIN_FILTERS: readonly string[] = [
  "batch",
  "breakLines",
  "bytes",
  "capitalize",
  "ceil",
  "clamp",
  "dataStream",
  "date",
  "escapeUrl",
  "explode",
  "first",
  "firstUpper",
  "floor",
  "group",
  "implode",
  "indent",
  "join",
  "last",
  "length",
  "localDate",
  "lower",
  "nl2br",
  "noescape",
  "number",
  "padLeft",
  "padRight",
  "query",
  "random",
  "repeat",
  "replace",
  "replaceRE",
  "reverse",
  "round",
  "slice",
  "sort",
  "spaceless",
  "split",
  "stripHtml",
  "striptags",
  "substr",
  "translate",
  "trim",
  "truncate",
  "upper",
  "webalize",
];

interface LatteTagToken {
  contentEnd: number;
  contentStart: number;
  expressionStart: number;
  isClosing: boolean;
  openBrace: number;
  tagName: string | null;
}

/** The kind of Latte construct a masked region is - see `LatteMaskedRegion`. */
export type LatteMaskedRegionKind = "comment" | "syntaxOff";

/**
 * A masked Latte region - a `{* comment *}` or `{syntax off}...{/syntax}`
 * block - where Latte does not parse `{...}` macros. `start` is the offset of
 * the opening `{`; `end` is one past the closing delimiter, or `source.length`
 * when `closed` is false (an unterminated region runs to the end of the
 * source). See `collectLatteMaskedRegions`.
 */
export interface LatteMaskedRegion {
  closed: boolean;
  end: number;
  kind: LatteMaskedRegionKind;
  start: number;
}

/**
 * Returns the innermost Latte expression tag containing `offset`, or `null` when
 * the offset is not inside a tag where a PHP-like expression is written
 * (plain HTML, a `{* comment *}`, a `{syntax off}` body, a `{l}` / `{r}`
 * literal, a closing `{/...}` tag, or a JS/CSS object brace). This is the gate
 * the application layer checks before running `{$var->}` member completion.
 */
export function innermostLatteExpressionSpanAt(
  source: string,
  offset: number,
): LatteExpressionSpan | null {
  const clamped = Math.max(0, Math.min(offset, source.length));

  return innermostLatteExpressionSpanFromTags(collectLatteTags(source, clamped), clamped);
}

function innermostLatteExpressionSpanFromTags(
  tags: readonly LatteTagToken[],
  clamped: number,
): LatteExpressionSpan | null {
  for (let index = tags.length - 1; index >= 0; index -= 1) {
    const tag = tags[index];

    if (clamped < tag.contentStart || clamped > tag.contentEnd) {
      continue;
    }

    if (tag.isClosing) {
      return null;
    }

    if (tag.tagName === "l" || tag.tagName === "r") {
      return null;
    }

    return {
      contentEnd: tag.contentEnd,
      contentStart: tag.contentStart,
      expressionStart: tag.expressionStart,
      openBrace: tag.openBrace,
      tagName: tag.tagName,
    };
  }

  return null;
}

export interface LatteNAttributeExpressionSpan {
  attributeName: string;
  contentEnd: number;
  expressionStart: number;
}

export function innermostLatteNAttributeExpressionSpanAt(
  source: string,
  offset: number,
): LatteNAttributeExpressionSpan | null {
  const clamped = Math.max(0, Math.min(offset, source.length));

  return innermostLatteNAttributeExpressionSpanFromMaskedRegions(
    source,
    collectLatteMaskedRegions(source, clamped),
    clamped,
  );
}

function innermostLatteNAttributeExpressionSpanFromMaskedRegions(
  source: string,
  maskedRegions: readonly LatteMaskedRegion[],
  clamped: number,
): LatteNAttributeExpressionSpan | null {
  if (isOffsetInsideLatteMaskedRegion(maskedRegions, clamped)) {
    return null;
  }

  return latteNAttributeExpressionInHtmlAt(source, maskedRegions, clamped);
}

/**
 * The innermost Latte expression context around an offset - either a `{...}`
 * expression tag or an `n:if="..."`-style attribute value. See
 * `innermostLatteExpressionContextAt`.
 */
export type LatteExpressionContext =
  | { kind: "tag"; span: LatteExpressionSpan }
  | { kind: "nAttribute"; span: LatteNAttributeExpressionSpan };

/**
 * Combined entry point over `innermostLatteExpressionSpanAt` and
 * `innermostLatteNAttributeExpressionSpanAt` that runs the underlying
 * `scanLatteSource` pass ONCE and reuses it for both lookups (tag first,
 * n-attribute as the fallback), exactly matching the sequential result of the
 * two separate calls. The application layer's expression detection uses this
 * so a completion / definition request costs a single document scan instead of
 * two; callers that need only one of the lookups keep using the specific
 * functions.
 */
export function innermostLatteExpressionContextAt(
  source: string,
  offset: number,
): LatteExpressionContext | null {
  const clamped = Math.max(0, Math.min(offset, source.length));
  const scan = scanLatteSource(source, clamped);
  const span = innermostLatteExpressionSpanFromTags(scan.tags, clamped);

  if (span) {
    return { kind: "tag", span };
  }

  const attribute = innermostLatteNAttributeExpressionSpanFromMaskedRegions(
    source,
    scan.maskedRegions,
    clamped,
  );

  if (!attribute) {
    return null;
  }

  return { kind: "nAttribute", span: attribute };
}

/**
 * The PHP-like expression of a Latte tag, cleaned for type inference: the raw
 * expression text with its trailing `|filter` chain removed.
 */
export function latteExpressionPhpSource(
  source: string,
  span: LatteExpressionSpan,
): string {
  return stripLatteFilterChain(source.slice(span.expressionStart, span.contentEnd));
}

/**
 * Removes a trailing Latte `|filter|filter:arg` chain from a PHP-like
 * expression, cutting at the first top-level `|` that introduces a filter. A
 * `||` logical-or operator, a `|` inside a string, a `|` inside brackets, and a
 * bitwise `|` not followed by an identifier are all preserved.
 */
export function stripLatteFilterChain(expression: string): string {
  const length = expression.length;
  let depth = 0;
  let quote: string | null = null;
  let index = 0;

  while (index < length) {
    const char = expression[index];

    if (quote) {
      if (char === "\\") {
        index += 2;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      index += 1;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      index += 1;
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      index += 1;
      continue;
    }

    if (char === ")" || char === "]" || char === "}") {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }

    if (char === "|" && depth === 0) {
      if (expression[index + 1] === "|") {
        index += 2;
        continue;
      }

      if (isFilterNameStart(expression, index + 1)) {
        return expression.slice(0, index).trim();
      }
    }

    index += 1;
  }

  return expression.trim();
}

/**
 * Returns the loop bindings of every `{foreach}` block and `n:foreach` /
 * `n:inner-foreach` attribute still enclosing `offset`, outermost first.
 *
 * `{foreach}...{else}...{/foreach}`: the `{else}` branch belongs to the loop, so
 * it never closes the binding - only `{/foreach}` pops. This is an intentional
 * OVER-approximation: real Latte only renders `{else}` when the collection was
 * empty, so the loop variable never actually held a value there, but tracking
 * "did iteration happen" would need runtime information this pure static
 * primitive does not have. Offering the binding anyway is conservative for
 * completion (harmless - it just means member completion is available in a
 * branch where, at runtime, it would not be) and keeps the scope tracking
 * simple. A foreach whose header is still being typed (its closing `}` is at
 * or past the offset) does not yet declare a loop variable.
 *
 * `n:foreach` / `n:inner-foreach` scope DECISION: a precise HTML-element scope
 * (matching the bearing element's close tag) needs an HTML parser and is out of
 * scope for this pure phase-1 primitive. The binding is instead scoped from the
 * end of the attribute value to the end of the document - an intentional
 * OVER-approximation that is conservative for completion (offering a loop
 * variable slightly too broadly is harmless; type resolution still requires the
 * collection to resolve) and never mis-parses markup. Tightening the scope to
 * the real element boundary is a documented follow-up.
 */
export function latteForeachLoopBindingsAt(
  source: string,
  offset: number,
): LatteForeachLoopBinding[] {
  const clamped = Math.max(0, Math.min(offset, source.length));
  const scoped: Array<LatteForeachLoopBinding & { openOffset: number }> = [];

  for (const tag of collectLatteTags(source, clamped)) {
    if (tag.tagName !== "foreach") {
      continue;
    }

    if (tag.isClosing) {
      scoped.pop();
      continue;
    }

    if (tag.contentEnd >= clamped) {
      // Offset is within (or before) the foreach header: the body has not
      // started yet, so no loop variable is in scope here.
      continue;
    }

    const header = parseLatteForeachHeader(
      source.slice(tag.expressionStart, tag.contentEnd),
    );

    if (!header) {
      continue;
    }

    scoped.push({ ...header, openOffset: tag.openBrace });
  }

  const combined = [...scoped, ...collectNAttrForeachBindings(source, clamped)];

  combined.sort((left, right) => left.openOffset - right.openOffset);

  return combined.map((binding) => ({
    collectionExpression: binding.collectionExpression,
    keyVariableName: binding.keyVariableName,
    loopVariableName: binding.loopVariableName,
  }));
}

const LATTE_FOREACH_SENTINEL = "__codevo_latte_foreach_collection";

/**
 * Parses a complete variable-root receiver/postfix expression. The receiver
 * parser owns the structural bounds and rejects malformed or dynamic chains;
 * the canonical comparison ensures its matched root covers the whole input.
 */
export function parseLatteForeachCollection(
  expression: string,
): LatteForeachCollection | null {
  const trimmed = expression.trim();

  if (!trimmed) {
    return null;
  }

  const probe = `${trimmed}->${LATTE_FOREACH_SENTINEL}`;
  const completion = latteReceiverMemberCompletionAt(probe, probe.length);

  if (
    !completion ||
    completion.prefix !== LATTE_FOREACH_SENTINEL ||
    completion.memberSpan.start !== trimmed.length + 2
  ) {
    return null;
  }

  if (
    canonicalLatteReceiver(trimmed) !==
    canonicalLatteReceiver(completion.receiverExpression)
  ) {
    return null;
  }

  if (!hasPlausibleLatteForeachPostfixContents(trimmed)) {
    return null;
  }

  return {
    expression: trimmed,
    rootVariableName: completion.variableName,
  };
}

function canonicalLatteReceiver(expression: string): string {
  let canonical = "";
  let index = 0;

  while (index < expression.length) {
    const char = expression[index] ?? "";

    if (char === "'" || char === '"') {
      const quote = char;
      const start = index;
      index += 1;

      while (index < expression.length) {
        if (expression[index] === "\\") {
          index += 2;
          continue;
        }

        if (expression[index] === quote) {
          index += 1;
          break;
        }

        index += 1;
      }

      canonical += expression.slice(start, index);
      continue;
    }

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (expression.startsWith("/*", index)) {
      const end = expression.indexOf("*/", index + 2);
      index = end < 0 ? expression.length : end + 2;
      continue;
    }

    if (expression.startsWith("//", index) || char === "#") {
      const end = expression.indexOf("\n", index + 1);
      index = end < 0 ? expression.length : end + 1;
      continue;
    }

    if (expression.startsWith("?->", index)) {
      canonical += "->";
      index += 3;
      continue;
    }

    canonical += char;
    index += 1;
  }

  return canonical;
}

function hasPlausibleLatteForeachPostfixContents(expression: string): boolean {
  let index = 1;

  while (/[A-Za-z0-9_]/.test(expression[index] ?? "")) {
    index += 1;
  }

  while (index < expression.length) {
    index = skipLatteForeachTrivia(expression, index);

    if (index < 0) {
      return false;
    }

    if (expression[index] === "[") {
      const end = latteForeachBalancedEnd(expression, index);

      if (
        end === null ||
        !hasPlausibleLatteForeachOffset(expression, index + 1, end - 1)
      ) {
        return false;
      }

      index = end;
      continue;
    }

    const operatorLength = expression.startsWith("?->", index)
      ? 3
      : expression.startsWith("->", index)
        ? 2
        : 0;

    if (operatorLength === 0) {
      return index === expression.length;
    }

    index = skipLatteForeachTrivia(expression, index + operatorLength);

    if (index < 0 || !/[A-Za-z_]/.test(expression[index] ?? "")) {
      return false;
    }

    index += 1;

    while (/[A-Za-z0-9_]/.test(expression[index] ?? "")) {
      index += 1;
    }

    const callStart = skipLatteForeachTrivia(expression, index);

    if (callStart < 0) {
      return false;
    }

    if (expression[callStart] !== "(") {
      continue;
    }

    const callEnd = latteForeachBalancedEnd(expression, callStart);

    if (
      callEnd === null ||
      !hasPlausibleLatteForeachArguments(
        expression,
        callStart + 1,
        callEnd - 1,
      )
    ) {
      return false;
    }

    index = callEnd;
  }

  return true;
}

function hasPlausibleLatteForeachOffset(
  source: string,
  start: number,
  end: number,
): boolean {
  const parts = latteForeachTopLevelParts(source, start, end);

  return (
    parts !== null &&
    !parts.sawComma &&
    parts.parts.length === 1 &&
    isPlausibleLatteForeachPart(parts.parts[0] ?? "") &&
    !(parts.parts[0] ?? "").includes("=>")
  );
}

function hasPlausibleLatteForeachArguments(
  source: string,
  start: number,
  end: number,
): boolean {
  const result = latteForeachTopLevelParts(source, start, end);

  if (!result) {
    return false;
  }

  if (!result.sawComma) {
    const onlyPart = result.parts[0] ?? "";

    return onlyPart.length === 0 || isPlausibleLatteForeachPart(onlyPart);
  }

  const requiredParts = result.parts.slice(0, -1);
  const finalPart = result.parts[result.parts.length - 1] ?? "";

  return (
    requiredParts.every(isPlausibleLatteForeachPart) &&
    (finalPart.length === 0 || isPlausibleLatteForeachPart(finalPart))
  );
}

function isPlausibleLatteForeachPart(part: string): boolean {
  return (
    part.length > 0 &&
    !part.startsWith(":") &&
    !part.startsWith("=>") &&
    !part.endsWith(":")
  );
}

function latteForeachTopLevelParts(
  source: string,
  start: number,
  end: number,
): { parts: string[]; sawComma: boolean } | null {
  const parts: string[] = [];
  const delimiters: string[] = [];
  let currentPart = "";
  let index = start;
  let sawComma = false;

  while (index < end) {
    const char = source[index] ?? "";

    if (char === "'" || char === '"') {
      const stringEnd = latteForeachQuotedEnd(source, index, char);

      if (stringEnd < 0 || stringEnd > end) {
        return null;
      }

      if (delimiters.length === 0) {
        currentPart += "value";
      }

      index = stringEnd;
      continue;
    }

    const triviaEnd = skipLatteForeachTrivia(source, index);

    if (triviaEnd < 0) {
      return null;
    }

    if (triviaEnd !== index) {
      index = Math.min(triviaEnd, end);
      continue;
    }

    const closing = latteForeachClosingDelimiter(char);

    if (closing) {
      if (delimiters.length === 0) {
        currentPart += "value";
      }

      delimiters.push(closing);
      index += 1;
      continue;
    }

    if (")]}".includes(char) && delimiters[delimiters.length - 1] === char) {
      delimiters.pop();
      index += 1;
      continue;
    }

    if (delimiters.length === 0 && char === ";") {
      return null;
    }

    if (delimiters.length === 0 && char === ",") {
      parts.push(currentPart);
      currentPart = "";
      sawComma = true;
      index += 1;
      continue;
    }

    if (delimiters.length === 0 && !/\s/.test(char)) {
      currentPart += char;
    }

    index += 1;
  }

  parts.push(currentPart);

  return { parts, sawComma };
}

function latteForeachBalancedEnd(source: string, start: number): number | null {
  const firstClosing = latteForeachClosingDelimiter(source[start] ?? "");

  if (!firstClosing) {
    return null;
  }

  const delimiters = [firstClosing];
  let index = start + 1;

  while (index < source.length) {
    const char = source[index] ?? "";

    if (char === "'" || char === '"') {
      const stringEnd = latteForeachQuotedEnd(source, index, char);

      if (stringEnd < 0) {
        return null;
      }

      index = stringEnd;
      continue;
    }

    const triviaEnd = skipLatteForeachTrivia(source, index);

    if (triviaEnd < 0) {
      return null;
    }

    if (triviaEnd !== index) {
      index = triviaEnd;
      continue;
    }

    const closing = latteForeachClosingDelimiter(char);

    if (closing) {
      delimiters.push(closing);
      index += 1;
      continue;
    }

    if (!")]}".includes(char) || delimiters[delimiters.length - 1] !== char) {
      index += 1;
      continue;
    }

    delimiters.pop();
    index += 1;

    if (delimiters.length === 0) {
      return index;
    }
  }

  return null;
}

function skipLatteForeachTrivia(source: string, start: number): number {
  let index = start;

  while (index < source.length) {
    if (/\s/.test(source[index] ?? "")) {
      index += 1;
      continue;
    }

    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);

      if (end < 0) {
        return -1;
      }

      index = end + 2;
      continue;
    }

    if (source.startsWith("//", index) || source[index] === "#") {
      const end = source.indexOf("\n", index + 1);
      index = end < 0 ? source.length : end + 1;
      continue;
    }

    break;
  }

  return index;
}

function latteForeachQuotedEnd(
  source: string,
  start: number,
  quote: string,
): number {
  let index = start + 1;

  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }

    if (source[index] === quote) {
      return index + 1;
    }

    index += 1;
  }

  return -1;
}

function latteForeachClosingDelimiter(char: string): string | null {
  if (char === "(") {
    return ")";
  }

  if (char === "[") {
    return "]";
  }

  if (char === "{") {
    return "}";
  }

  return null;
}

/**
 * Extracts every inline variable declaration in the template: `{var}`,
 * `{default}`, `{varType}`, `{parameters}` (each possibly declaring several
 * comma-separated variables) and `{templateType}`. Declarations inside comments
 * and `{syntax off}` blocks are skipped. Named `latteVariableDeclarations`
 * (not `...At`) because it is offset-independent - it scans the whole source.
 */
export function latteVariableDeclarations(
  source: string,
): LatteVariableDeclaration[] {
  const declarations: LatteVariableDeclaration[] = [];

  for (const tag of collectLatteTags(source)) {
    if (tag.isClosing || !tag.tagName || !LATTE_DECLARATION_KINDS.has(tag.tagName)) {
      continue;
    }

    const content = source.slice(tag.expressionStart, tag.contentEnd);

    declarations.push(
      ...parseLatteDeclarationContent(
        tag.tagName as LatteVariableDeclarationKind,
        content,
        tag.openBrace,
      ),
    );
  }

  return declarations;
}

// --- internal helpers -------------------------------------------------------

interface LatteHtmlAttributeValue {
  end: number;
  name: string;
  quoted: boolean;
  start: number;
}

interface LatteHtmlStartTag {
  attributes: LatteHtmlAttributeValue[];
  end: number;
}

function latteNAttributeExpressionInHtmlAt(
  source: string,
  maskedRegions: readonly LatteMaskedRegion[],
  offset: number,
): LatteNAttributeExpressionSpan | null {
  let index = 0;

  while (index <= offset && index < source.length) {
    if (source.startsWith("<!--", index)) {
      const close = source.indexOf("-->", index + 4);

      if (close < 0) {
        return null;
      }

      index = close + 3;
      continue;
    }

    if (source[index] !== "<") {
      index += 1;
      continue;
    }

    const tag = scanLatteHtmlStartTagAt(source, index);

    if (!tag) {
      index += 1;
      continue;
    }

    if (offset > tag.end) {
      index = tag.end + 1;
      continue;
    }

    for (const attribute of tag.attributes) {
      if (offset < attribute.start || offset > attribute.end) {
        continue;
      }

      if (isOffsetInsideLatteMaskedRegion(maskedRegions, attribute.start)) {
        return null;
      }

      if (LATTE_N_ATTRIBUTE_EXPRESSION_NAME_SET.has(attribute.name)) {
        if (!attribute.quoted) {
          return null;
        }

        return {
          attributeName: attribute.name,
          contentEnd: attribute.end,
          expressionStart: attribute.start,
        };
      }

      if (attribute.name !== "n:name") {
        return null;
      }

      const value = source.slice(attribute.start, attribute.end);

      if (!hasLatteVariableReference(value)) {
        return null;
      }

      return {
        attributeName: attribute.name,
        contentEnd: attribute.end,
        expressionStart: attribute.start,
      };
    }

    return null;
  }

  return null;
}

function scanLatteHtmlStartTagAt(
  source: string,
  tagStart: number,
): LatteHtmlStartTag | null {
  let index = tagStart + 1;

  if (!/[A-Za-z]/.test(source[index] ?? "")) {
    return null;
  }

  while (/[A-Za-z0-9:_-]/.test(source[index] ?? "")) {
    index += 1;
  }

  const attributes: LatteHtmlAttributeValue[] = [];

  while (index < source.length) {
    index = skipHtmlWhitespace(source, index);

    if (source[index] === ">") {
      return { attributes, end: index };
    }

    if (source[index] === "/" && source[index + 1] === ">") {
      return { attributes, end: index + 1 };
    }

    const nameStart = index;

    while (isHtmlAttributeNameCharacter(source[index] ?? "")) {
      index += 1;
    }

    if (index === nameStart) {
      return { attributes: [], end: malformedHtmlTagEnd(source, index) };
    }

    const name = source.slice(nameStart, index);
    index = skipHtmlWhitespace(source, index);

    if (source[index] !== "=") {
      continue;
    }

    index = skipHtmlWhitespace(source, index + 1);
    const quote = source[index];

    if (quote === '"' || quote === "'") {
      const valueStart = index + 1;
      const valueEnd = quotedHtmlAttributeValueEnd(source, valueStart, quote);

      if (valueEnd === null) {
        return { attributes: [], end: malformedHtmlTagEnd(source, valueStart) };
      }

      attributes.push({ end: valueEnd, name, quoted: true, start: valueStart });
      index = valueEnd + 1;
      continue;
    }

    const valueStart = index;
    const valueEnd = unquotedHtmlAttributeValueEnd(source, valueStart);

    if (valueEnd === null) {
      return { attributes: [], end: malformedHtmlTagEnd(source, valueStart) };
    }

    if (valueEnd === valueStart) {
      return { attributes: [], end: malformedHtmlTagEnd(source, valueStart) };
    }

    attributes.push({ end: valueEnd, name, quoted: false, start: valueStart });
    index = valueEnd;
  }

  return { attributes: [], end: source.length };
}

function skipHtmlWhitespace(source: string, from: number): number {
  let index = from;

  while (/\s/.test(source[index] ?? "")) {
    index += 1;
  }

  return index;
}

function isHtmlAttributeNameCharacter(character: string): boolean {
  return character !== "" && !/[\s=/>]/.test(character);
}

function quotedHtmlAttributeValueEnd(
  source: string,
  valueStart: number,
  quote: string,
): number | null {
  for (let index = valueStart; index < source.length; index += 1) {
    const character = source[index];

    if (character === quote) {
      return index;
    }

    if (character === "\n") {
      return null;
    }
  }

  return null;
}

function unquotedHtmlAttributeValueEnd(
  source: string,
  valueStart: number,
): number | null {
  for (let index = valueStart; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (/\s|>/.test(character)) {
      return index;
    }

    if (character === '"' || character === "'" || character === "<") {
      return null;
    }
  }

  return source.length;
}

function malformedHtmlTagEnd(source: string, from: number): number {
  const close = source.indexOf(">", from);

  if (close < 0) {
    return source.length;
  }

  return close;
}

function hasLatteVariableReference(value: string): boolean {
  let quote: string | null = null;
  let index = 0;

  while (index < value.length) {
    const char = value[index];

    if (quote) {
      if (char === "\\") {
        index += 2;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      index += 1;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      index += 1;
      continue;
    }

    if (char === "$" && /[A-Za-z_]/.test(value[index + 1] ?? "")) {
      return true;
    }

    index += 1;
  }

  return false;
}

function isOffsetInsideLatteMaskedRegion(
  regions: readonly LatteMaskedRegion[],
  offset: number,
): boolean {
  return regions.some(
    (region) =>
      offset > region.start && (offset < region.end || !region.closed),
  );
}

/**
 * Scans `source` once (up to `untilOffset`) and returns every Latte tag token in
 * order, skipping `{* comment *}` and `{syntax off}` masked regions. Each `{`
 * either opens a recognised tag (echo, named, or closing) or is stepped over; the
 * cursor always advances, so the scan is bounded.
 */
function collectLatteTags(
  source: string,
  untilOffset: number = source.length,
): LatteTagToken[] {
  return scanLatteSource(source, untilOffset).tags;
}

/**
 * Scans `source` once (up to `untilOffset`) and returns every masked region -
 * `{* comment *}` and `{syntax off}...{/syntax}` - in document order.
 *
 * This is the SAME single-pass, quote-aware traversal `collectLatteTags` uses,
 * so it is the one place that decides "is this `{` a real comment/syntax-off
 * opener". Two properties fall out of sharing that traversal rather than
 * re-scanning independently (as `latteNavigation.ts` used to):
 *
 *   - a `{*` or `{syntax off}` sitting inside a quoted string argument of a
 *     tag (e.g. `{$path . '{*'}`) is consumed as part of that tag's own
 *     quote-aware close scan and never mistaken for a mask opener;
 *   - masked regions compose correctly when nested - a `{syntax off}` marker
 *     written inside a `{* comment *}` is never independently re-opened as its
 *     own (falsely unclosed) block, because the comment's close-search jumps
 *     the cursor straight to `*}`, and the inner text is never visited as a
 *     `{` position in its own right.
 *
 * `latteNavigation.ts` (a sibling pure domain module) imports this directly
 * instead of carrying its own copy of the masking logic - see
 * `isInsideLatteComment` there.
 */
export function collectLatteMaskedRegions(
  source: string,
  untilOffset: number = source.length,
): LatteMaskedRegion[] {
  return scanLatteSource(source, untilOffset).maskedRegions;
}

interface LatteSourceScan {
  maskedRegions: LatteMaskedRegion[];
  tags: LatteTagToken[];
}

function scanLatteSource(source: string, untilOffset: number): LatteSourceScan {
  const tags: LatteTagToken[] = [];
  const maskedRegions: LatteMaskedRegion[] = [];
  const length = source.length;
  let index = 0;

  while (index < length) {
    if (index > untilOffset) {
      break;
    }

    if (source[index] !== "{") {
      index += 1;
      continue;
    }

    const mask = nextLatteMaskRegion(source, index);

    if (mask) {
      maskedRegions.push({
        closed: mask.closed,
        end: mask.end,
        kind: mask.kind,
        start: index,
      });
      index = mask.end > index ? mask.end : index + 1;
      continue;
    }

    const tag = scanLatteTagAt(source, index);

    if (!tag) {
      index += 1;
      continue;
    }

    tags.push(tag);
    const next = tag.contentEnd + 1;
    index = next > tag.openBrace ? next : tag.openBrace + 1;
  }

  return { maskedRegions, tags };
}

interface LatteMaskRegionMatch {
  closed: boolean;
  end: number;
  kind: LatteMaskedRegionKind;
}

/**
 * If a masked region (`{* comment *}` or `{syntax off}...{/syntax}`) starts at
 * `index`, returns its kind, whether it was actually closed, and the offset
 * just past it (`source.length` when unterminated - an unterminated region
 * runs to the end of the source); otherwise `null`. The whole region
 * (including its opening tag) is masked so an offset inside it yields no tag.
 */
function nextLatteMaskRegion(source: string, index: number): LatteMaskRegionMatch | null {
  if (source[index] === "{" && source[index + 1] === "*") {
    const end = source.indexOf("*}", index + 2);
    const closed = end >= 0;

    return { closed, end: closed ? end + 2 : source.length, kind: "comment" };
  }

  const window = source.slice(index, index + 40);
  const syntaxOff = LATTE_SYNTAX_OFF.exec(window);

  if (!syntaxOff) {
    return null;
  }

  const bodyStart = index + syntaxOff[0].length;
  const close = source.indexOf(LATTE_SYNTAX_CLOSE, bodyStart);
  const closed = close >= 0;

  return {
    closed,
    end: closed ? close + LATTE_SYNTAX_CLOSE.length : source.length,
    kind: "syntaxOff",
  };
}

/**
 * Parses the Latte tag opening at `index` (`source[index]` is `{`) into a token,
 * or `null` when `{` does not open a recognised tag (unknown name, JS/CSS
 * object, lone brace). A tag opens on `{$`, `{=`, `{/`, or `{name` where `name`
 * is on the allowlist.
 */
function scanLatteTagAt(source: string, index: number): LatteTagToken | null {
  let cursor = index + 1;
  let isClosing = false;

  if (source[cursor] === "/") {
    isClosing = true;
    cursor += 1;
  }

  const head = source[cursor];

  if (head === undefined) {
    return null;
  }

  if (!isClosing && (head === "$" || head === "=")) {
    const contentEnd = findLatteTagClose(source, index + 1);
    const expressionStart =
      head === "=" ? skipInlineWhitespace(source, cursor + 1) : cursor;

    return {
      contentEnd,
      contentStart: index + 1,
      expressionStart,
      isClosing: false,
      openBrace: index,
      tagName: null,
    };
  }

  if (isClosing && head === "}") {
    return {
      contentEnd: cursor,
      contentStart: index + 1,
      expressionStart: cursor,
      isClosing: true,
      openBrace: index,
      tagName: null,
    };
  }

  const nameMatch = LATTE_TAG_NAME_HEAD.exec(source.slice(cursor, cursor + 64));

  if (!nameMatch || !LATTE_TAG_NAME_SET.has(nameMatch[0])) {
    return null;
  }

  const name = nameMatch[0];
  const contentEnd = findLatteTagClose(source, index + 1);

  return {
    contentEnd,
    contentStart: index + 1,
    expressionStart: skipInlineWhitespace(source, cursor + name.length),
    isClosing,
    openBrace: index,
    tagName: name,
  };
}

/**
 * Returns the offset of the closing `}` of a tag whose content starts at `from`,
 * skipping over single-line string literals so a `}` inside a quote does not end
 * the tag, and tracking `{`/`}` nesting depth so an inline type such as a
 * PHPStan/Psalm array shape (`array{id: int}` in `{varType array{id: int}
 * $row}`) does not truncate the tag at its own inner `}` - only a `}` that
 * brings the depth back to zero closes the tag. Stops at the end of the line
 * (`\n`) or the document when no balancing `}` is present, so an unclosed tag
 * never leaks into following lines (hang-safety: still a single bounded,
 * strictly-advancing pass).
 */
function findLatteTagClose(source: string, from: number): number {
  const length = source.length;
  let index = from;
  let quote: string | null = null;
  let depth = 0;

  while (index < length) {
    const char = source[index];

    if (char === "\n") {
      return index;
    }

    if (quote) {
      if (char === "\\") {
        index += 2;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      index += 1;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      index += 1;
      continue;
    }

    if (char === "{") {
      depth += 1;
      index += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) {
        return index;
      }

      depth -= 1;
      index += 1;
      continue;
    }

    index += 1;
  }

  return length;
}

function skipInlineWhitespace(source: string, from: number): number {
  let index = from;

  while (source[index] === " " || source[index] === "\t") {
    index += 1;
  }

  return index;
}

function isFilterNameStart(source: string, from: number): boolean {
  let index = from;

  while (source[index] === " " || source[index] === "\t") {
    index += 1;
  }

  const char = source[index];

  if (char === undefined) {
    return false;
  }

  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || char === "_";
}

const LATTE_FOREACH_HEADER =
  /^(.+?)\s+as\s+(?:\$([A-Za-z_][A-Za-z0-9_]*)\s*=>\s*)?\$([A-Za-z_][A-Za-z0-9_]*)\s*$/;

/**
 * Parses a foreach header (`$collection as $item` or `$c as $k => $v`) into its
 * parts, or `null` when it is not a well-formed header. Guards the input length
 * before the lazy regex so a pathologically long single line cannot backtrack.
 */
function parseLatteForeachHeader(
  header: string,
): LatteForeachLoopBinding | null {
  const trimmed = header.trim();

  if (trimmed.length === 0 || trimmed.length > 500) {
    return null;
  }

  const match = LATTE_FOREACH_HEADER.exec(trimmed);

  if (!match) {
    return null;
  }

  return {
    collectionExpression: match[1].trim(),
    keyVariableName: match[2] ?? null,
    loopVariableName: match[3],
  };
}

const LATTE_N_FOREACH =
  /\bn:(?:inner-)?foreach\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/**
 * Collects `n:foreach` / `n:inner-foreach` bindings whose scope (from the end of
 * the attribute value to the end of the document, per the documented decision)
 * encloses `offset`.
 */
function collectNAttrForeachBindings(
  source: string,
  offset: number,
): Array<LatteForeachLoopBinding & { openOffset: number }> {
  const bindings: Array<LatteForeachLoopBinding & { openOffset: number }> = [];

  LATTE_N_FOREACH.lastIndex = 0;

  for (
    let match = LATTE_N_FOREACH.exec(source);
    match !== null;
    match = LATTE_N_FOREACH.exec(source)
  ) {
    const valueEnd = match.index + match[0].length;

    if (LATTE_N_FOREACH.lastIndex === match.index) {
      LATTE_N_FOREACH.lastIndex += 1;
    }

    if (valueEnd > offset) {
      continue;
    }

    const header = parseLatteForeachHeader(match[1] ?? match[2] ?? "");

    if (!header) {
      continue;
    }

    bindings.push({ ...header, openOffset: match.index });
  }

  return bindings;
}

const LATTE_TYPED_VARIABLE =
  /^(.*?)\s*\$([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*([\s\S]+))?$/;
const LATTE_VAR_ASSIGNMENT =
  /^\$([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*([\s\S]+))?$/;

function parseLatteDeclarationContent(
  kind: LatteVariableDeclarationKind,
  content: string,
  offset: number,
): LatteVariableDeclaration[] {
  if (kind === "templateType") {
    const typeName = content.trim();

    if (typeName.length === 0) {
      return [];
    }

    return [{ expression: null, kind, offset, typeName, variableName: null }];
  }

  if (kind === "varType") {
    return parseLatteTypedParts(content, kind, offset);
  }

  if (kind === "parameters") {
    return parseLatteTypedParts(content, kind, offset);
  }

  return splitTopLevel(content, ",")
    .map((part) => parseLatteVarAssignment(part, kind, offset))
    .filter((declaration): declaration is LatteVariableDeclaration =>
      declaration !== null,
    );
}

function parseLatteTypedParts(
  content: string,
  kind: LatteVariableDeclarationKind,
  offset: number,
): LatteVariableDeclaration[] {
  return splitTopLevel(content, ",", { trackAngleBrackets: true })
    .map((part) => parseLatteTypedPart(part, kind, offset))
    .filter((declaration): declaration is LatteVariableDeclaration =>
      declaration !== null,
    );
}

function parseLatteTypedPart(
  part: string,
  kind: LatteVariableDeclarationKind,
  offset: number,
): LatteVariableDeclaration | null {
  if (part.length === 0 || part.length > 500) {
    return null;
  }

  const match = LATTE_TYPED_VARIABLE.exec(part);

  if (!match) {
    return null;
  }

  const typeName = match[1].trim();

  return {
    expression: match[3]?.trim() ?? null,
    kind,
    offset,
    typeName: typeName.length > 0 ? typeName : null,
    variableName: match[2],
  };
}

function parseLatteVarAssignment(
  part: string,
  kind: LatteVariableDeclarationKind,
  offset: number,
): LatteVariableDeclaration | null {
  if (part.length === 0 || part.length > 500) {
    return null;
  }

  const match = LATTE_VAR_ASSIGNMENT.exec(part);

  if (!match) {
    return null;
  }

  return {
    expression: match[2]?.trim() ?? null,
    kind,
    offset,
    typeName: null,
    variableName: match[1],
  };
}

interface SplitTopLevelOptions {
  /**
   * Track `<`/`>` nesting depth as a THIRD bracket kind, in addition to the
   * quote/`()`/`[]`/`{}` tracking every caller gets. Only safe where the text
   * being split is a TYPE position (`{varType}` / `{parameters}` content) -
   * `<`/`>` are also comparison operators in a general PHP-like expression, so
   * this is opt-in and, even when on, angle-tracking is suspended once a `$`
   * is seen (the type portion of a declaration always precedes its variable),
   * so a comparison in a default-value expression is never mistaken for a
   * generic.
   */
  trackAngleBrackets?: boolean;
}

/**
 * Splits `text` on top-level occurrences of `delimiter`, ignoring delimiters
 * inside string literals or `()` / `[]` / `{}` groups (and, with
 * `trackAngleBrackets`, a `Type<...>` generic's `<>` group before the `$`).
 * Trims parts and drops empty ones. Bounded single pass.
 */
function splitTopLevel(
  text: string,
  delimiter: string,
  options: SplitTopLevelOptions = {},
): string[] {
  const parts: string[] = [];
  const length = text.length;
  let depth = 0;
  let angleDepth = 0;
  let seenVariable = false;
  let quote: string | null = null;
  let start = 0;
  let index = 0;

  while (index < length) {
    const char = text[index];

    if (quote) {
      if (char === "\\") {
        index += 2;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      index += 1;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      index += 1;
      continue;
    }

    if (char === "$" && !seenVariable) {
      seenVariable = true;
      // A well-formed generic (`Collection<int, Product> $items`) always
      // closes its `<>` before the variable marker. Reaching `$` with
      // `angleDepth` still open means the "generic" theory was wrong (a
      // stray `<` with no matching `>`, most likely a typo) - abandon it
      // rather than let it keep suppressing top-level commas for the rest of
      // the text. No-op for the well-formed case, where `angleDepth` is
      // already back to 0 by the time `$` is reached.
      angleDepth = 0;
    }

    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      index += 1;
      continue;
    }

    if (char === ")" || char === "]" || char === "}") {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }

    if (options.trackAngleBrackets && !seenVariable && char === "<") {
      angleDepth += 1;
      index += 1;
      continue;
    }

    if (options.trackAngleBrackets && !seenVariable && char === ">" && angleDepth > 0) {
      angleDepth -= 1;
      index += 1;
      continue;
    }

    if (char === delimiter && depth === 0 && angleDepth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
      seenVariable = false;
      index += 1;
      continue;
    }

    index += 1;
  }

  parts.push(text.slice(start));

  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}
