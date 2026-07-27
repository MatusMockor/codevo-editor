import { maskJavaScriptSource } from "./javascriptSourceMask";
import { computeLineStartOffsets, lineColumnAt } from "./sourceLineOffsets";

const HTTP_METHODS = "get|post|put|patch|delete|options|head|all|use";
const HTTP_METHOD_SET = new Set(HTTP_METHODS.split("|"));
const directRoutePattern = new RegExp(
  `(^|[^\\w$])(app|router)\\s*\\.\\s*(${HTTP_METHODS})\\s*\\(`,
  "gm",
);
const routeCallPattern = new RegExp(`(^|[^\\w$])(app|router)\\s*\\.\\s*route\\s*\\(`, "gm");
const MAX_LEXICAL_SHADOW_RANGES = 20_000;
const MAX_LEXICAL_PARENTHESIS_PAIRS = 131_072;
const MAX_ARROW_EXPRESSION_CHARACTERS = 4_096;

export interface ExpressRoute {
  column: number;
  line: number;
  method: string;
  path: string;
  receiver: string;
}

export interface BoundedExpressRoutes {
  readonly routes: ExpressRoute[];
  readonly truncated: boolean;
}

/** Extracts conservative, statically navigable routes from one JS/TS source. */
export function expressRoutesInSource(source: string): ExpressRoute[] {
  return expressRoutesInSourceBounded(source, Number.POSITIVE_INFINITY).routes;
}

/** Extracts at most `maxRoutes`, stopping after one additional route proves truncation. */
export function expressRoutesInSourceBounded(
  source: string,
  maxRoutes: number,
): BoundedExpressRoutes {
  if (!/\b(?:app|router)\b/.test(source)) return { routes: [], truncated: false };
  return extractRoutes(
    source,
    maxRoutes,
    directRoutePattern,
    routeCallPattern,
    ["app", "router"],
    ["app", "router"],
  );
}

/** Extracts routes for an explicit, statically established receiver allowlist. */
export function expressRoutesForReceiversInSourceBounded(
  source: string,
  receivers: readonly string[],
  maxRoutes: number,
): BoundedExpressRoutes {
  const selected = [...new Set(receivers)].filter(isJavaScriptIdentifier).sort();
  if (selected.length === 0) return { routes: [], truncated: false };

  const receiverPattern = selected.map(escapeRegExp).join("|");
  return extractRoutes(
    source,
    maxRoutes,
    new RegExp(`(^|[^\\w$])(${receiverPattern})\\s*\\.\\s*(${HTTP_METHODS})\\s*\\(`, "gm"),
    new RegExp(`(^|[^\\w$])(${receiverPattern})\\s*\\.\\s*route\\s*\\(`, "gm"),
    selected,
    [],
  );
}

function extractRoutes(
  source: string,
  maxRoutes: number,
  directPattern: RegExp,
  chainedPattern: RegExp,
  receivers: readonly string[],
  topLevelShadowReceivers: readonly string[],
): BoundedExpressRoutes {
  const masked = maskJavaScriptSource(source);
  const lexicalShadows = collectLexicalShadowRanges(masked, receivers, topLevelShadowReceivers);
  if (lexicalShadows.truncated) return { routes: [], truncated: true };
  const lineStarts = computeLineStartOffsets(source);
  const limit = Number.isFinite(maxRoutes) ? Math.max(0, Math.floor(maxRoutes)) : Infinity;
  const direct = directRouteCandidates(
    source,
    masked,
    lineStarts,
    directPattern,
    lexicalShadows.byReceiver,
  )[Symbol.iterator]();
  const chained = chainedRouteCandidates(
    source,
    masked,
    lineStarts,
    chainedPattern,
    lexicalShadows.byReceiver,
    lexicalShadows.parenthesisClosingByOpen,
  )[Symbol.iterator]();
  let directNext = direct.next();
  let chainedNext = chained.next();
  const routes: ExpressRoute[] = [];

  while (!directNext.done || !chainedNext.done) {
    const takeDirect =
      chainedNext.done || (!directNext.done && directNext.value.offset <= chainedNext.value.offset);
    const candidate = takeDirect ? directNext.value : chainedNext.value;
    if (routes.length >= limit) return { routes, truncated: true };
    const { offset: _offset, ...route } = candidate;
    routes.push(route);
    if (takeDirect) directNext = direct.next();
    else chainedNext = chained.next();
  }

  return { routes, truncated: false };
}

type ExpressRouteCandidate = ExpressRoute & { readonly offset: number };

function* directRouteCandidates(
  source: string,
  masked: string,
  lineStarts: number[],
  pattern: RegExp = directRoutePattern,
  lexicalShadows: ReadonlyMap<string, readonly OffsetRange[]> = new Map(),
): Generator<ExpressRouteCandidate> {
  for (const match of masked.matchAll(pattern)) {
    const matchOffset = match.index ?? 0;
    const receiverOffset = matchOffset + (match[1]?.length ?? 0);
    if (!isStandaloneReceiver(masked, receiverOffset)) continue;
    const receiver = match[2] ?? "";
    if (isOffsetInRanges(receiverOffset, lexicalShadows.get(receiver) ?? [])) continue;
    const openOffset = matchOffset + match[0].lastIndexOf("(");
    const path = staticStringArgument(source, openOffset + 1);
    if (path === null) continue;
    const position = lineColumnAt(lineStarts, receiverOffset);
    yield {
      column: position.column,
      line: position.lineNumber,
      method: (match[3] ?? "").toUpperCase(),
      offset: receiverOffset,
      path,
      receiver,
    };
  }
}

