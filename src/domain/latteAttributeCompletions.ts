/**
 * Pure detection of Latte `n:` attribute completion contexts inside HTML tags
 * of `.latte` templates, plus the static list of completable `n:` attributes.
 *
 * The attribute list is DERIVED from `latteSyntax.ts`'s `LATTE_TAG_NAMES` (the
 * single tag allowlist): pair tags usable as attributes contribute `n:<tag>`
 * plus generated `n:inner-<tag>` / `n:tag-<tag>` variants, and the handful of
 * attribute-only names (`n:class`, `n:attr`, `n:tag`, `n:ifcontent`, `n:href`,
 * `n:name`, `n:nonce`, `n:syntax`) are appended. A pair tag missing from the
 * shared allowlist is silently dropped so this module cannot offer an
 * attribute the tag scanner does not know.
 *
 * Detection stays CONSERVATIVE - the completion fires only once `n:` has been
 * typed at an attribute-name position of an OPEN (non-closing) HTML tag, and
 * never inside attribute values, `{...}` expressions, HTML comments, Latte
 * comments, or `{syntax off}` regions (masking delegates to
 * `collectLatteMaskedRegions`, the same scan `latteNavigation.ts` uses).
 * Both the cursor AND the found `<` opener are checked against the masked
 * regions, so a `<` written inside a comment or `{syntax off}` block can
 * never anchor a completion.
 *
 * HANG-SAFETY: the backward `<` / `<!--` scans are bounded by `MAX_TAG_SCAN`
 * and the forward tag scan runs only from the found `<` to the cursor token,
 * always advancing. The mask collection is NOT bounded by `MAX_TAG_SCAN` - it
 * is `latteSyntax.ts`'s single forward pass up to the cursor (linear in the
 * cursor offset, hang-safe) - so it runs only AFTER the cheap token/prefix
 * guards have confirmed the cursor is on an `n:` attribute token.
 */

import { collectLatteMaskedRegions, LATTE_TAG_NAMES } from "./latteSyntax";
import type { LatteMaskedRegion } from "./latteSyntax";

export interface LatteNAttributeEntry {
  name: string;
  detail: string;
}

export interface LatteNAttributeCompletion {
  /** The attribute characters typed so far, including the leading `n:`. */
  prefix: string;
  /** Offset of the `n` starting the typed attribute token. */
  replaceStart: number;
  /** Offset one past the typed prefix (the cursor offset). */
  replaceEnd: number;
  /** `n:` attribute names already present on the enclosing tag. */
  usedAttributes: ReadonlySet<string>;
}

const LATTE_PAIR_ATTRIBUTE_TAGS: readonly LatteNAttributeEntry[] = [
  { name: "if", detail: "Render the element only when the condition holds" },
  { name: "ifset", detail: "Render the element only when the variable is set" },
  { name: "ifchanged", detail: "Render the element only when the value changed" },
  { name: "foreach", detail: "Repeat the element for each item" },
  { name: "for", detail: "Repeat the element with a for loop" },
  { name: "while", detail: "Repeat the element while the condition holds" },
  { name: "first", detail: "Render only in the first loop iteration" },
  { name: "last", detail: "Render only in the last loop iteration" },
  { name: "sep", detail: "Render only between loop iterations" },
  { name: "block", detail: "Wrap the element in a {block}" },
  { name: "snippet", detail: "Wrap the element in a Nette AJAX snippet" },
  { name: "translate", detail: "Translate the element content" },
  { name: "spaceless", detail: "Strip whitespace inside the element" },
];

const LATTE_SPECIAL_N_ATTRIBUTES: readonly LatteNAttributeEntry[] = [
  { name: "n:class", detail: "Build the class attribute from conditions" },
  { name: "n:attr", detail: "Build HTML attributes from conditions" },
  { name: "n:tag", detail: "Set the element tag name dynamically" },
  { name: "n:ifcontent", detail: "Omit the element when its content is empty" },
  { name: "n:href", detail: "Nette presenter link target" },
  { name: "n:name", detail: "Bind a Nette form or form control" },
  { name: "n:nonce", detail: "Emit the Content-Security-Policy nonce" },
  { name: "n:syntax", detail: "Switch Latte tag syntax inside the element" },
];

const LATTE_N_ATTRIBUTE_ENTRIES: readonly LatteNAttributeEntry[] =
  buildLatteNAttributeEntries();

export function latteNAttributeEntries(): readonly LatteNAttributeEntry[] {
  return LATTE_N_ATTRIBUTE_ENTRIES;
}

function buildLatteNAttributeEntries(): readonly LatteNAttributeEntry[] {
  const knownTags = new Set(LATTE_TAG_NAMES);
  const pairTags = LATTE_PAIR_ATTRIBUTE_TAGS.filter((entry) =>
    knownTags.has(entry.name),
  );
  const baseEntries = [
    ...pairTags.map((entry) => ({
      detail: entry.detail,
      name: `n:${entry.name}`,
    })),
    ...LATTE_SPECIAL_N_ATTRIBUTES,
  ];
  const innerEntries = pairTags.map((entry) => ({
    detail: `${entry.detail} (content only)`,
    name: `n:inner-${entry.name}`,
  }));
  const tagEntries = pairTags.map((entry) => ({
    detail: `${entry.detail} (opening and closing tags only)`,
    name: `n:tag-${entry.name}`,
  }));

  return [
    ...sortedByName(baseEntries),
    ...sortedByName(innerEntries),
    ...sortedByName(tagEntries),
  ];
}

