import { collectLatteMaskedRegions, LATTE_TAG_NAMES } from "./latteSyntax";

export interface LatteFormattingOptions {
  indentUnit: string;
}

const LATTE_TAG_NAME_SET = new Set(LATTE_TAG_NAMES);

const LATTE_PAIRED_TAG_NAMES = new Set([
  "block",
  "cache",
  "capture",
  "define",
  "embed",
  "first",
  "for",
  "foreach",
  "form",
  "formContainer",
  "formContext",
  "if",
  "ifchanged",
  "ifset",
  "iterateWhile",
  "label",
  "last",
  "sep",
  "snippet",
  "snippetArea",
  "spaceless",
  "switch",
  "translate",
  "while",
]);

const LATTE_MIDDLE_TAG_NAMES = new Set(["else", "elseif", "elseifset"]);

const HTML_VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const HTML_RAW_TEXT_ELEMENTS = new Set(["pre", "script", "style", "textarea"]);

const HTML_AUTO_CLOSE: Readonly<Record<string, readonly string[]>> = {
  dd: ["dd", "dt"],
  dt: ["dd", "dt"],
  li: ["li"],
  option: ["option"],
  p: ["p"],
  td: ["td", "th"],
  th: ["td", "th"],
  tr: ["td", "th", "tr"],
};

const LATTE_SYNTAX_CLOSE = "{/syntax}";
const LATTE_TAG_NAME_HEAD = /^[A-Za-z_][A-Za-z0-9_]*/;
const HTML_TAG_NAME_HEAD = /^[A-Za-z][A-Za-z0-9-]*/;

interface FormattingToken {
  end: number;
  kind: "htmlClose" | "htmlOpen" | "latteClose" | "latteMiddle" | "latteOpen";
  name: string;
  offset: number;
}

interface ProtectedInterval {
  end: number;
  start: number;
}

interface FormattingScan {
  protectedIntervals: ProtectedInterval[];
  tokens: FormattingToken[];
}

interface ScopeEntry {
  kind: "html" | "latte";
  name: string;
}

export function formatLatteSource(
  source: string,
  options: LatteFormattingOptions,
): string {
  const scan = scanFormattingTokens(source);
  const lines = source.split("\n");
  const output: string[] = [];
  const stack: ScopeEntry[] = [];
  let lineStart = 0;
  let tokenIndex = 0;

  for (const line of lines) {
    const lineEnd = lineStart + line.length;
    const leadingLength = leadingWhitespaceLength(line);
    const blank = leadingLength === line.length || line.slice(leadingLength) === "\r";
    const probeOffset = blank ? lineStart : lineStart + leadingLength;
    const isProtected = isOffsetProtected(scan.protectedIntervals, probeOffset);
    let lineLevel = stack.length;
    let leadingPhase = true;
    let cursor = lineStart + leadingLength;

    while (
      tokenIndex < scan.tokens.length &&
      scan.tokens[tokenIndex].offset <= lineEnd
    ) {
      const token = scan.tokens[tokenIndex];
      tokenIndex += 1;
      const leadingToken = leadingPhase && token.offset === cursor;
      const level = applyFormattingToken(stack, token, leadingToken);

      if (leadingToken && level !== null) {
        lineLevel = level;
        cursor = skipInlineWhitespace(source, token.end);
        continue;
      }

      leadingPhase = false;
    }

    lineStart = lineEnd + 1;

    if (isProtected) {
      output.push(line);
      continue;
    }

    if (blank) {
      output.push(line.endsWith("\r") ? "\r" : "");
      continue;
    }

    output.push(
      options.indentUnit.repeat(Math.max(0, lineLevel)) +
        line.slice(leadingLength),
    );
  }

  return output.join("\n");
}

function applyFormattingToken(
  stack: ScopeEntry[],
  token: FormattingToken,
  leadingToken: boolean,
): number | null {
  if (token.kind === "htmlOpen") {
    const autoClose = HTML_AUTO_CLOSE[token.name];

    while (
      autoClose &&
      stack.length > 0 &&
      stack[stack.length - 1].kind === "html" &&
      autoClose.includes(stack[stack.length - 1].name)
    ) {
      stack.pop();
    }

    const level = leadingToken ? stack.length : null;
    stack.push({ kind: "html", name: token.name });

    return level;
  }

  if (token.kind === "latteOpen") {
    stack.push({ kind: "latte", name: token.name });

    return null;
  }

  if (token.kind === "latteMiddle") {
    return leadingToken ? stack.length - 1 : null;
  }

  const kind = token.kind === "htmlClose" ? "html" : "latte";
  const matchIndex = lastScopeIndex(stack, kind, token.name);

  if (matchIndex >= 0) {
    stack.length = matchIndex;
  }

  return leadingToken ? stack.length : null;
}

function lastScopeIndex(
  stack: readonly ScopeEntry[],
  kind: ScopeEntry["kind"],
  name: string,
): number {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].kind === kind && stack[index].name === name) {
      return index;
    }
  }

  return -1;
}

function isOffsetProtected(
  intervals: readonly ProtectedInterval[],
  offset: number,
): boolean {
  return intervals.some(
    (interval) => offset > interval.start && offset < interval.end,
  );
}

