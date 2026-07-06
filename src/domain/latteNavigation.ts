/**
 * Pure detection of Nette Latte constructs for navigation and completion inside
 * `.latte` files.
 *
 * Syntax highlighting is owned by the vendored Latte grammar and is out of scope
 * here. This module answers, for a cursor offset:
 *
 *   1. Is the cursor on a navigable Latte reference — a template file
 *      (`{include 'file.latte'}`, `{layout}`, `{extends}`, `{import}`,
 *      `{embed}`, `{sandbox}`), a block (`{include blockname}`, `{block}`,
 *      `{define}`), or a control (`{control name}`)? — `detectLatteReferenceAt`.
 *   2. Is the cursor typing a Latte tag name after `{` (or `{/`)? — for tag
 *      completion, `detectLatteTagCompletionAt`.
 *   3. Is the cursor inside an `{include '...'}` file literal? — for template
 *      name completion, `detectLatteIncludeCompletionAt`.
 *
 * It is deliberately FILESYSTEM-FREE: it reports the construct, its kind, and its
 * literal name (plus offsets). Mapping a name to concrete file candidates is
 * delegated to `nettePathResolution` (driven by the Nette framework provider);
 * verifying which candidate exists is the integration layer's responsibility.
 *
 * It stays CONSERVATIVE — any ambiguous position resolves to `null`. Latte
 * comments (`{* ... *}`) and `{syntax off}...{/syntax}` blocks are masked so a
 * construct written inside them is never matched. `n:` attributes and
 * `{link}`/`n:href` presenter navigation are intentionally NOT handled here
 * (owned by a later slice).
 *
 * HANG-SAFETY: every scan advances a strictly monotonic index and is bounded
 * (backward scans stop at a newline or a fixed window; masking delegates to
 * `latteSyntax.ts`'s single forward pass, which always advances). No
 * `lastIndexOf` clamping, no open match may run past its line. A malformed or
 * huge document degrades to a single linear pass, never a hang.
 *
 * MASKING: comment / `{syntax off}` detection is NOT re-implemented here - it
 * delegates to `latteSyntax.ts`'s `collectLatteMaskedRegions`, the same
 * quote-aware scan the tag parser uses, so this module cannot silently
 * diverge from what `latteSyntax.ts` treats as masked (see
 * `isInsideLatteComment` below for why an independent scan was unsafe).
 */

import { collectLatteMaskedRegions, LATTE_TAG_NAMES } from "./latteSyntax";
import type { LatteMaskedRegion } from "./latteSyntax";

/**
 * Latte tag names offered for tag completion (https://latte.nette.org/en/tags).
 *
 * Sourced from `latteSyntax.ts`'s `LATTE_TAG_NAMES` - the single allowlist the
 * domain layer maintains - rather than a second hand-kept copy, so this list
 * cannot drift from the tag scanner's own allowlist. That shared list is in
 * turn KEPT IN SYNC with `LATTE_TAG_NAMES` in
 * `src/infrastructure/grammars/latteGrammar.ts` (not exported, so still
 * duplicated there); `latteNavigation.test.ts` guards THAT pair against drift
 * by extracting the grammar's tag alternation and comparing sets.
 */
export const LATTE_TAGS: string[] = [...LATTE_TAG_NAMES];

export type LatteReferenceKind = "template" | "block" | "control";

export interface LatteReference {
  kind: LatteReferenceKind;
  /** The Latte tag that owns the reference, e.g. `include`, `layout`, `block`. */
  tag: string;
  /** The referenced name (template path, block name, or control name). */
  name: string;
  /** Offset of the first character of the name in the source. */
  nameStart: number;
  /** Offset one past the last character of the name in the source. */
  nameEnd: number;
}

export interface LatteTagCompletion {
  /** The tag-name characters already typed after `{` / `{/` (may be empty). */
  prefix: string;
  /** Offset of the `{` that begins the tag being typed. */
  start: number;
}

export interface LatteIncludeCompletion {
  /** The file-taking tag whose literal is being typed (`include`, `layout`, ...). */
  tag: string;
  /** The path characters typed inside the literal so far (may be empty). */
  prefix: string;
  /** Offset of the first character inside the literal. */
  replaceStart: number;
  /** Offset one past the last character of the (possibly partial) literal. */
  replaceEnd: number;
}

