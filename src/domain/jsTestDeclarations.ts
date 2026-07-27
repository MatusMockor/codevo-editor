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

interface DeclarationCallHead {
  readonly argOpenOffset: number;
  readonly callName: string;
  readonly hasEach: boolean;
  readonly headOffset: number;
  readonly modifiers: string;
}

interface IndexedDeclarationCandidate {
  readonly candidate: DeclarationCandidate;
  readonly suitePath: readonly DeclarationCandidate[];
}

interface DeclarationIndexOperationCounter {
  candidateVisits: number;
  containmentChecks: number;
  suitePops: number;
  suitePathEntries: number;
}

interface ActiveSuite {
  readonly candidate: DeclarationCandidate;
  readonly fullNameUnits: number;
}

interface RelevantParenthesisIndex {
  readonly hasUnmatchedClosingParenthesis: boolean;
  readonly matches: ReadonlyMap<number, number>;
}

export interface JsTestDeclarationIndexMetrics {
  readonly candidateCount: number;
  readonly indexOperations: number;
  readonly retainedParenthesisMatches: number;
  readonly suitePathEntries: number;
}

export const MAX_JS_TEST_DECLARATION_SUITE_PATH_ENTRIES = 65_536;
export const MAX_JS_TEST_DECLARATION_FULL_NAME_UNITS = 1_048_576;
export const MAX_JS_TEST_DECLARATION_RETAINED_PARENTHESIS_MATCHES = 65_536;
export const MAX_JS_TEST_DECLARATION_CANDIDATES = 65_536;

export class JsTestDeclarationBudgetError extends Error {
  readonly candidateCount: number;
  readonly fullNameUnits: number;
  readonly indexOperations: number;
  readonly limitKind: "ancestry" | "candidates" | "parentheses";
  readonly retainedParenthesisMatches: number;
  readonly suitePathEntries: number;

  constructor({
    candidateCount,
    fullNameUnits,
    indexOperations,
    limitKind,
    retainedParenthesisMatches,
    suitePathEntries,
  }: {
    readonly candidateCount: number;
    readonly fullNameUnits: number;
    readonly indexOperations: number;
    readonly limitKind: "ancestry" | "candidates" | "parentheses";
    readonly retainedParenthesisMatches: number;
    readonly suitePathEntries: number;
  }) {
    super(
      `JavaScript test discovery exceeded its bounded ${limitKind} budget; no partial results were published.`,
    );
    this.name = "JsTestDeclarationBudgetError";
    this.candidateCount = candidateCount;
    this.fullNameUnits = fullNameUnits;
    this.indexOperations = indexOperations;
    this.limitKind = limitKind;
    this.retainedParenthesisMatches = retainedParenthesisMatches;
    this.suitePathEntries = suitePathEntries;
  }
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
  return collectJsTestDeclarations(source).declarations;
}

/**
 * Deterministic test support for the candidate index. `indexOperations` excludes the unavoidable
 * work of materializing suite paths, which is reported separately as `suitePathEntries`.
 */
export function jsTestDeclarationsWithIndexMetricsForTest(source: string): {
  readonly declarations: readonly JsTestDeclaration[];
  readonly metrics: JsTestDeclarationIndexMetrics;
} {
  const counter: DeclarationIndexOperationCounter = {
    candidateVisits: 0,
    containmentChecks: 0,
    suitePops: 0,
    suitePathEntries: 0,
  };
  const result = collectJsTestDeclarations(source, counter);
  return {
    declarations: result.declarations,
    metrics: {
      candidateCount: result.candidateCount,
      indexOperations: counter.candidateVisits + counter.containmentChecks + counter.suitePops,
      retainedParenthesisMatches: result.retainedParenthesisMatches,
      suitePathEntries: counter.suitePathEntries,
    },
  };
}

function collectJsTestDeclarations(
  source: string,
  counter?: DeclarationIndexOperationCounter,
): {
  readonly candidateCount: number;
  readonly declarations: JsTestDeclaration[];
  readonly retainedParenthesisMatches: number;
} {
  const masked = maskJavaScriptSource(source);
  const lineStartOffsets = computeLineStartOffsets(source);
  const callHeads = declarationCallHeads(masked);
  const parenthesisIndex =
    callHeads.length === 0
      ? {
          hasUnmatchedClosingParenthesis: false,
          matches: new Map<number, number>(),
        }
      : relevantParenthesisIndex(masked, callHeads);
  const candidates = declarationCandidates(
    source,
    masked,
    callHeads,
    parenthesisIndex.matches,
    parenthesisIndex.hasUnmatchedClosingParenthesis,
  );
  const indexedCandidates = indexDeclarationCandidates(
    candidates,
    parenthesisIndex.matches.size,
    counter,
  );

  const declarations = indexedCandidates.map(
    ({ candidate, suitePath: suiteCandidates }): JsTestDeclaration => {
      const filter = candidate.filter ?? "";
      const suitePath = suiteCandidates.map((suite) => suite.filter ?? "");
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
    },
  );

  return {
    candidateCount: candidates.length,
    declarations,
    retainedParenthesisMatches: parenthesisIndex.matches.size,
  };
}

