import { maskJavaScriptSource } from "./javascriptSourceMask";
import { computeLineStartOffsets, lineColumnAt } from "./sourceLineOffsets";
import type { TestGutterTarget } from "./testGutterTargets";

export interface JsTestCallSpan {
  readonly endOffset: number;
  readonly startOffset: number;
}

export interface JsTestDeclaration {
  readonly callSpan: JsTestCallSpan | null;
  readonly filter: string;
  readonly fullName: string;
  readonly kind: "suite" | "test";
  readonly parameterized: boolean;
  readonly staticTitle: string;
  readonly suitePath: readonly string[];
  readonly target: TestGutterTarget;
  readonly title: string;
}

interface DeclarationCandidate {
  readonly callName: string;
  readonly callSpan: JsTestCallSpan | null;
  readonly containmentEndOffset: number;
  readonly filter: string | null;
  readonly headOffset: number;
  readonly parameterized: boolean;
  readonly title: string | null;
}

interface TitleLocation {
  readonly afterModifiersOffset: number;
  readonly argOpenOffset: number;
  readonly hasEach: boolean;
}

const callHeadPattern =
  /(^|[^.\w$])(describe|it|test)((?:\s*\.\s*(?:only|skip|todo|fails|concurrent|sequential|each))*)\s*\(/g;

const eachModifierPattern = /\beach\b/;
const eachPlaceholderPattern = /%[psdifjoO#%]|\$[A-Za-z_#{]/;

/**
 * Parses only declarations whose titles and suite ancestry are statically knowable. A dynamic
 * describe makes its complete subtree unknowable, so nested declarations are omitted instead of
 * being incorrectly exposed as top-level tests. For `.each`, `staticTitle` keeps the declared
 * template while `title`/`filter`/`suitePath` use its stable prefix before the first placeholder.
 */
export function jsTestDeclarations(source: string): JsTestDeclaration[] {
  const masked = maskJavaScriptSource(source);
  const lineStartOffsets = computeLineStartOffsets(source);
  const candidates = declarationCandidates(source, masked);
  const invalidSuites = candidates.filter(
    (candidate) => candidate.callName === "describe" && !candidate.filter,
  );
  const validCandidates = candidates.filter(
    (candidate) =>
      candidate.filter &&
      candidate.title !== null &&
      !invalidSuites.some(
        (suite) =>
          suite.headOffset < candidate.headOffset &&
          candidate.headOffset < suite.containmentEndOffset,
      ),
  );

  return validCandidates.map((candidate) => {
    const filter = candidate.filter ?? "";
    const suitePath = validCandidates
      .filter(
        (suite) =>
          suite.callName === "describe" &&
          suite.headOffset < candidate.headOffset &&
          candidate.headOffset < suite.containmentEndOffset,
      )
      .sort((left, right) => left.headOffset - right.headOffset)
      .map((suite) => suite.filter ?? "");
    const kind = candidate.callName === "describe" ? "suite" : "test";

    return {
      callSpan: candidate.callSpan,
      filter,
      fullName: [...suitePath, filter].join(" "),
      kind,
      parameterized: candidate.parameterized,
      staticTitle: candidate.title ?? "",
      suitePath,
      target: {
        filter,
        kind: kind === "suite" ? "class" : "method",
        label: `Run ${filter}`,
        match: "description",
        position: lineColumnAt(lineStartOffsets, candidate.headOffset),
      },
      title: filter,
    };
  });
}

function declarationCandidates(source: string, masked: string): DeclarationCandidate[] {
  const candidates: DeclarationCandidate[] = [];

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
    const title = titleOffset === null ? null : titleAt(source, titleOffset);
    const filter = title === null ? null : hasEach ? eachTitleFilter(title) : title || null;
    const callSpan = callSpanAt(masked, headOffset);

    candidates.push({
      callName,
      callSpan,
      containmentEndOffset: callSpan?.endOffset ?? source.length,
      filter,
      headOffset,
      parameterized: hasEach,
      title,
    });
  }

  return candidates;
}

function titleStartOffset(source: string, masked: string, location: TitleLocation): number | null {
  if (!location.hasEach) {
    return firstNonWhitespace(source, location.argOpenOffset + 1);
  }

  const taggedTable = source.slice(location.afterModifiersOffset, location.argOpenOffset).trim();
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
  return quote === "`" ? templateTitle(source, offset) : null;
}

function quotedTitle(source: string, offset: number, quote: string): string | null {
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

const titleEscapes: Readonly<Record<string, string>> = {
  n: "\n",
  r: "\r",
  t: "\t",
};

function unescapeTitle(raw: string): string {
  return raw.replace(/\\([\s\S])/g, (_, character: string) => titleEscapes[character] ?? character);
}

function eachTitleFilter(title: string): string | null {
  const placeholder = eachPlaceholderPattern.exec(title);
  if (!placeholder) {
    return title || null;
  }
  return title.slice(0, placeholder.index).trimEnd() || null;
}

function callSpanAt(masked: string, callOffset: number): JsTestCallSpan | null {
  const startOffset = masked.indexOf("(", callOffset);
  if (startOffset === -1) {
    return null;
  }

  let endOffset = matchingParenOffset(masked, startOffset);
  if (endOffset === null) {
    return null;
  }

  let next = firstNonWhitespace(masked, endOffset + 1);
  while (next !== null && masked[next] === "(") {
    endOffset = matchingParenOffset(masked, next);
    if (endOffset === null) {
      return null;
    }
    next = firstNonWhitespace(masked, endOffset + 1);
  }

  return { endOffset, startOffset };
}

function matchingParenOffset(masked: string, openOffset: number): number | null {
  let depth = 0;
  for (let index = openOffset; index < masked.length; index += 1) {
    const character = masked[index];
    if (character === "(") {
      depth += 1;
    } else if (character === ")" && --depth === 0) {
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