/** Bound for the backward scan that finds the macro opening `{` before a cursor. */
const MAX_MACRO_SCAN = 2000;

/** Tags whose argument is a template FILE literal (always quoted). */
const FILE_TAGS: ReadonlySet<string> = new Set([
  "layout",
  "extends",
  "import",
  "embed",
  "sandbox",
]);

/** Bare `{include}` targets that are not navigable named blocks. */
const INCLUDE_RESERVED: ReadonlySet<string> = new Set(["parent", "this"]);

const NO_RESERVED: ReadonlySet<string> = new Set<string>();

/**
 * Returns the navigable Latte reference at `offset`, or `null` when the offset
 * is not on a recognised construct.
 */
export function detectLatteReferenceAt(
  source: string,
  offset: number,
): LatteReference | null {
  if (offset < 0 || offset > source.length) {
    return null;
  }

  if (isInsideAnyLatteMask(source, offset)) {
    return null;
  }

  const macro = enclosingMacroTag(source, offset);

  if (!macro || macro.closing) {
    return null;
  }

  if (FILE_TAGS.has(macro.tag)) {
    const quoted = quotedTemplateReference(
      source,
      offset,
      macro.tag,
      macro.argStart,
    );

    if (quoted) {
      return quoted;
    }

    return bareTemplateReference(source, offset, macro.tag, macro.argStart);
  }

  if (macro.tag === "include") {
    const file = quotedTemplateReference(source, offset, "include", macro.argStart);

    if (file) {
      return file;
    }

    const unquotedFile = bareTemplateReference(
      source,
      offset,
      "include",
      macro.argStart,
    );

    if (unquotedFile) {
      return unquotedFile;
    }

    return bareReference(
      source,
      offset,
      "include",
      macro.argStart,
      INCLUDE_RESERVED,
      "block",
    );
  }

  if (macro.tag === "control") {
    return bareReference(
      source,
      offset,
      "control",
      macro.argStart,
      NO_RESERVED,
      "control",
    );
  }

  if (macro.tag === "block" || macro.tag === "define") {
    return bareReference(
      source,
      offset,
      macro.tag,
      macro.argStart,
      NO_RESERVED,
      "block",
    );
  }

  return null;
}

/**
 * Returns the Latte tag being typed after `{` (or `{/`) at `offset` for tag
 * completion, or `null` when the offset is not at a tag position. Masked inside
 * comments and `{syntax off}` blocks.
 */
export function detectLatteTagCompletionAt(
  source: string,
  offset: number,
): LatteTagCompletion | null {
  if (offset < 1 || offset > source.length) {
    return null;
  }

  if (isInsideAnyLatteMask(source, offset)) {
    return null;
  }

  let index = offset - 1;

  while (index >= 0 && isTagNameChar(source[index] ?? "")) {
    index -= 1;
  }

  if (source[index] === "/") {
    index -= 1;
  }

  if (source[index] !== "{") {
    return null;
  }

  const braceStart = index;
  const prefixStart = source[braceStart + 1] === "/" ? braceStart + 2 : braceStart + 1;

  return { prefix: source.slice(prefixStart, offset), start: braceStart };
}

/**
 * Returns the template-name completion context when `offset` sits inside the
 * quoted literal of a file-taking tag (`include`, `layout`, `extends`,
 * `import`, `embed`, `sandbox`), or `null` otherwise.
 */
export function detectLatteIncludeCompletionAt(
  source: string,
  offset: number,
): LatteIncludeCompletion | null {
  if (offset < 0 || offset > source.length) {
    return null;
  }

  if (isInsideAnyLatteMask(source, offset)) {
    return null;
  }

  const macro = enclosingMacroTag(source, offset);

  if (!macro || macro.closing) {
    return null;
  }

  if (macro.tag !== "include" && !FILE_TAGS.has(macro.tag)) {
    return null;
  }

  const quoteStart = skipSpaces(source, macro.argStart);
  const quote = source[quoteStart] ?? "";

  if (quote !== "'" && quote !== "\"") {
    return null;
  }

  const end = stringLiteralEnd(source, quoteStart);
  const replaceStart = quoteStart + 1;

  if (offset < replaceStart || offset > end) {
    return null;
  }

  return {
    tag: macro.tag,
    prefix: source.slice(replaceStart, offset),
    replaceStart,
    replaceEnd: end,
  };
}