/**
 * Declaration call spans are laminar because they are derived from balanced parenthesis pairs:
 * two calls are either disjoint or one is nested in the other. That lets valid suite ancestry use
 * a stack. Invalid suites only need the greatest prior end offset to answer the exact interval
 * stabbing query used by the previous quadratic implementation.
 */
function indexDeclarationCandidates(
  candidates: readonly DeclarationCandidate[],
  retainedParenthesisMatches: number,
  counter?: DeclarationIndexOperationCounter,
): IndexedDeclarationCandidate[] {
  const indexed: IndexedDeclarationCandidate[] = [];
  const activeValidSuites: ActiveSuite[] = [];
  const operations = counter ?? {
    candidateVisits: 0,
    containmentChecks: 0,
    suitePops: 0,
    suitePathEntries: 0,
  };
  let fullNameUnits = 0;
  let greatestInvalidSuiteEndOffset = -1;

  for (const candidate of candidates) {
    operations.candidateVisits += 1;
    while (
      activeValidSuites.length > 0 &&
      (activeValidSuites[activeValidSuites.length - 1]?.candidate.containmentEndOffset ?? -1) <=
        candidate.headOffset
    ) {
      activeValidSuites.pop();
      operations.suitePops += 1;
    }

    operations.containmentChecks += 1;
    const containedByInvalidSuite = candidate.headOffset < greatestInvalidSuiteEndOffset;
    const valid = candidate.filter !== null && candidate.title !== null && !containedByInvalidSuite;

    if (valid) {
      const suitePathEntries = operations.suitePathEntries + activeValidSuites.length;
      const activeFullNameUnits =
        activeValidSuites[activeValidSuites.length - 1]?.fullNameUnits ?? 0;
      const candidateFullNameUnits =
        activeFullNameUnits + (activeValidSuites.length > 0 ? 1 : 0) + candidate.filter.length;
      const nextFullNameUnits = fullNameUnits + candidateFullNameUnits;
      if (
        suitePathEntries > MAX_JS_TEST_DECLARATION_SUITE_PATH_ENTRIES ||
        nextFullNameUnits > MAX_JS_TEST_DECLARATION_FULL_NAME_UNITS
      ) {
        throw new JsTestDeclarationBudgetError({
          candidateCount: candidates.length,
          fullNameUnits: nextFullNameUnits,
          indexOperations:
            operations.candidateVisits + operations.containmentChecks + operations.suitePops,
          limitKind: "ancestry",
          retainedParenthesisMatches,
          suitePathEntries,
        });
      }
      operations.suitePathEntries = suitePathEntries;
      fullNameUnits = nextFullNameUnits;
      const suitePath = activeValidSuites.map(({ candidate: suite }) => suite);
      indexed.push({ candidate, suitePath });
      if (candidate.callName === "describe") {
        activeValidSuites.push({ candidate, fullNameUnits: candidateFullNameUnits });
      }
    }

    if (candidate.callName === "describe" && candidate.filter === null) {
      greatestInvalidSuiteEndOffset = Math.max(
        greatestInvalidSuiteEndOffset,
        candidate.containmentEndOffset,
      );
    }
  }

  return indexed;
}

function declarationCandidates(
  source: string,
  masked: string,
  callHeads: readonly DeclarationCallHead[],
  matchingParentheses: ReadonlyMap<number, number>,
  hasUnmatchedClosingParenthesis: boolean,
): DeclarationCandidate[] {
  const candidates: DeclarationCandidate[] = [];

  for (const { argOpenOffset, callName, hasEach, headOffset, modifiers } of callHeads) {
    const titleOffset = titleStartOffset(source, masked, matchingParentheses, {
      afterModifiersOffset: headOffset + callName.length + modifiers.length,
      argOpenOffset,
      hasEach,
    });
    const title = titleOffset === null ? null : titleAt(source, titleOffset);
    const filter = title === null ? null : hasEach ? eachTitleFilter(title) : title || null;
    const callSpan = callSpanAt(masked, matchingParentheses, headOffset);

    candidates.push({
      callName,
      callSpan,
      containmentEndOffset:
        callName === "describe" && filter === null && hasUnmatchedClosingParenthesis
          ? source.length
          : (callSpan?.endOffset ?? source.length),
      filter,
      headOffset,
      parameterized: hasEach,
      title,
    });
  }

  return candidates;
}