function scanFormattingTokens(source: string): FormattingScan {
  const tokens: FormattingToken[] = [];
  const protectedIntervals: ProtectedInterval[] = [];
  const masked = collectLatteMaskedRegions(source);
  const lowerSource = source.toLowerCase();
  const length = source.length;
  let maskIndex = 0;
  let index = 0;

  while (index < length) {
    while (maskIndex < masked.length && masked[maskIndex].start < index) {
      maskIndex += 1;
    }

    const mask = masked[maskIndex];

    if (mask && mask.start === index) {
      protectedIntervals.push(maskedProtectedInterval(mask));
      maskIndex += 1;
      index = mask.end > index ? mask.end : index + 1;
      continue;
    }

    const char = source[index];

    if (char === "<") {
      index = scanHtmlConstruct(
        source,
        lowerSource,
        index,
        tokens,
        protectedIntervals,
      );
      continue;
    }

    if (char === "{") {
      index = scanLatteConstruct(source, index, tokens);
      continue;
    }

    index += 1;
  }

  return { protectedIntervals, tokens };
}

function maskedProtectedInterval(mask: {
  closed: boolean;
  end: number;
  kind: "comment" | "syntaxOff";
  start: number;
}): ProtectedInterval {
  if (mask.kind === "syntaxOff" && mask.closed) {
    return { end: mask.end - LATTE_SYNTAX_CLOSE.length, start: mask.start };
  }

  return { end: mask.end, start: mask.start };
}

function scanHtmlConstruct(
  source: string,
  lowerSource: string,
  index: number,
  tokens: FormattingToken[],
  protectedIntervals: ProtectedInterval[],
): number {
  if (source.startsWith("<!--", index)) {
    const close = source.indexOf("-->", index + 4);

    return close >= 0 ? close + 3 : source.length;
  }

  if (source[index + 1] === "!" || source[index + 1] === "?") {
    const close = source.indexOf(">", index + 1);

    return close >= 0 ? close + 1 : source.length;
  }

  if (source[index + 1] === "/") {
    const nameMatch = HTML_TAG_NAME_HEAD.exec(source.slice(index + 2, index + 66));

    if (!nameMatch) {
      return index + 1;
    }

    const name = nameMatch[0].toLowerCase();
    const tagEnd = findHtmlTagEnd(source, index + 2 + nameMatch[0].length);

    if (!HTML_VOID_ELEMENTS.has(name)) {
      tokens.push({ end: tagEnd, kind: "htmlClose", name, offset: index });
    }

    return tagEnd;
  }

  const nameMatch = HTML_TAG_NAME_HEAD.exec(source.slice(index + 1, index + 65));

  if (!nameMatch) {
    return index + 1;
  }

  const name = nameMatch[0].toLowerCase();
  const tagEnd = findHtmlTagEnd(source, index + 1 + nameMatch[0].length);
  const selfClosed = source.slice(index, tagEnd).trimEnd().endsWith("/>");

  if (HTML_VOID_ELEMENTS.has(name) || selfClosed) {
    return tagEnd;
  }

  tokens.push({ end: tagEnd, kind: "htmlOpen", name, offset: index });

  if (!HTML_RAW_TEXT_ELEMENTS.has(name)) {
    return tagEnd;
  }

  const closeStart = lowerSource.indexOf(`</${name}`, tagEnd);

  if (closeStart < 0) {
    protectedIntervals.push({ end: source.length, start: tagEnd });

    return source.length;
  }

  protectedIntervals.push({ end: closeStart, start: tagEnd });

  return closeStart;
}

function findHtmlTagEnd(source: string, from: number): number {
  const length = source.length;
  let index = from;
  let quote: string | null = null;

  while (index < length) {
    const char = source[index];

    if (quote) {
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

    if (char === ">") {
      return index + 1;
    }

    index += 1;
  }

  return length;
}

function scanLatteConstruct(
  source: string,
  index: number,
  tokens: FormattingToken[],
): number {
  const closing = source[index + 1] === "/";
  const nameStart = closing ? index + 2 : index + 1;

  if (!closing && (source[nameStart] === "$" || source[nameStart] === "=")) {
    return findLatteTagClose(source, index + 1) + 1;
  }

  const nameMatch = LATTE_TAG_NAME_HEAD.exec(
    source.slice(nameStart, nameStart + 64),
  );

  if (!nameMatch || !LATTE_TAG_NAME_SET.has(nameMatch[0])) {
    return index + 1;
  }

  const name = nameMatch[0];
  const closeBrace = findLatteTagClose(source, index + 1);
  const end = Math.min(closeBrace + 1, source.length);

  if (closing) {
    if (LATTE_PAIRED_TAG_NAMES.has(name)) {
      tokens.push({ end, kind: "latteClose", name, offset: index });
    }

    return end;
  }

  const content = source.slice(nameStart + name.length, closeBrace);

  if (content.trimEnd().endsWith("/")) {
    return end;
  }

  if (LATTE_MIDDLE_TAG_NAMES.has(name)) {
    tokens.push({ end, kind: "latteMiddle", name, offset: index });

    return end;
  }

  if (LATTE_PAIRED_TAG_NAMES.has(name)) {
    tokens.push({ end, kind: "latteOpen", name, offset: index });
  }

  return end;
}

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

function leadingWhitespaceLength(line: string): number {
  let index = 0;

  while (line[index] === " " || line[index] === "\t") {
    index += 1;
  }

  return index;
}

function skipInlineWhitespace(source: string, from: number): number {
  let index = from;

  while (source[index] === " " || source[index] === "\t") {
    index += 1;
  }

  return index;
}
