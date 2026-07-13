import type { EditorPosition } from "./languageServerFeatures";

export interface NetteTranslationSourceTarget {
  key: string;
  offset: number;
  position: EditorPosition;
}

interface TranslationKeyPart {
  name: string;
  offset: number;
}

const localeSuffixPattern = /^(.+)\.[a-z]{2}(?:[_-][a-z]{2})?\.neon$/i;

export function netteTranslationDomainFromPath(filePath: string): string | null {
  const normalized = filePath.split("\\").join("/");
  const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
  const match = localeSuffixPattern.exec(fileName);
  const domain = match?.[1] ?? null;

  return domain && isUsableNetteTranslationPath(domain) ? domain : null;
}

export function netteTranslationKeysFromSource(
  source: string,
  filePath: string,
): NetteTranslationSourceTarget[] {
  const domain = netteTranslationDomainFromPath(filePath);

  if (!domain) {
    return [];
  }

  const targets = new Map<string, NetteTranslationSourceTarget>();
  const stack: Array<{ indent: number; part: TranslationKeyPart }> = [];
  let lineStart = 0;

  while (lineStart <= source.length) {
    const newline = source.indexOf("\n", lineStart);
    const lineEnd = newline >= 0 ? newline : source.length;
    const line = parseTranslationLine(source, lineStart, lineEnd);

    if (line) {
      while (stack.length > 0 && stack[stack.length - 1].indent >= line.indent) {
        stack.pop();
      }

      const parentParts = stack.map((entry) => entry.part);
      const parts = [...parentParts, line.key];

      if (line.hasScalarValue) {
        const key = [domain, ...parts.map((part) => part.name)].join(".");

        if (!targets.has(key)) {
          targets.set(key, {
            key,
            offset: line.key.offset,
            position: editorPositionAtOffset(source, line.key.offset),
          });
        }
      } else {
        stack.push({ indent: line.indent, part: line.key });
      }
    }

    if (newline < 0) {
      break;
    }

    lineStart = newline + 1;
  }

  return Array.from(targets.values()).sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

export function netteTranslationTargetFromSource(
  source: string,
  filePath: string,
  translationKey: string,
): NetteTranslationSourceTarget | null {
  return (
    netteTranslationKeysFromSource(source, filePath).find(
      (target) => target.key === translationKey,
    ) ?? null
  );
}

interface ParsedTranslationLine {
  hasScalarValue: boolean;
  indent: number;
  key: TranslationKeyPart;
}

function parseTranslationLine(
  source: string,
  lineStart: number,
  lineEnd: number,
): ParsedTranslationLine | null {
  const contentStart = skipHorizontalWhitespace(source, lineStart, lineEnd);
  const commentStart = findNeonCommentStart(source, contentStart, lineEnd);

  if (contentStart >= commentStart || source[contentStart] === "-") {
    return null;
  }

  const colonOffset = findTopLevelColon(source, contentStart, commentStart);

  if (colonOffset === null) {
    return null;
  }

  const key = parseTranslationKey(source, contentStart, colonOffset);

  if (!key) {
    return null;
  }

  const valueStart = skipHorizontalWhitespace(
    source,
    colonOffset + 1,
    commentStart,
  );
  const hasScalarValue =
    valueStart < commentStart &&
    isSimpleScalarValue(source, valueStart, commentStart);

  return {
    hasScalarValue,
    indent: contentStart - lineStart,
    key,
  };
}

function parseTranslationKey(
  source: string,
  from: number,
  to: number,
): TranslationKeyPart | null {
  const keyStart = skipHorizontalWhitespace(source, from, to);
  const keyEnd = trimHorizontalWhitespaceEnd(source, keyStart, to);

  if (keyStart >= keyEnd) {
    return null;
  }

  const first = source[keyStart];

  if (first === "'" || first === "\"") {
    const parsed = parseQuotedKey(source, keyStart, keyEnd);

    return parsed && isUsableNetteTranslationSegment(parsed.name)
      ? parsed
      : null;
  }

  const name = source.slice(keyStart, keyEnd);

  return isUsableNetteTranslationSegment(name)
    ? { name, offset: keyStart }
    : null;
}

function parseQuotedKey(
  source: string,
  quoteStart: number,
  keyEnd: number,
): TranslationKeyPart | null {
  const quote = source[quoteStart];
  let index = quoteStart + 1;
  let value = "";

  while (index < keyEnd) {
    const character = source[index] ?? "";

    if (character === "\\") {
      if (index + 1 >= keyEnd) {
        return null;
      }

      value += source[index + 1] ?? "";
      index += 2;
      continue;
    }

    if (character === quote) {
      return skipHorizontalWhitespace(source, index + 1, keyEnd) === keyEnd
        ? { name: value, offset: quoteStart + 1 }
        : null;
    }

    value += character;
    index += 1;
  }

  return null;
}

function findTopLevelColon(
  source: string,
  from: number,
  limit: number,
): number | null {
  let index = from;

  while (index < limit) {
    const character = source[index] ?? "";

    if (character === "'" || character === "\"") {
      index = skipString(source, index, limit);
      continue;
    }

    if (character === ":") {
      return index;
    }

    index += 1;
  }

  return null;
}

function findNeonCommentStart(
  source: string,
  from: number,
  limit: number,
): number {
  let index = from;

  while (index < limit) {
    const character = source[index] ?? "";

    if (character === "'" || character === "\"") {
      index = skipString(source, index, limit);
      continue;
    }

    if (
      character === "#" &&
      (index === from || isHorizontalWhitespace(source[index - 1] ?? ""))
    ) {
      return index;
    }

    index += 1;
  }

  return limit;
}

function skipString(source: string, open: number, limit: number): number {
  const quote = source[open];
  let index = open + 1;

  while (index < limit) {
    const character = source[index] ?? "";

    if (character === "\\") {
      index += 2;
      continue;
    }

    if (character === quote) {
      return index + 1;
    }

    index += 1;
  }

  return limit;
}

function skipHorizontalWhitespace(
  source: string,
  from: number,
  limit: number,
): number {
  let index = from;

  while (index < limit && isHorizontalWhitespace(source[index] ?? "")) {
    index += 1;
  }

  return index;
}

function trimHorizontalWhitespaceEnd(
  source: string,
  from: number,
  to: number,
): number {
  let index = to;

  while (index > from && isHorizontalWhitespace(source[index - 1] ?? "")) {
    index -= 1;
  }

  return index;
}

function isHorizontalWhitespace(character: string): boolean {
  return character === " " || character === "\t";
}

function isSimpleScalarValue(
  source: string,
  from: number,
  limit: number,
): boolean {
  const first = source[from] ?? "";

  if (first === "{" || first === "[" || first === "(") {
    return false;
  }

  if (first === "'" || first === "\"") {
    const valueEnd = skipString(source, from, limit);

    return valueEnd <= limit && source[valueEnd - 1] === first;
  }

  for (let index = from; index < limit; index += 1) {
    const character = source[index] ?? "";

    if (character === "{" || character === "[" || character === "(") {
      return false;
    }
  }

  return true;
}

function isUsableNetteTranslationPath(path: string): boolean {
  return path.split(".").every(isUsableNetteTranslationSegment);
}

function isUsableNetteTranslationSegment(segment: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(segment);
}

function editorPositionAtOffset(
  source: string,
  targetOffset: number,
): EditorPosition {
  const offset = Math.max(0, Math.min(targetOffset, source.length));
  let lineNumber = 1;
  let lineStart = 0;

  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      lineStart = index + 1;
    }
  }

  return { column: offset - lineStart + 1, lineNumber };
}