function declarationCallHeads(masked: string): DeclarationCallHead[] {
  const callHeads: DeclarationCallHead[] = [];
  for (const head of masked.matchAll(callHeadPattern)) {
    const modifiers = head[3] ?? "";
    callHeads.push({
      argOpenOffset: (head.index ?? 0) + head[0].length - 1,
      callName: head[2] ?? "",
      hasEach: eachModifierPattern.test(modifiers),
      headOffset: (head.index ?? 0) + (head[1] ?? "").length,
      modifiers,
    });
    if (callHeads.length > MAX_JS_TEST_DECLARATION_CANDIDATES) {
      throw new JsTestDeclarationBudgetError({
        candidateCount: callHeads.length,
        fullNameUnits: 0,
        indexOperations: 0,
        limitKind: "candidates",
        retainedParenthesisMatches: 0,
        suitePathEntries: 0,
      });
    }
  }
  return callHeads;
}

function titleStartOffset(
  source: string,
  masked: string,
  matchingParentheses: ReadonlyMap<number, number>,
  location: TitleLocation,
): number | null {
  if (!location.hasEach) {
    return firstNonWhitespace(source, location.argOpenOffset + 1);
  }

  const taggedTable = source.slice(location.afterModifiersOffset, location.argOpenOffset).trim();
  if (taggedTable !== "") {
    return firstNonWhitespace(source, location.argOpenOffset + 1);
  }

  const tableClose = matchingParenOffset(matchingParentheses, location.argOpenOffset);
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

function callSpanAt(
  masked: string,
  matchingParentheses: ReadonlyMap<number, number>,
  callOffset: number,
): JsTestCallSpan | null {
  const startOffset = masked.indexOf("(", callOffset);
  if (startOffset === -1) {
    return null;
  }

  let endOffset = matchingParenOffset(matchingParentheses, startOffset);
  if (endOffset === null) {
    return null;
  }

  let next = firstNonWhitespace(masked, endOffset + 1);
  while (next !== null && masked[next] === "(") {
    endOffset = matchingParenOffset(matchingParentheses, next);
    if (endOffset === null) {
      return null;
    }
    next = firstNonWhitespace(masked, endOffset + 1);
  }

  return { endOffset, startOffset };
}

function relevantParenthesisIndex(
  masked: string,
  callHeads: readonly DeclarationCallHead[],
): RelevantParenthesisIndex {
  const relevantOpenings = new Set(callHeads.map(({ argOpenOffset }) => argOpenOffset));
  const activeRelevantOpenings = new Map<number, number>();
  const matches = new Map<number, number>();
  let canChainFromRelevantClose = false;
  let depth = 0;
  let hasUnmatchedClosingParenthesis = false;

  for (let index = 0; index < masked.length; index += 1) {
    const character = masked[index] ?? "";
    if (character === "(") {
      depth += 1;
      if (relevantOpenings.has(index) || canChainFromRelevantClose) {
        activeRelevantOpenings.set(depth, index);
      }
      canChainFromRelevantClose = false;
    } else if (character === ")") {
      if (depth === 0) hasUnmatchedClosingParenthesis = true;
      const opening = activeRelevantOpenings.get(depth);
      if (opening !== undefined) {
        const retainedParenthesisMatches = matches.size + 1;
        if (retainedParenthesisMatches > MAX_JS_TEST_DECLARATION_RETAINED_PARENTHESIS_MATCHES) {
          throw new JsTestDeclarationBudgetError({
            candidateCount: callHeads.length,
            fullNameUnits: 0,
            indexOperations: 0,
            limitKind: "parentheses",
            retainedParenthesisMatches,
            suitePathEntries: 0,
          });
        }
        matches.set(opening, index);
        activeRelevantOpenings.delete(depth);
        canChainFromRelevantClose = true;
      } else {
        canChainFromRelevantClose = false;
      }
      depth = Math.max(0, depth - 1);
    } else if (!/\s/.test(character)) {
      canChainFromRelevantClose = false;
    }
  }
  return { hasUnmatchedClosingParenthesis, matches };
}

function matchingParenOffset(
  matchingParentheses: ReadonlyMap<number, number>,
  openOffset: number,
): number | null {
  return matchingParentheses.get(openOffset) ?? null;
}

function firstNonWhitespace(text: string, offset: number): number | null {
  for (let index = offset; index < text.length; index += 1) {
    if (!/\s/.test(text[index] ?? "")) {
      return index;
    }
  }
  return null;
}
