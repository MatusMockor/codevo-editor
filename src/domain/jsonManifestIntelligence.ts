export interface JsonManifestContext<Section extends string> {
  keyPosition: boolean;
  packageName?: string;
  section: Section;
}

interface JsonToken {
  depth: number;
  end: number;
  kind: "punctuation" | "string";
  start: number;
  value: string;
}

interface JsonSectionRange<Section extends string> {
  closeIndex: number;
  depth: number;
  openIndex: number;
  section: Section;
}

export function jsonManifestContextAt<Section extends string>(
  source: string,
  offset: number,
  sectionKeys: readonly Section[],
): JsonManifestContext<Section> | null {
  if (offset < 0 || offset > source.length || !validJsonObject(source)) {
    return null;
  }

  const tokens = jsonStructuralTokens(source);
  const range = sectionRangeAt(tokens, offset, sectionKeys);

  if (!range) {
    return null;
  }

  return sectionContextAt(tokens, range, offset);
}

function validJsonObject(source: string): boolean {
  try {
    const value: unknown = JSON.parse(source);
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  } catch {
    return false;
  }
}

function jsonStructuralTokens(source: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let depth = 0;
  let index = 0;

  while (index < source.length) {
    const character = source[index];

    if (character === '"') {
      const end = jsonStringEnd(source, index);
      tokens.push({
        depth,
        end,
        kind: "string",
        start: index,
        value: JSON.parse(source.slice(index, end)) as string,
      });
      index = end;
      continue;
    }

    if (character === "{" || character === "[") {
      tokens.push({
        depth,
        end: index + 1,
        kind: "punctuation",
        start: index,
        value: character,
      });
      depth += 1;
      index += 1;
      continue;
    }

    if (character === "}" || character === "]") {
      depth -= 1;
      tokens.push({
        depth,
        end: index + 1,
        kind: "punctuation",
        start: index,
        value: character,
      });
      index += 1;
      continue;
    }

    if (character === ":" || character === ",") {
      tokens.push({
        depth,
        end: index + 1,
        kind: "punctuation",
        start: index,
        value: character,
      });
    }

    index += 1;
  }

  return tokens;
}

function jsonStringEnd(source: string, start: number): number {
  let escaped = false;

  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (character === '"') {
      return index + 1;
    }
  }

  return source.length;
}

function sectionRangeAt<Section extends string>(
  tokens: JsonToken[],
  offset: number,
  sectionKeys: readonly Section[],
): JsonSectionRange<Section> | null {
  for (let index = 0; index < tokens.length; index += 1) {
    const key = tokens[index];

    if (
      key?.kind !== "string" ||
      key.depth !== 1 ||
      !isSectionKey(key.value, sectionKeys)
    ) {
      continue;
    }

    const colon = tokens[index + 1];
    const open = tokens[index + 2];

    if (colon?.value !== ":" || open?.value !== "{") {
      continue;
    }

    const closeIndex = matchingObjectCloseIndex(tokens, index + 2);

    if (closeIndex < 0) {
      continue;
    }

    const close = tokens[closeIndex];

    if (!close || offset < open.end || offset > close.start) {
      continue;
    }

    return {
      closeIndex,
      depth: open.depth + 1,
      openIndex: index + 2,
      section: key.value,
    };
  }

  return null;
}

function sectionContextAt<Section extends string>(
  tokens: JsonToken[],
  range: JsonSectionRange<Section>,
  offset: number,
): JsonManifestContext<Section> {
  let segmentStart = tokens[range.openIndex]?.end ?? 0;

  for (let index = range.openIndex + 1; index <= range.closeIndex; index += 1) {
    const token = tokens[index];

    if (!token) {
      break;
    }

    const boundary =
      index === range.closeIndex ||
      (token.depth === range.depth && token.value === ",");

    if (!boundary) {
      continue;
    }

    if (offset >= segmentStart && offset <= token.start) {
      return contextWithinPropertySegment(
        tokens,
        range,
        segmentStart,
        token.start,
        offset,
      );
    }

    segmentStart = token.end;
  }

  return { keyPosition: true, section: range.section };
}

function contextWithinPropertySegment<Section extends string>(
  tokens: JsonToken[],
  range: JsonSectionRange<Section>,
  segmentStart: number,
  segmentEnd: number,
  offset: number,
): JsonManifestContext<Section> {
  const colonIndex = tokens.findIndex(
    (token, index) =>
      index > range.openIndex &&
      index < range.closeIndex &&
      token.depth === range.depth &&
      token.value === ":" &&
      token.start >= segmentStart &&
      token.end <= segmentEnd,
  );

  if (colonIndex < 0) {
    return { keyPosition: true, section: range.section };
  }

  const colon = tokens[colonIndex];

  if (!colon || offset >= colon.end) {
    return { keyPosition: false, section: range.section };
  }

  const key = tokens
    .slice(range.openIndex + 1, colonIndex)
    .find(
      (token) =>
        token.kind === "string" &&
        token.depth === range.depth &&
        token.start >= segmentStart,
    );

  if (!key || offset < key.start || offset > key.end) {
    return { keyPosition: true, section: range.section };
  }

  return {
    keyPosition: true,
    packageName: key.value,
    section: range.section,
  };
}

function matchingObjectCloseIndex(tokens: JsonToken[], openIndex: number): number {
  const open = tokens[openIndex];

  if (!open) {
    return -1;
  }

  for (let index = openIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token?.value === "}" && token.depth === open.depth) {
      return index;
    }
  }

  return -1;
}

function isSectionKey<Section extends string>(
  value: string,
  sectionKeys: readonly Section[],
): value is Section {
  return sectionKeys.some((section) => section === value);
}