interface MacroTag {
  /** Offset of the opening `{`. */
  braceStart: number;
  /** The tag name immediately after `{` (or `{/`). */
  tag: string;
  /** Offset one past the tag name (start of the argument region). */
  argStart: number;
  /** True when the macro is a closing tag (`{/tag}`). */
  closing: boolean;
}

/**
 * Returns the Latte macro tag that encloses `offset`, or `null` when the offset
 * is not inside a `{tag ...}` macro (a bare `{$var}` / `{= expr}` echo yields
 * `null` because it has no tag name).
 */
function enclosingMacroTag(source: string, offset: number): MacroTag | null {
  const braceStart = macroOpenBefore(source, offset);

  if (braceStart === null) {
    return null;
  }

  let index = braceStart + 1;
  let closing = false;

  if (source[index] === "/") {
    closing = true;
    index += 1;
  }

  const nameStart = index;

  if (!isTagNameStart(source[nameStart] ?? "")) {
    return null;
  }

  while (index < source.length && isTagNameChar(source[index] ?? "")) {
    index += 1;
  }

  return {
    braceStart,
    tag: source.slice(nameStart, index),
    argStart: index,
    closing,
  };
}

/**
 * Returns the offset of the `{` opening the macro that contains `offset`, or
 * `null` when a `}` or a newline is hit first (offset outside any macro). The
 * backward scan is bounded by `MAX_MACRO_SCAN`.
 */
function macroOpenBefore(source: string, offset: number): number | null {
  const min = Math.max(0, offset - MAX_MACRO_SCAN);

  for (let index = offset - 1; index >= min; index -= 1) {
    const character = source[index];

    if (character === "\n" || character === "}") {
      return null;
    }

    if (character === "{") {
      return index;
    }
  }

  return null;
}

/**
 * Detects a quoted template literal argument of `tag` starting at `argStart` and
 * spanning `offset`, returning a `template` reference or `null`.
 */
function quotedTemplateReference(
  source: string,
  offset: number,
  tag: string,
  argStart: number,
): LatteReference | null {
  const quoteStart = skipSpaces(source, argStart);
  const quote = source[quoteStart] ?? "";

  if (quote !== "'" && quote !== "\"") {
    return null;
  }

  const quoteEnd = stringLiteralEnd(source, quoteStart);

  if (offset <= quoteStart || offset > quoteEnd + 1) {
    return null;
  }

  const name = source.slice(quoteStart + 1, quoteEnd);

  if (!isUsableTemplateName(name)) {
    return null;
  }

  return {
    kind: "template",
    tag,
    name,
    nameStart: quoteStart + 1,
    nameEnd: quoteEnd,
  };
}

/**
 * Detects Nette's common unquoted include file path form
 * (`{include partials/@header.latte}`) without stealing plain block includes
 * such as `{include sidebar}`.
 */
function bareTemplateReference(
  source: string,
  offset: number,
  tag: string,
  argStart: number,
): LatteReference | null {
  let index = skipSpaces(source, argStart);
  const nameStart = index;

  while (index < source.length && isTemplatePathChar(source[index] ?? "")) {
    index += 1;
  }

  const nameEnd = index;
  const name = source.slice(nameStart, nameEnd);

  if (!looksLikeTemplatePath(name) || offset < nameStart || offset > nameEnd) {
    return null;
  }

  return {
    kind: "template",
    tag,
    name,
    nameStart,
    nameEnd,
  };
}

/**
 * Detects a bare identifier argument of `tag` (optionally `#`-prefixed) starting
 * at `argStart` and spanning `offset`, returning a reference of `kind` or
 * `null`. Reserved names resolve to `null`.
 */