function* chainedRouteCandidates(
  source: string,
  masked: string,
  lineStarts: number[],
  pattern: RegExp = routeCallPattern,
  lexicalShadows: ReadonlyMap<string, readonly OffsetRange[]> = new Map(),
  parenthesisClosingByOpen: ReadonlyMap<number, number> = new Map(),
): Generator<ExpressRouteCandidate> {
  const matches = masked.matchAll(pattern)[Symbol.iterator]();
  let nextMatch = matches.next();
  const pending: Array<{
    iterator: Generator<ExpressRouteCandidate>;
    next: IteratorYieldResult<ExpressRouteCandidate>;
  }> = [];

  while (!nextMatch.done || pending.length > 0) {
    const pendingIndex = indexOfLowestOffset(pending);
    const pendingOffset = pendingIndex < 0 ? Infinity : pending[pendingIndex]!.next.value.offset;
    const nextMatchOffset = nextMatch.done ? Infinity : (nextMatch.value.index ?? 0);
    if (!nextMatch.done && nextMatchOffset < pendingOffset) {
      const iterator = routeChainCandidatesForMatch(
        source,
        masked,
        lineStarts,
        nextMatch.value,
        lexicalShadows,
        parenthesisClosingByOpen,
      );
      const next = iterator.next();
      if (!next.done) pending.push({ iterator, next });
      nextMatch = matches.next();
      continue;
    }

    const selected = pending[pendingIndex]!;
    yield selected.next.value;
    const next = selected.iterator.next();
    if (next.done) pending.splice(pendingIndex, 1);
    else selected.next = next;
  }
}

function* routeChainCandidatesForMatch(
  source: string,
  masked: string,
  lineStarts: number[],
  match: RegExpMatchArray,
  lexicalShadows: ReadonlyMap<string, readonly OffsetRange[]>,
  parenthesisClosingByOpen: ReadonlyMap<number, number>,
): Generator<ExpressRouteCandidate> {
  const matchOffset = match.index ?? 0;
  const receiverOffset = matchOffset + (match[1]?.length ?? 0);
  if (!isStandaloneReceiver(masked, receiverOffset)) return;
  const receiver = match[2] ?? "";
  if (isOffsetInRanges(receiverOffset, lexicalShadows.get(receiver) ?? [])) return;
  const routeOpenOffset = matchOffset + match[0].lastIndexOf("(");
  const path = staticStringArgument(source, routeOpenOffset + 1);
  if (path === null) return;
  const routeCloseOffset = parenthesisClosingByOpen.get(routeOpenOffset);
  if (routeCloseOffset === undefined) return;

  let cursor = skipMaskedWhitespace(masked, routeCloseOffset + 1);
  while (masked[cursor] === ".") {
    const methodOffset = cursor;
    cursor = skipMaskedWhitespace(masked, cursor + 1);
    const methodStart = cursor;
    while (/[\w$]/.test(masked[cursor] ?? "")) cursor += 1;
    const method = masked.slice(methodStart, cursor);
    if (!HTTP_METHOD_SET.has(method)) break;
    cursor = skipMaskedWhitespace(masked, cursor);
    if (masked[cursor] !== "(") break;
    const methodCloseOffset = parenthesisClosingByOpen.get(cursor);
    if (methodCloseOffset === undefined) break;

    const position = lineColumnAt(lineStarts, methodOffset);
    yield {
      column: position.column,
      line: position.lineNumber,
      method: method.toUpperCase(),
      offset: methodOffset,
      path,
      receiver,
    };
    cursor = skipMaskedWhitespace(masked, methodCloseOffset + 1);
  }
}

interface OffsetRange {
  readonly end: number;
  readonly start: number;
}

interface LexicalShadowRanges {
  readonly byReceiver: ReadonlyMap<string, readonly OffsetRange[]>;
  readonly parenthesisClosingByOpen: ReadonlyMap<number, number>;
  readonly truncated: boolean;
}

interface LocalShadowDeclaration {
  readonly conventionalAuthority: boolean;
  readonly kind: "class" | "const" | "function" | "let" | "var";
  readonly offset: number;
  readonly receiver: string;
}

