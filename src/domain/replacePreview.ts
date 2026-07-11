export interface ReplacePreviewQuery {
  pattern: string;
  isRegex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
}

export type ReplacePreview = (
  matchText: string,
  lineText: string,
  replacement: string,
  matchStart: number,
) => string | null;

const RUST_ONLY_OR_DIVERGENT_PATTERN =
  /\\[pP]\{|\\[Az]|\\x\{|\[\[:|&&|~~|--|\(\?[=!]|\(\?<=[^)]|\(\?<!|\(\?[imsUx-]/;
const UNICODE_SENSITIVE_PATTERN = /\\[bBdDsSwW]/;

export function createReplacePreview(
  query: ReplacePreviewQuery,
): ReplacePreview {
  const pattern = query.pattern.trim();

  if (!query.isRegex) {
    return createLiteralPreview(pattern, query);
  }

  const regex = compileRegexPreview(pattern, query);

  if (!regex) {
    return () => null;
  }

  return (matchText, lineText, replacement, matchStart) => {
    if (cannotMatchUnicodeExactly(pattern, lineText, query)) {
      return null;
    }

    const start = charOffsetToCodeUnit(lineText, matchStart);
    regex.lastIndex = 0;

    for (const captures of lineText.matchAll(regex)) {
      if (captures.index !== start || captures[0] !== matchText) {
        continue;
      }

      return expandRustReplacement(replacement, captures);
    }

    return null;
  };
}

function createLiteralPreview(
  pattern: string,
  query: ReplacePreviewQuery,
): ReplacePreview {
  return (matchText, lineText, replacement, matchStart) => {
    if (!pattern || !literalMatches(matchText, pattern, query.caseSensitive)) {
      return null;
    }

    if (!query.wholeWord) {
      return expandLiteralReplacement(matchText, replacement);
    }

    if (!hasAsciiWordBoundaries(lineText, matchStart, matchText)) {
      return null;
    }

    return expandLiteralReplacement(matchText, replacement);
  };
}

function expandLiteralReplacement(
  matchText: string,
  replacement: string,
): string {
  const captures = [matchText] as unknown as RegExpMatchArray;

  return expandRustReplacement(replacement, captures);
}

function compileRegexPreview(
  pattern: string,
  query: ReplacePreviewQuery,
): RegExp | null {
  if (!pattern || RUST_ONLY_OR_DIVERGENT_PATTERN.test(pattern)) {
    return null;
  }

  if (hasUnescapedAnchor(pattern) || hasPatternBackreference(pattern)) {
    return null;
  }

  const translated = pattern.replace(/\(\?P<([A-Za-z_][A-Za-z0-9_]*)>/g, "(?<$1>");
  const source = query.wholeWord ? `\\b(?:${translated})\\b` : translated;
  const flags = query.caseSensitive ? "gu" : "giu";

  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

function hasUnescapedAnchor(pattern: string): boolean {
  let inClass = false;

  for (let index = 0; index < pattern.length; index += 1) {
    const value = pattern[index];

    if (value === "\\") {
      index += 1;
      continue;
    }

    if (value === "[") {
      inClass = true;
      continue;
    }

    if (value === "]") {
      inClass = false;
      continue;
    }

    if (!inClass && (value === "^" || value === "$")) {
      return true;
    }
  }

  return false;
}

function hasPatternBackreference(pattern: string): boolean {
  return /(^|[^\\])(?:\\\\)*\\(?:[1-9]|k[<{'])/.test(pattern);
}

function cannotMatchUnicodeExactly(
  pattern: string,
  lineText: string,
  query: ReplacePreviewQuery,
): boolean {
  if (/^[\x00-\x7F]*$/.test(lineText)) {
    return false;
  }

  if (!query.caseSensitive || query.wholeWord) {
    return true;
  }

  return UNICODE_SENSITIVE_PATTERN.test(pattern);
}

function literalMatches(
  matchText: string,
  pattern: string,
  caseSensitive: boolean,
): boolean {
  if (caseSensitive) {
    return matchText === pattern;
  }

  if (!/^[\x00-\x7F]*$/.test(matchText + pattern)) {
    return false;
  }

  return matchText.toLowerCase() === pattern.toLowerCase();
}

function hasAsciiWordBoundaries(
  lineText: string,
  matchStart: number,
  matchText: string,
): boolean {
  if (!/^[\x00-\x7F]*$/.test(lineText)) {
    return false;
  }

  const chars = Array.from(lineText);
  const matchChars = Array.from(matchText);
  const before = chars[matchStart - 1];
  const after = chars[matchStart + matchChars.length];
  const first = matchChars[0];
  const last = matchChars[matchChars.length - 1];

  return (
    isAsciiWord(first) !== isAsciiWord(before) &&
    isAsciiWord(last) !== isAsciiWord(after)
  );
}

function isAsciiWord(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z0-9_]/.test(value));
}

function charOffsetToCodeUnit(value: string, offset: number): number {
  return Array.from(value).slice(0, Math.max(0, offset)).join("").length;
}

function expandRustReplacement(
  replacement: string,
  captures: RegExpMatchArray,
): string {
  let expanded = "";

  for (let index = 0; index < replacement.length; index += 1) {
    const value = replacement[index];

    if (value !== "$") {
      expanded += value;
      continue;
    }

    if (replacement[index + 1] === "$") {
      expanded += "$";
      index += 1;
      continue;
    }

    const reference = readCaptureReference(replacement, index);

    if (!reference) {
      expanded += "$";
      continue;
    }

    expanded += captureValue(captures, reference.name);
    index = reference.end;
  }

  return expanded;
}

function readCaptureReference(
  replacement: string,
  dollarIndex: number,
): { name: string; end: number } | null {
  if (replacement[dollarIndex + 1] === "{") {
    const end = replacement.indexOf("}", dollarIndex + 2);

    if (end < 0) {
      return null;
    }

    return {
      name: replacement.slice(dollarIndex + 2, end),
      end,
    };
  }

  let end = dollarIndex + 1;

  while (end < replacement.length && /[0-9A-Za-z_]/.test(replacement[end])) {
    end += 1;
  }

  if (end === dollarIndex + 1) {
    return null;
  }

  return {
    name: replacement.slice(dollarIndex + 1, end),
    end: end - 1,
  };
}

function captureValue(captures: RegExpMatchArray, name: string): string {
  if (/^[0-9]+$/.test(name)) {
    return captures[Number(name)] ?? "";
  }

  return captures.groups?.[name] ?? "";
}