function bareReference(
  source: string,
  offset: number,
  tag: string,
  argStart: number,
  reserved: ReadonlySet<string>,
  kind: LatteReferenceKind,
): LatteReference | null {
  let index = skipSpaces(source, argStart);

  if (source[index] === "#") {
    index += 1;
  }

  const nameStart = index;

  if (!isTagNameStart(source[nameStart] ?? "")) {
    return null;
  }

  while (index < source.length && isBareNameChar(source[index] ?? "")) {
    index += 1;
  }

  const nameEnd = index;
  const name = source.slice(nameStart, nameEnd);

  if (reserved.has(name)) {
    return null;
  }

  if (offset < nameStart || offset > nameEnd) {
    return null;
  }

  return { kind, tag, name, nameStart, nameEnd };
}

/**
 * Returns true when `offset` lies inside a Latte comment `{* ... *}`. An
 * unterminated comment runs to the end of the source.
 *
 * Delegates to `latteSyntax.ts`'s `collectLatteMaskedRegions` (the SAME
 * single-pass, quote-aware scan the tag parser uses) instead of an
 * independent `indexOf` scan. A standalone `indexOf` scan cannot tell a real
 * `{* comment *}` apart from the literal text `{*` sitting inside a quoted
 * string argument (e.g. `{$path . '{*'}` would falsely read as an unterminated
 * comment covering the rest of the document), and cannot compose two mask
 * kinds that nest (a `{syntax off}` marker written inside an already-closed
 * comment must stay masked as part of that comment, not re-open as its own
 * unclosed block). Sharing one scan with `latteSyntax.ts` makes both bugs
 * structurally impossible instead of two masking implementations that can
 * silently diverge.
 */
export function isInsideLatteComment(source: string, offset: number): boolean {
  return collectLatteMaskedRegions(source, offset).some(
    (region) => region.kind === "comment" && isOffsetInsideLatteMask(offset, region),
  );
}

/**
 * Returns true when `offset` lies inside either masked Latte construct - a
 * `{* comment *}` or a `{syntax off}...{/syntax}` block (where Latte disables
 * macro parsing, so braces are literal). An unterminated region runs to the
 * end of the source. See `isInsideLatteComment` for why this shares
 * `collectLatteMaskedRegions` with `latteSyntax.ts` rather than re-scanning
 * independently.
 */
function isInsideAnyLatteMask(source: string, offset: number): boolean {
  return collectLatteMaskedRegions(source, offset).some((region) =>
    isOffsetInsideLatteMask(offset, region),
  );
}

function isOffsetInsideLatteMask(offset: number, region: LatteMaskedRegion): boolean {
  return offset > region.start && (offset < region.end || !region.closed);
}

/**
 * Returns the offset of the closing quote of the string literal opening at
 * `quoteStart`, or `source.length` when the literal is unclosed. Bounded by the
 * source length.
 */
function stringLiteralEnd(source: string, quoteStart: number): number {
  const quote = source[quoteStart];

  for (let index = quoteStart + 1; index < source.length; index += 1) {
    const character = source[index];

    if (character === "\\") {
      index += 1;
      continue;
    }

    if (character === quote) {
      return index;
    }
  }

  return source.length;
}

function skipSpaces(source: string, from: number): number {
  let index = from;

  while (index < source.length && isSpace(source[index] ?? "")) {
    index += 1;
  }

  return index;
}

function isSpace(character: string): boolean {
  return character === " " || character === "\t";
}

function isTagNameStart(character: string): boolean {
  return /[A-Za-z_]/.test(character);
}

function isTagNameChar(character: string): boolean {
  return /[A-Za-z0-9_]/.test(character);
}

function isBareNameChar(character: string): boolean {
  return /[A-Za-z0-9_-]/.test(character);
}

function isTemplatePathChar(character: string): boolean {
  return /[A-Za-z0-9_./@-]/.test(character);
}

function looksLikeTemplatePath(name: string): boolean {
  return (
    isUsableTemplateName(name) &&
    (name.endsWith(".latte") || name.includes("/") || name.startsWith("@"))
  );
}

function isUsableTemplateName(name: string): boolean {
  return (
    name.trim().length > 0 &&
    !name.includes("::") &&
    /^[A-Za-z0-9_./@-]+$/.test(name)
  );
}
