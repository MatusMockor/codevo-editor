import type { LanguageServerLinkedEditingRanges } from "./languageServerFeatures";

export const MAX_LINKED_EDITING_RANGES = 256;
export const MAX_LINKED_EDITING_WORD_PATTERN_UTF8_BYTES = 4_096;

export function linkedEditingRangesFitProjection(
  value: LanguageServerLinkedEditingRanges | null,
): boolean {
  return (
    value === null ||
    (value.ranges.length <= MAX_LINKED_EDITING_RANGES &&
      (value.wordPattern === null ||
        utf8ByteLengthAtMost(value.wordPattern, MAX_LINKED_EDITING_WORD_PATTERN_UTF8_BYTES)))
  );
}

function utf8ByteLengthAtMost(value: string, maximum: number): boolean {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes > maximum) {
      return false;
    }
  }
  return true;
}

export function isSafeLinkedEditingWordPattern(pattern: string): boolean {
  let escaped = false;
  let inCharacterClass = false;
  let quantifierCount = 0;

  for (const character of pattern) {
    if (escaped) {
      if (!inCharacterClass && (/[1-9]/.test(character) || character === "k")) {
        return false;
      }
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") {
      inCharacterClass = true;
      continue;
    }
    if (character === "]") {
      inCharacterClass = false;
      continue;
    }
    if (!inCharacterClass && (character === "(" || character === ")" || character === "|")) {
      return false;
    }
    if (
      !inCharacterClass &&
      (character === "*" || character === "+" || character === "?" || character === "{")
    ) {
      quantifierCount += 1;
      if (quantifierCount > 1) {
        return false;
      }
    }
  }

  return !escaped && !inCharacterClass;
}
