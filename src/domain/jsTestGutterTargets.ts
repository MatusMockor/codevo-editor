import type { EditorPosition } from "./languageServerFeatures";
import { computeLineStartOffsets, lineColumnAt } from "./sourceLineOffsets";
import type { TestGutterTarget, TestGutterTargetKind } from "./testGutterTargets";

const callHeadPattern =
  /(^|[^.\w$])(describe|it|test)((?:\s*\.\s*(?:only|skip|todo|fails|concurrent|sequential|each))*)\s*\(/g;

const eachModifierPattern = /\beach\b/;

const eachPlaceholderPattern = /%[psdifjoO#%]|\$[A-Za-z_#{]/;

export function jsTestGutterTargets(source: string): TestGutterTarget[] {
  const masked = maskJsSource(source);
  const lineStartOffsets = computeLineStartOffsets(source);
  const targets: TestGutterTarget[] = [];

  for (const head of masked.matchAll(callHeadPattern)) {
    const callName = head[2] ?? "";
    const modifiers = head[3] ?? "";
    const headOffset = (head.index ?? 0) + (head[1] ?? "").length;
    const argOpenOffset = (head.index ?? 0) + head[0].length - 1;
    const hasEach = eachModifierPattern.test(modifiers);
    const titleOffset = titleStartOffset(source, masked, {
      afterModifiersOffset: headOffset + callName.length + modifiers.length,
      argOpenOffset,
      hasEach,
    });

    if (titleOffset === null) {
      continue;
    }

    const title = titleAt(source, titleOffset);

    if (title === null) {
      continue;
    }

    const filter = hasEach ? eachTitleFilter(title) : title;

    if (!filter) {
      continue;
    }

    targets.push({
      filter,
      kind: kindOf(callName),
      label: `Run ${filter}`,
      match: "description",
      position: lineColumnAt(lineStartOffsets, headOffset),
    });
  }

  return targets;
}

export function runAllJsTestsTarget(
  source: string,
  targets: readonly TestGutterTarget[],
): TestGutterTarget | null {
  const describeTarget = targets.find((target) => target.kind === "class");

  if (!describeTarget) {
    return null;
  }

  const masked = maskJsSource(source);
  const lineStartOffsets = computeLineStartOffsets(source);
  const span = callSpan(masked, offsetAt(lineStartOffsets, describeTarget.position));

  if (!span) {
    return null;
  }

  const covered = targets.every((target) => {
    if (target === describeTarget) {
      return true;
    }

    const offset = offsetAt(lineStartOffsets, target.position);

    return offset > span.start && offset < span.end;
  });

  if (!covered) {
    return null;
  }

  return describeTarget;
}

function kindOf(callName: string): TestGutterTargetKind {
  if (callName === "describe") {
    return "class";
  }

  return "method";
}

interface TitleLocation {
  afterModifiersOffset: number;
  argOpenOffset: number;
  hasEach: boolean;
}

function titleStartOffset(
  source: string,
  masked: string,
  location: TitleLocation,
): number | null {
  if (!location.hasEach) {
    return firstNonWhitespace(source, location.argOpenOffset + 1);
  }

  const taggedTable = source
    .slice(location.afterModifiersOffset, location.argOpenOffset)
    .trim();

  if (taggedTable !== "") {
    return firstNonWhitespace(source, location.argOpenOffset + 1);
  }

  const tableClose = matchingParenOffset(masked, location.argOpenOffset);

  if (tableClose === null) {
    return null;
  }

  const titleParen = firstNonWhitespace(masked, tableClose + 1);

  if (titleParen === null || masked[titleParen] !== "(") {
    return null;
  }

  return firstNonWhitespace(source, titleParen + 1);
}

function titleAt(source: string, offset: number): string | null {
  const quote = source[offset] ?? "";

  if (quote === "'" || quote === '"') {
    return quotedTitle(source, offset, quote);
  }

  if (quote === "`") {
    return templateTitle(source, offset);
  }

  return null;
}

function quotedTitle(
  source: string,
  offset: number,
  quote: string,
): string | null {
  let raw = "";

  for (let index = offset + 1; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (character === "\\") {
      raw += character + (source[index + 1] ?? "");
      index += 1;
      continue;
    }

    if (character === quote) {
      return unescapeTitle(raw);
    }

    if (character === "\n") {
      return null;
    }

    raw += character;
  }

  return null;
}

function templateTitle(source: string, offset: number): string | null {
  let raw = "";

  for (let index = offset + 1; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (character === "\\") {
      raw += character + (source[index + 1] ?? "");
      index += 1;
      continue;
    }

    if (character === "`") {
      return unescapeTitle(raw);
    }

    if (character === "$" && source[index + 1] === "{") {
      return null;
    }

    raw += character;
  }

  return null;
}

const TITLE_ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
};

function unescapeTitle(raw: string): string {
  return raw.replace(
    /\\([\s\S])/g,
    (_, character: string) => TITLE_ESCAPES[character] ?? character,
  );
}

function eachTitleFilter(title: string): string | null {
  const placeholder = eachPlaceholderPattern.exec(title);

  if (!placeholder) {
    return title;
  }

  const prefix = title.slice(0, placeholder.index).trimEnd();

  if (!prefix) {
    return null;
  }

  return prefix;
}

function offsetAt(lineStartOffsets: number[], position: EditorPosition): number {
  return (lineStartOffsets[position.lineNumber - 1] ?? 0) + position.column - 1;
}

function callSpan(
  masked: string,
  callOffset: number,
): { start: number; end: number } | null {
  const start = masked.indexOf("(", callOffset);

  if (start === -1) {
    return null;
  }

  let end = matchingParenOffset(masked, start);

  if (end === null) {
    return null;
  }

  let next = firstNonWhitespace(masked, end + 1);

  while (next !== null && masked[next] === "(") {
    end = matchingParenOffset(masked, next);

    if (end === null) {
      return null;
    }

    next = firstNonWhitespace(masked, end + 1);
  }

  return { end, start };
}

function matchingParenOffset(masked: string, openOffset: number): number | null {
  let depth = 0;

  for (let index = openOffset; index < masked.length; index += 1) {
    const character = masked[index];

    if (character === "(") {
      depth += 1;
      continue;
    }

    if (character !== ")") {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
}

function firstNonWhitespace(text: string, offset: number): number | null {
  for (let index = offset; index < text.length; index += 1) {
    if (!/\s/.test(text[index] ?? "")) {
      return index;
    }
  }

  return null;
}

type MaskFrame = { kind: "template" } | { depth: number; kind: "expression" };

function maskJsSource(source: string): string {
  let output = "";
  let quote: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  const frames: MaskFrame[] = [];

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (inLineComment) {
      output += maskedCharacter(character);

      if (character === "\n") {
        inLineComment = false;
      }

      continue;
    }

    if (inBlockComment) {
      output += maskedCharacter(character);

      if (character === "*" && next === "/") {
        output += " ";
        index += 1;
        inBlockComment = false;
      }

      continue;
    }

    if (quote) {
      output += maskedCharacter(character);

      if (character === "\\") {
        output += maskedCharacter(next);
        index += 1;
        continue;
      }

      if (character === quote || character === "\n") {
        quote = null;
      }

      continue;
    }

    const top = frames[frames.length - 1];

    if (top && top.kind === "template") {
      output += maskedCharacter(character);

      if (character === "\\") {
        output += maskedCharacter(next);
        index += 1;
        continue;
      }

      if (character === "`") {
        frames.pop();
        continue;
      }

      if (character === "$" && next === "{") {
        output += " ";
        index += 1;
        frames.push({ depth: 0, kind: "expression" });
      }

      continue;
    }

    if (character === "/" && next === "/") {
      output += "  ";
      index += 1;
      inLineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      output += "  ";
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (character === "'" || character === '"') {
      output += " ";
      quote = character;
      continue;
    }

    if (character === "`") {
      output += " ";
      frames.push({ kind: "template" });
      continue;
    }

    if (top && top.kind === "expression") {
      output += maskedCharacter(character);

      if (character === "{") {
        top.depth += 1;
        continue;
      }

      if (character !== "}") {
        continue;
      }

      if (top.depth === 0) {
        frames.pop();
        continue;
      }

      top.depth -= 1;
      continue;
    }

    output += character;
  }

  return output;
}

function maskedCharacter(character: string): string {
  if (character === "\n") {
    return "\n";
  }

  return " ";
}
