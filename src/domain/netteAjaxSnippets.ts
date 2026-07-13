import { collectLatteMaskedRegions } from "./latteSyntax";

export interface NetteLatteSnippetReference {
  kind: "attribute" | "tag";
  name: string;
  nameEnd: number;
  nameStart: number;
}

export interface NetteRedrawControlCall {
  name: string;
  nameEnd: number;
  nameStart: number;
}

const SNIPPET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const LATTE_TAG_SCAN_LIMIT = 2_000;

export function detectNetteLatteSnippetAt(
  source: string,
  offset: number,
): NetteLatteSnippetReference | null {
  if (offset < 0 || offset > source.length || isInsideLatteMask(source, offset)) {
    return null;
  }

  return (
    detectLatteSnippetTagAt(source, offset) ??
    detectLatteSnippetAttributeAt(source, offset)
  );
}

export function findNetteRedrawControlCalls(
  source: string,
): NetteRedrawControlCall[] {
  const calls: NetteRedrawControlCall[] = [];
  const pattern =
    /\$this\s*->\s*redrawControl\s*\(\s*(["'])([A-Za-z_][A-Za-z0-9_-]*)\1/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const quote = match[1] ?? "";
    const name = match[2] ?? "";
    const nameStart = match.index + match[0].lastIndexOf(`${quote}${name}`) + 1;

    calls.push({
      name,
      nameEnd: nameStart + name.length,
      nameStart,
    });
  }

  return calls;
}

export function findNetteRedrawControlCall(
  source: string,
  snippetName: string,
): NetteRedrawControlCall | null {
  return (
    findNetteRedrawControlCalls(source).find((call) => call.name === snippetName) ??
    null
  );
}

function detectLatteSnippetTagAt(
  source: string,
  offset: number,
): NetteLatteSnippetReference | null {
  const open = macroOpenBefore(source, offset);

  if (open === null || source[open + 1] === "/") {
    return null;
  }

  const close = source.indexOf("}", open + 1);

  if (close < 0 || close - open > LATTE_TAG_SCAN_LIMIT || offset > close) {
    return null;
  }

  let index = open + 1;

  while (index < close && isWhitespace(source[index] ?? "")) {
    index += 1;
  }

  const tagStart = index;

  while (index < close && /[A-Za-z0-9_]/.test(source[index] ?? "")) {
    index += 1;
  }

  if (source.slice(tagStart, index) !== "snippet") {
    return null;
  }

  while (index < close && isWhitespace(source[index] ?? "")) {
    index += 1;
  }

  const nameStart = index;

  while (index < close && /[A-Za-z0-9_-]/.test(source[index] ?? "")) {
    index += 1;
  }

  const name = source.slice(nameStart, index);

  if (
    !SNIPPET_NAME_PATTERN.test(name) ||
    offset < nameStart ||
    offset > index
  ) {
    return null;
  }

  const rest = source.slice(index, close).trim();

  if (rest.length > 0) {
    return null;
  }

  return { kind: "tag", name, nameEnd: index, nameStart };
}

function detectLatteSnippetAttributeAt(
  source: string,
  offset: number,
): NetteLatteSnippetReference | null {
  const pattern = /\bn:snippet\s*=\s*(["'])([A-Za-z_][A-Za-z0-9_-]*)\1/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const quote = match[1] ?? "";
    const name = match[2] ?? "";
    const nameStart = match.index + match[0].lastIndexOf(`${quote}${name}`) + 1;
    const nameEnd = nameStart + name.length;

    if (offset >= nameStart && offset <= nameEnd) {
      return { kind: "attribute", name, nameEnd, nameStart };
    }
  }

  return null;
}

function macroOpenBefore(source: string, offset: number): number | null {
  const min = Math.max(0, offset - LATTE_TAG_SCAN_LIMIT);

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

function isInsideLatteMask(source: string, offset: number): boolean {
  return collectLatteMaskedRegions(source).some(
    (region) => offset >= region.start && offset < region.end,
  );
}

function isWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\r";
}