function sortedByName(
  entries: readonly LatteNAttributeEntry[],
): LatteNAttributeEntry[] {
  return [...entries].sort((left, right) => left.name.localeCompare(right.name));
}

/** Bound for the backward scans that find the enclosing `<` / `<!--`. */
const MAX_TAG_SCAN = 2000;

const ATTRIBUTE_TOKEN_CHAR = /[A-Za-z0-9:_-]/;
const N_ATTRIBUTE_PREFIX = /^n:[A-Za-z-]*$/;
const TAG_NAME_START = /[A-Za-z]/;

export function detectLatteNAttributeCompletionAt(
  source: string,
  offset: number,
): LatteNAttributeCompletion | null {
  if (offset < 2 || offset > source.length) {
    return null;
  }

  let tokenStart = offset;

  while (
    tokenStart > 0 &&
    ATTRIBUTE_TOKEN_CHAR.test(source[tokenStart - 1] ?? "")
  ) {
    tokenStart -= 1;
  }

  const prefix = source.slice(tokenStart, offset);

  if (!N_ATTRIBUTE_PREFIX.test(prefix)) {
    return null;
  }

  const next = source[offset] ?? "";

  if (next === "=" || ATTRIBUTE_TOKEN_CHAR.test(next)) {
    return null;
  }

  if (!isWhitespaceChar(source[tokenStart - 1] ?? "")) {
    return null;
  }

  if (isInsideHtmlComment(source, tokenStart)) {
    return null;
  }

  const maskedRegions = collectLatteMaskedRegions(source, offset);

  if (isOffsetInsideAnyLatteMask(offset, maskedRegions)) {
    return null;
  }

  const tagStart = htmlTagOpenBefore(source, tokenStart);

  if (tagStart === null) {
    return null;
  }

  if (isOffsetInsideAnyLatteMask(tagStart, maskedRegions)) {
    return null;
  }

  const usedAttributes = scanOpenTagAttributes(source, tagStart, tokenStart);

  if (!usedAttributes) {
    return null;
  }

  return { prefix, replaceStart: tokenStart, replaceEnd: offset, usedAttributes };
}

function htmlTagOpenBefore(source: string, before: number): number | null {
  const min = Math.max(0, before - MAX_TAG_SCAN);

  for (let index = before - 1; index >= min; index -= 1) {
    if (source[index] === "<") {
      return index;
    }
  }

  return null;
}

/**
 * Scans the tag opened at `tagStart` up to `end` and returns the `n:` attribute
 * names already written on it, or `null` when `end` is not at an attribute-name
 * position of an open tag (closing tag, non-tag `<`, past `>`, inside a quoted
 * value, or inside a `{...}` expression).
 */
function scanOpenTagAttributes(
  source: string,
  tagStart: number,
  end: number,
): ReadonlySet<string> | null {
  let index = tagStart + 1;

  if (!TAG_NAME_START.test(source[index] ?? "")) {
    return null;
  }

  while (index < end && ATTRIBUTE_TOKEN_CHAR.test(source[index] ?? "")) {
    index += 1;
  }

  const usedAttributes = new Set<string>();
  let quote: string | null = null;
  let braceDepth = 0;

  while (index < end) {
    const character = source[index] ?? "";

    if (quote) {
      if (character === quote) {
        quote = null;
      }

      index += 1;
      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
      index += 1;
      continue;
    }

    if (character === "{") {
      braceDepth += 1;
      index += 1;
      continue;
    }

    if (character === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      index += 1;
      continue;
    }

    if (character === ">" && braceDepth === 0) {
      return null;
    }

    if (
      braceDepth === 0 &&
      TAG_NAME_START.test(character) &&
      isWhitespaceChar(source[index - 1] ?? "")
    ) {
      let tokenEnd = index;

      while (
        tokenEnd < end &&
        ATTRIBUTE_TOKEN_CHAR.test(source[tokenEnd] ?? "")
      ) {
        tokenEnd += 1;
      }

      const name = source.slice(index, tokenEnd);

      if (name.startsWith("n:")) {
        usedAttributes.add(name);
      }

      index = tokenEnd;
      continue;
    }

    index += 1;
  }

  if (quote !== null || braceDepth > 0) {
    return null;
  }

  return usedAttributes;
}

function isInsideHtmlComment(source: string, before: number): boolean {
  const windowStart = Math.max(0, before - MAX_TAG_SCAN);
  const window = source.slice(windowStart, before);
  const open = window.lastIndexOf("<!--");

  if (open === -1) {
    return false;
  }

  return window.indexOf("-->", open + 4) === -1;
}

function isOffsetInsideAnyLatteMask(
  offset: number,
  maskedRegions: readonly LatteMaskedRegion[],
): boolean {
  return maskedRegions.some((region) => isOffsetInsideLatteMask(offset, region));
}

function isOffsetInsideLatteMask(
  offset: number,
  region: LatteMaskedRegion,
): boolean {
  return offset > region.start && (offset < region.end || !region.closed);
}

function isWhitespaceChar(character: string): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r"
  );
}
