import { maskJavaScriptSource } from "./javascriptSourceMask";
import { computeLineStartOffsets, lineColumnAt } from "./sourceLineOffsets";

const HTTP_METHODS = "get|post|put|patch|delete|options|head|all|use";
const HTTP_METHOD_SET = new Set(HTTP_METHODS.split("|"));
const directRoutePattern = new RegExp(
  `(^|[^\\w$])(app|router)\\s*\\.\\s*(${HTTP_METHODS})\\s*\\(`,
  "gm",
);
const routeCallPattern = new RegExp(`(^|[^\\w$])(app|router)\\s*\\.\\s*route\\s*\\(`, "gm");

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
  const masked = maskJavaScriptSource(source);
  const lineStarts = computeLineStartOffsets(source);
  const limit = Number.isFinite(maxRoutes) ? Math.max(0, Math.floor(maxRoutes)) : Infinity;
  const direct = directRouteCandidates(source, masked, lineStarts)[Symbol.iterator]();
  const chained = chainedRouteCandidates(source, masked, lineStarts)[Symbol.iterator]();
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

/** Extracts routes for an explicit, statically established receiver allowlist. */
export function expressRoutesForReceiversInSourceBounded(
  source: string,
  receivers: readonly string[],
  maxRoutes: number,
): BoundedExpressRoutes {
  const selected = [...new Set(receivers)].filter(isJavaScriptIdentifier).sort();
  if (selected.length === 0) return { routes: [], truncated: false };
  if (selected.length === 2 && selected[0] === "app" && selected[1] === "router") {
    return expressRoutesInSourceBounded(source, maxRoutes);
  }

  const receiverPattern = selected.map(escapeRegExp).join("|");
  return extractRoutes(
    source,
    maxRoutes,
    new RegExp(`(^|[^\\w$])(${receiverPattern})\\s*\\.\\s*(${HTTP_METHODS})\\s*\\(`, "gm"),
    new RegExp(`(^|[^\\w$])(${receiverPattern})\\s*\\.\\s*route\\s*\\(`, "gm"),
  );
}

function extractRoutes(
  source: string,
  maxRoutes: number,
  directPattern: RegExp,
  chainedPattern: RegExp,
): BoundedExpressRoutes {
  const masked = maskJavaScriptSource(source);
  const lineStarts = computeLineStartOffsets(source);
  const limit = Number.isFinite(maxRoutes) ? Math.max(0, Math.floor(maxRoutes)) : Infinity;
  const direct = directRouteCandidates(source, masked, lineStarts, directPattern)[
    Symbol.iterator
  ]();
  const chained = chainedRouteCandidates(source, masked, lineStarts, chainedPattern)[
    Symbol.iterator
  ]();
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
): Generator<ExpressRouteCandidate> {
  for (const match of masked.matchAll(pattern)) {
    const matchOffset = match.index ?? 0;
    const receiverOffset = matchOffset + (match[1]?.length ?? 0);
    if (!isStandaloneReceiver(masked, receiverOffset)) continue;
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
      receiver: match[2] ?? "",
    };
  }
}

function* chainedRouteCandidates(
  source: string,
  masked: string,
  lineStarts: number[],
  pattern: RegExp = routeCallPattern,
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
      const iterator = routeChainCandidatesForMatch(source, masked, lineStarts, nextMatch.value);
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
): Generator<ExpressRouteCandidate> {
  const matchOffset = match.index ?? 0;
  const receiverOffset = matchOffset + (match[1]?.length ?? 0);
  if (!isStandaloneReceiver(masked, receiverOffset)) return;
  const routeOpenOffset = matchOffset + match[0].lastIndexOf("(");
  const path = staticStringArgument(source, routeOpenOffset + 1);
  if (path === null) return;
  const routeCloseOffset = closingParenthesis(masked, routeOpenOffset);
  if (routeCloseOffset === null) return;

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
    const methodCloseOffset = closingParenthesis(masked, cursor);
    if (methodCloseOffset === null) break;

    const position = lineColumnAt(lineStarts, methodOffset);
    yield {
      column: position.column,
      line: position.lineNumber,
      method: method.toUpperCase(),
      offset: methodOffset,
      path,
      receiver: match[2] ?? "",
    };
    cursor = skipMaskedWhitespace(masked, methodCloseOffset + 1);
  }
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

function closingParenthesis(source: string, openOffset: number): number | null {
  let depth = 0;
  for (let index = openOffset; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    else if (source[index] === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
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