function collectLexicalShadowRanges(
  masked: string,
  receivers: readonly string[],
  topLevelShadowReceivers: readonly string[],
): LexicalShadowRanges {
  const selected = [...new Set(receivers)].filter(isJavaScriptIdentifier);
  const selectedSet = new Set(selected);
  const byReceiver = new Map<string, OffsetRange[]>(selected.map((receiver) => [receiver, []]));
  if (selected.length === 0) {
    return { byReceiver, parenthesisClosingByOpen: new Map(), truncated: false };
  }
  const receiverPattern = selected.map(escapeRegExp).join("|");
  const topLevelShadows = new Set(topLevelShadowReceivers);
  const braceResult = collectBracePairs(masked);
  if (braceResult.truncated) {
    return {
      byReceiver,
      parenthesisClosingByOpen: braceResult.parenthesisClosingByOpen,
      truncated: true,
    };
  }
  const bracePairs = braceResult.pairs;
  const parenthesisClosingByOpen = braceResult.parenthesisClosingByOpen;
  const parenthesisOpeningByClose = braceResult.parenthesisOpeningByClose;
  const functionBodyOpens = new Set<number>();
  const staticBlockOpens = new Set<number>();
  for (const match of masked.matchAll(/\bstatic\s*\{/g)) {
    const open = (match.index ?? 0) + match[0].lastIndexOf("{");
    if (bracePairs.has(open)) staticBlockOpens.add(open);
  }
  let used = 0;
  let truncated = false;
  const add = (receiver: string, range: OffsetRange) => {
    if (range.end <= range.start || truncated) return;
    used += 1;
    if (used > MAX_LEXICAL_SHADOW_RANGES) {
      truncated = true;
      return;
    }
    byReceiver.get(receiver)?.push(range);
  };

  const functionPattern = /\bfunction\s*\*?(?:\s+[A-Za-z_$][\w$]{0,511})?\s*\(/g;
  for (const match of masked.matchAll(functionPattern)) {
    const parametersOpen = (match.index ?? 0) + match[0].lastIndexOf("(");
    const parametersClose = parenthesisClosingByOpen.get(parametersOpen);
    if (parametersClose === undefined) continue;
    const open = functionBodyOpeningAfterParameters(masked, parametersClose);
    if (open === "truncated") {
      truncated = true;
      break;
    }
    if (open === null) continue;
    const end = bracePairs.get(open);
    if (end === undefined) continue;
    functionBodyOpens.add(open);
    const parameters = masked.slice(parametersOpen + 1, parametersClose);
    for (const receiver of declaredSelectedReceivers(parameters, selectedSet)) {
      add(receiver, { end, start: open + 1 });
    }
  }

  // Restrict the bare-parameter alternative to the receiver allowlist. A generic
  // `identifier* =>` pattern can backtrack quadratically on a multi-megabyte
  // identifier-like source with no arrow.
  const arrowBlockPattern = new RegExp(
    `(?:\\(([^()]{0,4096})\\)|(${receiverPattern}))\\s*(?::\\s*[^={;\\r\\n]{0,4096})?=>\\s*\\{`,
    "g",
  );
  for (const match of masked.matchAll(arrowBlockPattern)) {
    const open = (match.index ?? 0) + match[0].lastIndexOf("{");
    const end = bracePairs.get(open);
    if (end === undefined) continue;
    functionBodyOpens.add(open);
    const parameters = match[1] ?? match[2] ?? "";
    for (const receiver of declaredSelectedReceivers(parameters, selectedSet)) {
      add(receiver, { end, start: open + 1 });
    }
  }

  const methodPattern =
    /\b([A-Za-z_$][\w$]{0,511})\s*\(([^()]{0,4096})\)\s*(?::\s*[^={;\r\n]{0,4096})?\s*\{/g;
  const nonMethodKeywords = new Set(["catch", "for", "if", "switch", "while", "with"]);
  for (const match of masked.matchAll(methodPattern)) {
    if (nonMethodKeywords.has(match[1] ?? "")) continue;
    const open = (match.index ?? 0) + match[0].lastIndexOf("{");
    const end = bracePairs.get(open);
    if (end === undefined) continue;
    functionBodyOpens.add(open);
    for (const receiver of declaredSelectedReceivers(match[2] ?? "", selectedSet)) {
      add(receiver, { end, start: open + 1 });
    }
  }

  const balancedMethodPattern = /\b([A-Za-z_$][\w$]{0,511})\s*\(/g;
  let balancedMethodCandidates = 0;
  for (const match of masked.matchAll(balancedMethodPattern)) {
    if (nonMethodKeywords.has(match[1] ?? "")) continue;
    const previousOffset = previousNonWhitespaceOffset(masked, (match.index ?? 0) - 1);
    if (previousOffset === "truncated") {
      truncated = true;
      break;
    }
    if (previousOffset >= 0 && masked[previousOffset] === ".") continue;
    balancedMethodCandidates += 1;
    if (balancedMethodCandidates > MAX_LEXICAL_SHADOW_RANGES) {
      truncated = true;
      break;
    }
    const parametersOpen = (match.index ?? 0) + match[0].indexOf("(");
    const parametersClose = parenthesisClosingByOpen.get(parametersOpen);
    if (parametersClose === undefined) continue;
    const open = functionBodyOpeningAfterParameters(masked, parametersClose);
    if (open === "truncated") {
      truncated = true;
      break;
    }
    if (open === null) continue;
    const end = bracePairs.get(open);
    if (end === undefined) continue;
    const parameters = masked.slice(parametersOpen + 1, parametersClose);
    const declaredReceivers = declaredSelectedReceivers(parameters, selectedSet);
    if (declaredReceivers.length === 0) continue;
    functionBodyOpens.add(open);
    for (const receiver of declaredReceivers) add(receiver, { end, start: open + 1 });
  }

  const arrowExpressionPattern = new RegExp(
    `(?:\\(([^()]{0,4096})\\)|(${receiverPattern}))[ \\t]*(?::[ \\t]*[^=;\\r\\n]{0,4096})?=>`,
    "g",
  );
  for (const match of masked.matchAll(arrowExpressionPattern)) {
    const parameters = match[1] ?? match[2] ?? "";
    const bodySearchStart = (match.index ?? 0) + match[0].length;
    const bodySearchEnd = Math.min(
      masked.length,
      bodySearchStart + MAX_ARROW_EXPRESSION_CHARACTERS,
    );
    let bodyStart = bodySearchStart;
    while (bodyStart < bodySearchEnd && /\s/.test(masked[bodyStart] ?? "")) bodyStart += 1;
    if (bodyStart >= bodySearchEnd && bodySearchEnd < masked.length) {
      truncated = true;
      break;
    }
    if (masked[bodyStart] === "{") continue;
    const end = arrowExpressionEnd(masked, bodyStart);
    if (end === null) {
      truncated = true;
      break;
    }
    for (const receiver of declaredSelectedReceivers(parameters, selectedSet)) {
      add(receiver, { end, start: bodyStart });
    }
  }

  let balancedArrowCandidates = 0;
  for (const match of masked.matchAll(/=>/g)) {
    balancedArrowCandidates += 1;
    if (balancedArrowCandidates > MAX_LEXICAL_SHADOW_RANGES) {
      truncated = true;
      break;
    }
    const arrowOffset = match.index ?? 0;
    const parametersClose = previousNonWhitespaceOffset(masked, arrowOffset - 1);
    if (parametersClose === "truncated") {
      truncated = true;
      break;
    }
    if (parametersClose < 0 || masked[parametersClose] !== ")") continue;
    const parametersOpen = parenthesisOpeningByClose.get(parametersClose);
    if (parametersOpen === undefined) continue;
    const parameters = masked.slice(parametersOpen + 1, parametersClose);
    const declaredReceivers = declaredSelectedReceivers(parameters, selectedSet);
    if (declaredReceivers.length === 0) continue;
    const bodySearchStart = arrowOffset + 2;
    const bodySearchEnd = Math.min(
      masked.length,
      bodySearchStart + MAX_ARROW_EXPRESSION_CHARACTERS,
    );
    let bodyStart = bodySearchStart;
    while (bodyStart < bodySearchEnd && /\s/.test(masked[bodyStart] ?? "")) bodyStart += 1;
    if (bodyStart >= bodySearchEnd && bodySearchEnd < masked.length) {
      truncated = true;
      break;
    }
    if (masked[bodyStart] === "{") {
      const end = bracePairs.get(bodyStart);
      if (end !== undefined) {
        functionBodyOpens.add(bodyStart);
        for (const receiver of declaredReceivers) {
          add(receiver, { end, start: bodyStart + 1 });
        }
      }
      continue;
    }
    const end = arrowExpressionEnd(masked, bodyStart);
    if (end === null) {
      truncated = true;
      break;
    }
    for (const receiver of declaredReceivers) add(receiver, { end, start: bodyStart });
  }

  const catchPattern = /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*\{/g;
  for (const match of masked.matchAll(catchPattern)) {
    const receiver = match[1] ?? "";
    if (!byReceiver.has(receiver)) continue;
    const open = (match.index ?? 0) + match[0].lastIndexOf("{");
    const end = bracePairs.get(open);
    if (end !== undefined) add(receiver, { end, start: open + 1 });
  }
  const destructuredCatchPattern = /\bcatch\s*\(\s*([[{][^)\r\n]{0,4096})\)\s*\{/g;
  for (const match of masked.matchAll(destructuredCatchPattern)) {
    const open = (match.index ?? 0) + match[0].lastIndexOf("{");
    const end = bracePairs.get(open);
    if (end === undefined) continue;
    for (const receiver of declaredSelectedReceivers(match[1] ?? "", selectedSet)) {
      add(receiver, { end, start: open + 1 });
    }
  }

  const declarations: LocalShadowDeclaration[] = [];
  const localPattern = new RegExp(
    `\\b(const|let|var|class|function)(?:\\s*\\*)?\\s+(${receiverPattern})\\b`,
    "g",
  );
  for (const match of masked.matchAll(localPattern)) {
    const kind = (match[1] ?? "const") as LocalShadowDeclaration["kind"];
    if (kind === "function" || kind === "class") {
      const previousOffset = previousNonWhitespaceOffset(masked, (match.index ?? 0) - 1);
      if (previousOffset === "truncated") {
        truncated = true;
        break;
      }
      if (isNamedExpressionContext(masked, previousOffset)) {
        const bodyOpen = namedExpressionBodyOpen(
          masked,
          (match.index ?? 0) + match[0].length,
          kind,
          parenthesisClosingByOpen,
        );
        const bodyEnd = bodyOpen === null ? undefined : bracePairs.get(bodyOpen);
        if (bodyOpen !== null && bodyEnd !== undefined) {
          if (kind === "function") functionBodyOpens.add(bodyOpen);
          add(match[2] ?? "", { end: bodyEnd, start: bodyOpen + 1 });
        }
        continue;
      }
    }
    declarations.push({
      conventionalAuthority: hasConventionalExpressInitializer(
        masked,
        (match.index ?? 0) + match[0].length,
      ),
      kind,
      offset: match.index ?? 0,
      receiver: match[2] ?? "",
    });
    if (declarations.length > MAX_LEXICAL_SHADOW_RANGES) {
      truncated = true;
      break;
    }
  }
  const destructuredLocalPattern =
    /\b(const|let|var)\s+(\{[^}\r\n]{0,4096}\}|\[[^\]\r\n]{0,4096}\])/g;
  for (const match of masked.matchAll(destructuredLocalPattern)) {
    for (const receiver of declaredSelectedReceivers(match[2] ?? "", selectedSet)) {
      declarations.push({
        conventionalAuthority: false,
        kind: (match[1] ?? "const") as LocalShadowDeclaration["kind"],
        offset: match.index ?? 0,
        receiver,
      });
      if (declarations.length > MAX_LEXICAL_SHADOW_RANGES) {
        truncated = true;
        break;
      }
    }
    if (truncated) break;
  }
  declarations.sort((left, right) => left.offset - right.offset);
  addLocalDeclarationRanges(
    masked,
    declarations,
    bracePairs,
    parenthesisClosingByOpen,
    functionBodyOpens,
    staticBlockOpens,
    topLevelShadows,
    add,
  );

  for (const [receiver, ranges] of byReceiver) {
    ranges.sort((left, right) => left.start - right.start || left.end - right.end);
    byReceiver.set(receiver, mergeOffsetRanges(ranges));
  }
  return { byReceiver, parenthesisClosingByOpen, truncated };
}

function isNamedExpressionContext(masked: string, previousOffset: number): boolean {
  if (previousOffset < 0) return false;
  if ("=(:,[!?><+-*/%&|^~".includes(masked[previousOffset] ?? "")) return true;
  const previousWord = identifierAtEnd(masked, previousOffset);
  if (!previousWord) return false;
  if (
    [
      "await",
      "delete",
      "in",
      "instanceof",
      "new",
      "return",
      "throw",
      "typeof",
      "void",
      "yield",
    ].includes(previousWord.value)
  ) {
    return true;
  }
  if (previousWord.value !== "async") return false;
  const beforeAsync = previousNonWhitespaceOffset(masked, previousWord.start - 1);
  return beforeAsync !== "truncated" && isNamedExpressionContext(masked, beforeAsync);
}

function namedExpressionBodyOpen(
  masked: string,
  afterName: number,
  kind: "class" | "function",
  parenthesisClosingByOpen: ReadonlyMap<number, number>,
): number | null {
  let offset = skipMaskedWhitespace(masked, afterName);
  if (kind === "function") {
    if (masked[offset] !== "(") return null;
    const parametersClose = parenthesisClosingByOpen.get(offset);
    if (parametersClose === undefined) return null;
    const bodyOpen = functionBodyOpeningAfterParameters(masked, parametersClose);
    return typeof bodyOpen === "number" ? bodyOpen : null;
  }
  const scanEnd = Math.min(masked.length, offset + MAX_ARROW_EXPRESSION_CHARACTERS);
  while (offset < scanEnd) {
    if (masked[offset] === "{") return offset;
    if (masked[offset] === "(") {
      const close = parenthesisClosingByOpen.get(offset);
      if (close === undefined || close >= scanEnd) return null;
      offset = close + 1;
      continue;
    }
    if (masked[offset] === "[") {
      const close = matchingSquareBracket(masked, offset, scanEnd);
      if (close === null) return null;
      offset = close + 1;
      continue;
    }
    offset += 1;
  }
  return null;
}

function identifierAtEnd(
  masked: string,
  end: number,
): { readonly start: number; readonly value: string } | null {
  if (!/[A-Za-z0-9_$]/.test(masked[end] ?? "")) return null;
  let start = end;
  while (start > 0 && /[A-Za-z0-9_$]/.test(masked[start - 1] ?? "")) start -= 1;
  const identifier = masked.slice(start, end + 1);
  return isJavaScriptIdentifier(identifier) ? { start, value: identifier } : null;
}

function matchingSquareBracket(masked: string, open: number, scanEnd: number): number | null {
  let depth = 0;
  for (let offset = open; offset < scanEnd; offset += 1) {
    if (masked[offset] === "[") depth += 1;
    else if (masked[offset] === "]") {
      depth -= 1;
      if (depth === 0) return offset;
    }
  }
  return null;
}

function collectBracePairs(masked: string): {
  readonly parenthesisClosingByOpen: ReadonlyMap<number, number>;
  readonly parenthesisOpeningByClose: ReadonlyMap<number, number>;
  readonly pairs: ReadonlyMap<number, number>;
  readonly truncated: boolean;
} {
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  const parenthesisClosingByOpen = new Map<number, number>();
  const parenthesisOpeningByClose = new Map<number, number>();
  const parenthesisStack: number[] = [];
  for (let offset = 0; offset < masked.length; offset += 1) {
    if (masked[offset] === "{") {
      if (stack.length + pairs.size >= MAX_LEXICAL_SHADOW_RANGES) {
        return {
          pairs,
          parenthesisClosingByOpen,
          parenthesisOpeningByClose,
          truncated: true,
        };
      }
      stack.push(offset);
    } else if (masked[offset] === "}") {
      const open = stack.pop();
      if (open !== undefined) pairs.set(open, offset);
    } else if (masked[offset] === "(") {
      if (
        parenthesisStack.length + parenthesisClosingByOpen.size >=
        MAX_LEXICAL_PARENTHESIS_PAIRS
      ) {
        return {
          pairs,
          parenthesisClosingByOpen,
          parenthesisOpeningByClose,
          truncated: true,
        };
      }
      parenthesisStack.push(offset);
    } else if (masked[offset] === ")") {
      const open = parenthesisStack.pop();
      if (open !== undefined) {
        parenthesisClosingByOpen.set(open, offset);
        parenthesisOpeningByClose.set(offset, open);
      }
    }
  }
  return {
    pairs,
    parenthesisClosingByOpen,
    parenthesisOpeningByClose,
    truncated: false,
  };
}

function addLocalDeclarationRanges(
  masked: string,
  declarations: readonly LocalShadowDeclaration[],
  bracePairs: ReadonlyMap<number, number>,
  parenthesisClosingByOpen: ReadonlyMap<number, number>,
  functionBodyOpens: ReadonlySet<number>,
  staticBlockOpens: ReadonlySet<number>,
  topLevelShadowReceivers: ReadonlySet<string>,
  add: (receiver: string, range: OffsetRange) => void,
): void {
  if (declarations.length === 0) return;
  const stack: number[] = [];
  const functionStack: number[] = [];
  const parenthesisStack: number[] = [];
  const staticBlockStack: number[] = [];
  let declarationIndex = 0;
  for (
    let offset = 0;
    offset < masked.length && declarationIndex < declarations.length;
    offset += 1
  ) {
    while (declarations[declarationIndex]?.offset === offset) {
      const declaration = declarations[declarationIndex];
      const open = stack[stack.length - 1];
      const end = open === undefined ? undefined : bracePairs.get(open);
      if (declaration) {
        const forRange =
          declaration.kind === "const" || declaration.kind === "let"
            ? lexicalForBindingRange(
                masked,
                parenthesisStack[parenthesisStack.length - 1],
                parenthesisClosingByOpen,
                bracePairs,
              )
            : null;
        if (forRange) {
          add(declaration.receiver, forRange);
        } else if (
          end === undefined &&
          topLevelShadowReceivers.has(declaration.receiver) &&
          !declaration.conventionalAuthority
        ) {
          add(declaration.receiver, { end: masked.length, start: 0 });
        } else if (end !== undefined) {
          const functionOpen =
            declaration.kind === "var" ? functionStack[functionStack.length - 1] : undefined;
          const staticBlockOpen =
            declaration.kind === "var" ? staticBlockStack[staticBlockStack.length - 1] : undefined;
          const varScopeOpen =
            functionOpen !== undefined &&
            (staticBlockOpen === undefined || functionOpen > staticBlockOpen)
              ? functionOpen
              : staticBlockOpen;
          const varScopeEnd =
            varScopeOpen === undefined ? masked.length : bracePairs.get(varScopeOpen);
          if (declaration.kind !== "var" || varScopeEnd !== undefined) {
            add(declaration.receiver, {
              end: declaration.kind === "var" ? (varScopeEnd ?? masked.length) : end,
              start:
                declaration.kind === "var"
                  ? varScopeOpen === undefined
                    ? 0
                    : varScopeOpen + 1
                  : open + 1,
            });
          }
        }
      }
      declarationIndex += 1;
    }
    if (masked[offset] === "{") {
      stack.push(offset);
      if (functionBodyOpens.has(offset)) functionStack.push(offset);
      if (staticBlockOpens.has(offset)) staticBlockStack.push(offset);
    } else if (masked[offset] === "}") {
      const open = stack.pop();
      if (open === functionStack[functionStack.length - 1]) functionStack.pop();
      if (open === staticBlockStack[staticBlockStack.length - 1]) staticBlockStack.pop();
    } else if (masked[offset] === "(") {
      parenthesisStack.push(offset);
    } else if (masked[offset] === ")") {
      parenthesisStack.pop();
    }
  }
}

function hasConventionalExpressInitializer(masked: string, from: number): boolean {
  const initializer = masked
    .slice(from, from + 1_024)
    .match(/^\s*(?::\s*[^=;\r\n]{0,512})?\s*=\s*([A-Za-z_$][\w$]*)(?:\s*\.\s*(Router))?\s*\(/);
  return initializer?.[1] === "Router" || initializer?.[1] === "express";
}

function lexicalForBindingRange(
  masked: string,
  parenthesisOpen: number | undefined,
  parenthesisClosingByOpen: ReadonlyMap<number, number>,
  bracePairs: ReadonlyMap<number, number>,
): OffsetRange | null {
  if (parenthesisOpen === undefined) return null;
  const prefix = masked.slice(Math.max(0, parenthesisOpen - 24), parenthesisOpen);
  if (!/\bfor(?:\s+await)?\s*$/.test(prefix)) return null;
  const close = parenthesisClosingByOpen.get(parenthesisOpen);
  if (close === undefined) return null;
  const bodyOpen = skipMaskedWhitespace(masked, close + 1);
  const bodyEnd = masked[bodyOpen] === "{" ? bracePairs.get(bodyOpen) : undefined;
  if (bodyEnd !== undefined) return { end: bodyEnd, start: parenthesisOpen + 1 };
  const statementEnd = singleStatementEnd(masked, bodyOpen);
  return statementEnd === null ? null : { end: statementEnd, start: parenthesisOpen + 1 };
}

function singleStatementEnd(masked: string, start: number): number | null {
  const scanEnd = Math.min(masked.length, start + MAX_ARROW_EXPRESSION_CHARACTERS);
  const stack: string[] = [];
  const closingByOpening: Readonly<Record<string, string>> = {
    "(": ")",
    "[": "]",
    "{": "}",
  };
  for (let offset = start; offset < scanEnd; offset += 1) {
    const character = masked[offset] ?? "";
    if (character in closingByOpening) stack.push(character);
    else if (closingByOpening[stack[stack.length - 1] ?? ""] === character) stack.pop();
    else if (stack.length === 0 && character === ";") return offset;
  }
  return scanEnd === masked.length ? masked.length : null;
}

function previousNonWhitespaceOffset(masked: string, from: number): number | "truncated" {
  const scanStart = Math.max(0, from - MAX_ARROW_EXPRESSION_CHARACTERS);
  let offset = from;
  while (offset >= scanStart && /\s/.test(masked[offset] ?? "")) offset -= 1;
  if (offset < scanStart && scanStart > 0) return "truncated";
  return offset;
}

function functionBodyOpeningAfterParameters(
  masked: string,
  parametersClose: number,
): number | null | "truncated" {
  const scanEnd = Math.min(masked.length, parametersClose + MAX_ARROW_EXPRESSION_CHARACTERS);
  let offset = parametersClose + 1;
  while (offset < scanEnd && /\s/.test(masked[offset] ?? "")) offset += 1;
  if (masked[offset] === ":") {
    offset += 1;
    while (
      offset < scanEnd &&
      masked[offset] !== "{" &&
      masked[offset] !== ";" &&
      masked[offset] !== "="
    ) {
      offset += 1;
    }
  }
  while (offset < scanEnd && /\s/.test(masked[offset] ?? "")) offset += 1;
  if (masked[offset] === "{") return offset;
  return offset >= scanEnd && scanEnd < masked.length ? "truncated" : null;
}

function arrowExpressionEnd(masked: string, start: number): number | null {
  const scanEnd = Math.min(masked.length, start + MAX_ARROW_EXPRESSION_CHARACTERS);
  const stack: string[] = [];
  const closingByOpening: Readonly<Record<string, string>> = {
    "(": ")",
    "[": "]",
    "{": "}",
  };
  for (let offset = start; offset < scanEnd; offset += 1) {
    const character = masked[offset] ?? "";
    if (character in closingByOpening) {
      stack.push(character);
      continue;
    }
    const opening = stack[stack.length - 1];
    if (opening && closingByOpening[opening] === character) {
      stack.pop();
      continue;
    }
    if (stack.length === 0 && (character === ";" || character === "," || character === "\n")) {
      return offset;
    }
  }
  return scanEnd === masked.length ? masked.length : null;
}

function parameterListDeclares(parameters: string, receiver: string): boolean {
  const bindingParameters = maskComputedObjectKeys(parameters, receiver);
  if (
    bindingParameters.split(",").some((parameter) => {
      const match = parameter.trim().match(/^(?:\.\.\.\s*)?([A-Za-z_$][\w$]*)\s*(?:\?|:|=|$)/);
      return match?.[1] === receiver;
    })
  ) {
    return true;
  }
  const escaped = escapeRegExp(receiver);
  return (
    new RegExp(`(?:^|[,\\[{])\\s*(?:\\.\\.\\.\\s*)?${escaped}\\s*(?=[,}\\]=])`).test(
      bindingParameters,
    ) || new RegExp(`:\\s*(?:\\.\\.\\.\\s*)?${escaped}\\s*(?=[,}\\]=])`).test(bindingParameters)
  );
}

function maskComputedObjectKeys(parameters: string, receiver: string): string {
  const pattern = new RegExp(`\\[\\s*${escapeRegExp(receiver)}\\s*\\]\\s*(?=:)`, "y");
  const delimiters: string[] = [];
  const maskedRanges: OffsetRange[] = [];
  const closingByOpening: Readonly<Record<string, string>> = {
    "(": ")",
    "[": "]",
    "{": "}",
  };

  for (let offset = 0; offset < parameters.length; offset += 1) {
    const character = parameters[offset] ?? "";
    if (character === "[" && delimiters[delimiters.length - 1] === "{") {
      pattern.lastIndex = offset;
      const match = pattern.exec(parameters);
      if (match) maskedRanges.push({ end: offset + match[0].length, start: offset });
    }
    if (character in closingByOpening) {
      delimiters.push(character);
    } else {
      const opening = delimiters[delimiters.length - 1];
      if (opening && closingByOpening[opening] === character) delimiters.pop();
    }
  }
  if (maskedRanges.length === 0) return parameters;
  const characters = parameters.split("");
  for (const range of maskedRanges) {
    characters.fill(" ", range.start, range.end);
  }
  return characters.join("");
}

function declaredSelectedReceivers(parameters: string, selected: ReadonlySet<string>): string[] {
  const candidates = new Set<string>();
  for (const match of parameters.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const candidate = match[0];
    if (selected.has(candidate)) candidates.add(candidate);
  }
  return [...candidates].filter((candidate) => parameterListDeclares(parameters, candidate));
}

function isOffsetInRanges(offset: number, ranges: readonly OffsetRange[]): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = ranges[middle];
    if (!range) return false;
    if (offset < range.start) high = middle - 1;
    else if (offset >= range.end) low = middle + 1;
    else return true;
  }
  return false;
}

function mergeOffsetRanges(ranges: readonly OffsetRange[]): OffsetRange[] {
  const merged: OffsetRange[] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (!previous || range.start > previous.end) {
      merged.push(range);
    } else if (range.end > previous.end) {
      merged[merged.length - 1] = { end: range.end, start: previous.start };
    }
  }
  return merged;
}

function isJavaScriptIdentifier(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function indexOfLowestOffset(
  pending: readonly { readonly next: IteratorYieldResult<ExpressRouteCandidate> }[],
): number {
  let selected = -1;
  for (let index = 0; index < pending.length; index += 1) {
    if (selected < 0 || pending[index]!.next.value.offset < pending[selected]!.next.value.offset) {
      selected = index;
    }
  }
  return selected;
}

function isStandaloneReceiver(source: string, receiverOffset: number): boolean {
  let index = receiverOffset - 1;
  while (index >= 0 && /\s/.test(source[index] ?? "")) index -= 1;
  return source[index] !== ".";
}

function staticStringArgument(source: string, from: number): string | null {
  return staticJavaScriptStringArgumentAt(source, from)?.value ?? null;
}

export function staticJavaScriptStringArgumentAt(
  source: string,
  from: number,
): { readonly endOffset: number; readonly value: string } | null {
  let index = skipTrivia(source, from);
  const quote = source[index];
  if (quote !== "'" && quote !== '"') return null;
  index += 1;
  let value = "";
  while (index < source.length) {
    const character = source[index] ?? "";
    if (character === quote) {
      const argumentEnd = skipTrivia(source, index + 1);
      return source[argumentEnd] === "," || source[argumentEnd] === ")"
        ? { endOffset: argumentEnd, value }
        : null;
    }
    if (character === "\n" || character === "\r") return null;
    if (character === "\\") {
      const escape = decodeStringEscape(source, index + 1);
      if (escape === null) return null;
      value += escape.value;
      index = escape.nextIndex;
      continue;
    }
    value += character;
    index += 1;
  }
  return null;
}

function decodeStringEscape(
  source: string,
  from: number,
): { nextIndex: number; value: string } | null {
  const character = source[from];
  if (character === undefined || character === "\n" || character === "\r") return null;

  const simpleEscapes: Record<string, string> = {
    "'": "'",
    '"': '"',
    "\\": "\\",
    "/": "/",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v",
  };
  if (character in simpleEscapes) {
    return { nextIndex: from + 1, value: simpleEscapes[character] ?? "" };
  }
  if (character === "0" && !/[0-9]/.test(source[from + 1] ?? "")) {
    return { nextIndex: from + 1, value: "\0" };
  }
  if (character === "x") {
    const digits = source.slice(from + 1, from + 3);
    if (!/^[0-9a-f]{2}$/i.test(digits)) return null;
    return { nextIndex: from + 3, value: String.fromCharCode(Number.parseInt(digits, 16)) };
  }
  if (character !== "u") return null;

  if (source[from + 1] === "{") {
    const close = source.indexOf("}", from + 2);
    if (close < 0) return null;
    const digits = source.slice(from + 2, close);
    if (!/^[0-9a-f]{1,6}$/i.test(digits)) return null;
    const codePoint = Number.parseInt(digits, 16);
    if (codePoint > 0x10ffff) return null;
    return { nextIndex: close + 1, value: String.fromCodePoint(codePoint) };
  }

  const digits = source.slice(from + 1, from + 5);
  if (!/^[0-9a-f]{4}$/i.test(digits)) return null;
  return { nextIndex: from + 5, value: String.fromCharCode(Number.parseInt(digits, 16)) };
}

function skipMaskedWhitespace(source: string, from: number): number {
  let index = from;
  while (/\s/.test(source[index] ?? "")) index += 1;
  return index;
}

function skipTrivia(source: string, from: number): number {
  let index = from;
  while (index < source.length) {
    if (/\s/.test(source[index] ?? "")) {
      index += 1;
      continue;
    }
    if (source.slice(index, index + 2) === "//") {
      const newline = source.indexOf("\n", index + 2);
      return newline < 0 ? source.length : skipTrivia(source, newline + 1);
    }
    if (source.slice(index, index + 2) === "/*") {
      const close = source.indexOf("*/", index + 2);
      return close < 0 ? source.length : skipTrivia(source, close + 2);
    }
    return index;
  }
  return index;
}
