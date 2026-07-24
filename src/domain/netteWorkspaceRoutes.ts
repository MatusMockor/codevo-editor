import { netteRoutePresenterTargetsFromSource } from "./latteLinkNavigation";
import { maskPhpSource } from "./phpSourceMask";
import { computeLineStartOffsets, lineColumnAt } from "./sourceLineOffsets";
import { joinWorkspacePath, workspaceRelativePath } from "./workspace";

const MAX_ROUTES = 10_000;
const ROUTE_CONSTRUCTOR = /\bnew\s+(?:\\?Nette\\Application\\Routers\\)?Route\s*\(/g;
const PHP_VARIABLE_ASSIGNMENT = /\$([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
const ROUTE_LIST_ADD_ROUTE = /\$([A-Za-z_][A-Za-z0-9_]*)\s*->\s*addRoute\s*\(/gi;
const ROUTE_LIST_WITH_MODULE = /\$([A-Za-z_][A-Za-z0-9_]*)\s*->\s*withModule\s*\(/gi;
const ROUTE_LIST_CLASS = "Nette\\Application\\Routers\\RouteList";

export interface NetteWorkspaceRouteSourceEntry {
  readonly path: string;
  readonly source: string;
}

export interface NetteWorkspaceRouteOverlay {
  readonly path: string;
  readonly source: string;
}

export interface NetteWorkspaceRouteSource {
  readonly path: string;
  readonly lineNumber: number;
  readonly column: number;
}

export interface NetteWorkspaceRouteTarget {
  readonly raw: string;
  readonly presenter: string;
  readonly action: string | null;
}

export interface NetteWorkspaceRoute {
  readonly key: string;
  readonly mask: string;
  readonly methods: readonly string[];
  readonly target: NetteWorkspaceRouteTarget | null;
  readonly source: NetteWorkspaceRouteSource;
  /** Present for routes registered through the modern RouteList API. */
  readonly registration?: "addRoute";
  /** The statically known third addRoute argument (false when omitted). */
  readonly oneWay?: boolean;
  /** Static RouteList/withModule prefix applied to a relative target. */
  readonly modulePrefix?: string | null;
}

export type NetteWorkspaceRoutesResult =
  | {
      readonly status: "ok";
      readonly routes: readonly NetteWorkspaceRoute[];
      readonly total: number;
      readonly truncated: boolean;
    }
  | { readonly status: "unavailable"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

export interface NetteWorkspaceRoutesProjectionOptions {
  readonly maxRoutes?: number;
}

export function projectNetteWorkspaceRoutes(
  rootPath: string,
  sourceEntries: readonly NetteWorkspaceRouteSourceEntry[],
  overlays: readonly NetteWorkspaceRouteOverlay[] = [],
  options: NetteWorkspaceRoutesProjectionOptions = {},
): NetteWorkspaceRoutesResult {
  if (!rootPath.trim()) {
    return { status: "unavailable", message: "No workspace is open." };
  }

  try {
    const maxRoutes = boundedOption(options.maxRoutes, MAX_ROUTES);
    const sources = effectiveRouteSources(rootPath, sourceEntries, overlays);
    const routes: NetteWorkspaceRoute[] = [];

    for (const entry of sources) {
      const remaining = maxRoutes + 1 - routes.length;
      if (remaining <= 0) break;
      routes.push(...netteWorkspaceRoutesFromSource(entry.path, entry.source, remaining));
    }
    return {
      status: "ok",
      routes: routes.slice(0, maxRoutes),
      total: routes.length,
      truncated: routes.length > maxRoutes,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Rich projection layered on the existing conservative static-target parser. */
export function netteWorkspaceRoutesFromSource(
  path: string,
  source: string,
  maxRoutes = MAX_ROUTES,
): NetteWorkspaceRoute[] {
  const limit = boundedOption(maxRoutes, MAX_ROUTES + 1);
  if (limit === 0) return [];
  const masked = maskPhpSource(source);
  const lineStarts = computeLineStartOffsets(source);
  const routes: { readonly offset: number; readonly route: NetteWorkspaceRoute }[] = [];
  ROUTE_CONSTRUCTOR.lastIndex = 0;

  for (
    let match = ROUTE_CONSTRUCTOR.exec(masked);
    match !== null && routes.length < limit;
    match = ROUTE_CONSTRUCTOR.exec(masked)
  ) {
    const open = match.index + match[0].lastIndexOf("(");
    const close = closingParenthesis(masked, open);
    if (close === null) continue;
    const args = topLevelArgumentRanges(masked, open + 1, close);
    const first = args[0];
    if (!first) continue;
    const literal = staticPhpString(source, first.start, first.end);
    if (!literal) continue;
    const snippet = source.slice(match.index, close + 1);
    const raw = netteRoutePresenterTargetsFromSource(snippet)[0]?.target ?? null;
    routes.push({
      offset: match.index,
      route: {
        key: `nette-route:${encodeURIComponent(path)}:${literal.offset}`,
        mask: literal.value,
        methods: [],
        target: raw ? routeTarget(raw) : null,
        source: { path, ...lineColumnAt(lineStarts, literal.offset) },
      },
    });
    ROUTE_CONSTRUCTOR.lastIndex = Math.max(ROUTE_CONSTRUCTOR.lastIndex, close + 1);
  }

  for (const discovered of routeListRoutesFromSource(path, source, masked, lineStarts, limit)) {
    routes.push(discovered);
  }

  return routes
    .sort((left, right) => left.offset - right.offset)
    .slice(0, limit)
    .map(({ route }) => route);
}

interface RouteListProvenance {
  readonly modulePrefix: string | null;
}

interface RouteListEvent {
  readonly index: number;
  readonly kind: "assignment" | "addRoute" | "withModule";
  readonly match: RegExpExecArray;
}

function routeListRoutesFromSource(
  path: string,
  source: string,
  masked: string,
  lineStarts: readonly number[],
  limit: number,
): { readonly offset: number; readonly route: NetteWorkspaceRoute }[] {
  const routeListAliases = importedRouteListAliasesByScope(masked);
  const events = routeListEvents(masked);
  const contexts = phpEventContexts(
    masked,
    events.map(({ index }) => index),
  );
  const provenance = new Map<string, RouteListProvenance>();
  const routes: { offset: number; route: NetteWorkspaceRoute }[] = [];

  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    if (routes.length >= limit) break;
    const event = events[eventIndex]!;
    const context = contexts[eventIndex]!;
    const scope = context.scope;
    if (context.ambiguous) {
      if (event.kind === "assignment") {
        provenance.delete(`${scope}:${event.match[1]!}`);
      }
      continue;
    }

    if (event.kind === "assignment") {
      const variable = event.match[1]!;
      const key = `${scope}:${variable}`;
      const valueStart = event.match.index + event.match[0].length;
      const routeList = routeListAssignmentValue(
        source,
        masked,
        valueStart,
        scope,
        provenance,
        routeListAliasesForScope(routeListAliases, scope),
      );
      if (routeList) provenance.set(key, routeList);
      else provenance.delete(key);
      continue;
    }

    const receiver = event.match[1]!;
    const receiverRouteList = provenance.get(`${scope}:${receiver}`);
    if (!receiverRouteList) continue;
    const open = event.match.index + event.match[0].lastIndexOf("(");
    const close = closingParenthesis(masked, open);
    if (close === null) continue;

    let modulePrefix = receiverRouteList.modulePrefix;
    let addRouteOpen = open;
    let addRouteOffset = event.match.index;
    if (event.kind === "withModule") {
      const moduleArgs = callArgumentRanges(source, masked, open + 1, close);
      const normalizedModuleArgs = normalizeNamedArguments(masked, moduleArgs, ["module"]);
      const moduleRange = normalizedModuleArgs?.[0];
      if (!moduleRange) continue;
      const module = staticPhpString(source, moduleRange.start, moduleRange.end);
      if (!module) continue;
      modulePrefix = joinModulePrefix(modulePrefix, module.value);
      let chainOffset = close + 1;
      for (;;) {
        const chainedModule = /^\s*->\s*withModule\s*\(/i.exec(masked.slice(chainOffset));
        if (!chainedModule) break;
        const chainedOpen = chainOffset + chainedModule[0].lastIndexOf("(");
        const chainedClose = closingParenthesis(masked, chainedOpen);
        if (chainedClose === null) break;
        const chainedArgs = callArgumentRanges(source, masked, chainedOpen + 1, chainedClose);
        const normalizedChainedArgs = normalizeNamedArguments(masked, chainedArgs, ["module"]);
        const chainedRange = normalizedChainedArgs?.[0];
        if (!chainedRange) break;
        const chainedValue = staticPhpString(source, chainedRange.start, chainedRange.end);
        if (!chainedValue) break;
        modulePrefix = joinModulePrefix(modulePrefix, chainedValue.value);
        chainOffset = chainedClose + 1;
      }
      const chainedAddRoute = /^\s*->\s*addRoute\s*\(/i.exec(masked.slice(chainOffset));
      if (!chainedAddRoute) continue;
      addRouteOpen = chainOffset + chainedAddRoute[0].lastIndexOf("(");
      addRouteOffset = event.match.index;
    }

    const addRouteClose = closingParenthesis(masked, addRouteOpen);
    if (addRouteClose === null) continue;
    const route = addRouteFromArguments(
      path,
      source,
      masked,
      lineStarts,
      addRouteOpen,
      addRouteClose,
      modulePrefix,
    );
    if (route) routes.push({ offset: addRouteOffset, route });
  }

  return routes;
}

function importedRouteListAliasesByScope(masked: string): ReadonlyMap<string, ReadonlySet<string>> {
  const aliases = new Map<string, Set<string>>();
  const namespaces = [
    ...masked.matchAll(/\bnamespace(?:\s+[A-Za-z_\\][A-Za-z0-9_\\]*)?\s*([;{])/gi),
  ];
  if (namespaces.length > 1 && namespaces.some((match) => match[1] === ";")) return aliases;
  const use =
    /\buse\s+Nette\\Application\\Routers\\RouteList(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?\s*;/gi;
  const matches = [...masked.matchAll(use)];
  const contexts = phpEventContexts(
    masked,
    matches.map((match) => match.index),
  );
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const context = contexts[index]!;
    if (!context.allowsNamespaceImport) continue;
    const scoped = aliases.get(context.scope) ?? new Set<string>();
    scoped.add((match[1] ?? "RouteList").toLocaleLowerCase("en-US"));
    aliases.set(context.scope, scoped);
  }
  return aliases;
}

function routeListAliasesForScope(
  aliasesByScope: ReadonlyMap<string, ReadonlySet<string>>,
  scope: string,
): ReadonlySet<string> {
  const aliases = new Set<string>();
  const segments = scope ? scope.split(".") : [];
  for (let length = 0; length <= segments.length; length += 1) {
    const ancestor = segments.slice(0, length).join(".");
    for (const alias of aliasesByScope.get(ancestor) ?? []) aliases.add(alias);
  }
  return aliases;
}

function routeListEvents(masked: string): RouteListEvent[] {
  const events: RouteListEvent[] = [];
  for (const [kind, pattern] of [
    ["assignment", PHP_VARIABLE_ASSIGNMENT],
    ["addRoute", ROUTE_LIST_ADD_ROUTE],
    ["withModule", ROUTE_LIST_WITH_MODULE],
  ] as const) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(masked); match !== null; match = pattern.exec(masked)) {
      events.push({ index: match.index, kind, match });
    }
  }
  return events.sort(
    (left, right) =>
      left.index - right.index || eventPriority(left.kind) - eventPriority(right.kind),
  );
}

function eventPriority(kind: RouteListEvent["kind"]): number {
  return kind === "assignment" ? 0 : kind === "addRoute" ? 1 : 2;
}

function routeListAssignmentValue(
  source: string,
  masked: string,
  start: number,
  scope: string,
  provenance: ReadonlyMap<string, RouteListProvenance>,
  aliases: ReadonlySet<string>,
): RouteListProvenance | null {
  const rest = masked.slice(start);
  const constructed = /^\s*new\s+(\\?[A-Za-z_][A-Za-z0-9_\\]*)\b/.exec(rest);
  if (constructed) {
    const className = constructed[1]!.replace(/^\\/, "").toLocaleLowerCase("en-US");
    if (className !== ROUTE_LIST_CLASS.toLocaleLowerCase("en-US") && !aliases.has(className)) {
      return null;
    }
    const afterClass = skipWhitespace(masked, start + constructed[0].length, masked.length);
    if (masked[afterClass] !== "(") {
      return masked[afterClass] === ";" ? { modulePrefix: null } : null;
    }
    const open = afterClass;
    const close = closingParenthesis(masked, open);
    if (close === null) return null;
    const args = callArgumentRanges(source, masked, open + 1, close);
    const normalized = normalizeNamedArguments(masked, args, ["module"]);
    if (!normalized) return null;
    const moduleRange = normalized[0];
    const module = moduleRange ? staticPhpString(source, moduleRange.start, moduleRange.end) : null;
    if (moduleRange && !module) return null;
    const chain = staticWithModuleChain(source, masked, close + 1, module?.value ?? null);
    return assignmentEndsAt(masked, chain.end) ? { modulePrefix: chain.modulePrefix } : null;
  }

  const child = /^\s*\$([A-Za-z_][A-Za-z0-9_]*)\s*->\s*withModule\s*\(/.exec(rest);
  if (!child) return null;
  const parent = provenance.get(`${scope}:${child[1]!}`);
  if (!parent) return null;
  const chainStart = start + child[0].indexOf("->");
  const chain = staticWithModuleChain(source, masked, chainStart, parent.modulePrefix);
  return chain.count > 0 && assignmentEndsAt(masked, chain.end)
    ? { modulePrefix: chain.modulePrefix }
    : null;
}

function staticWithModuleChain(
  source: string,
  masked: string,
  start: number,
  initialPrefix: string | null,
): { readonly count: number; readonly end: number; readonly modulePrefix: string | null } {
  let count = 0;
  let end = start;
  let modulePrefix = initialPrefix;
  for (;;) {
    const call = /^\s*->\s*withModule\s*\(/i.exec(masked.slice(end));
    if (!call) break;
    const open = end + call[0].lastIndexOf("(");
    const close = closingParenthesis(masked, open);
    if (close === null) break;
    const args = normalizeNamedArguments(
      masked,
      callArgumentRanges(source, masked, open + 1, close),
      ["module"],
    );
    const range = args?.[0];
    if (!range) break;
    const module = staticPhpString(source, range.start, range.end);
    if (!module) break;
    modulePrefix = joinModulePrefix(modulePrefix, module.value);
    count += 1;
    end = close + 1;
  }
  return { count, end, modulePrefix };
}

function assignmentEndsAt(masked: string, offset: number): boolean {
  return masked[skipWhitespace(masked, offset, masked.length)] === ";";
}

function normalizeNamedArguments(
  masked: string,
  args: readonly { readonly start: number; readonly end: number }[],
  names: readonly string[],
): ({ readonly start: number; readonly end: number } | undefined)[] | null {
  if (args.length > names.length) return null;
  const normalized: ({ start: number; end: number } | undefined)[] = Array(names.length);
  let namedArgumentsStarted = false;
  let positionalIndex = 0;
  for (const argument of args) {
    const text = masked.slice(argument.start, argument.end);
    const named = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(text);
    let index: number;
    let valueStart = argument.start;
    if (named) {
      namedArgumentsStarted = true;
      index = names.indexOf(named[1]!);
      if (index < 0) return null;
      valueStart = argument.start + named[0].length;
    } else {
      if (namedArgumentsStarted) return null;
      while (normalized[positionalIndex]) positionalIndex += 1;
      index = positionalIndex;
      positionalIndex += 1;
    }
    if (index >= names.length || normalized[index]) return null;
    normalized[index] = { start: valueStart, end: argument.end };
  }
  return normalized;
}

function addRouteFromArguments(
  path: string,
  source: string,
  masked: string,
  lineStarts: readonly number[],
  open: number,
  close: number,
  modulePrefix: string | null,
): NetteWorkspaceRoute | null {
  const args = normalizeNamedArguments(
    masked,
    callArgumentRanges(source, masked, open + 1, close),
    ["mask", "metadata", "oneWay"],
  );
  if (!args) return null;
  const maskRange = args[0];
  if (!maskRange) return null;
  const mask = staticPhpString(source, maskRange.start, maskRange.end);
  if (!mask) return null;
  const oneWay = staticOneWayArgument(masked, args[2]);
  if (oneWay === null) return null;
  if (!args[1]) return null;
  const rawTarget = staticRouteTarget(source, masked, args[1]);
  if (!rawTarget) return null;
  const prefixedTarget = rawTarget ? prefixRouteTarget(rawTarget, modulePrefix) : null;
  return {
    key: `nette-route:${encodeURIComponent(path)}:${mask.offset}`,
    mask: mask.value,
    methods: [],
    target: prefixedTarget ? routeTarget(prefixedTarget) : null,
    source: { path, ...lineColumnAt(lineStarts, mask.offset) },
    registration: "addRoute",
    oneWay,
    modulePrefix,
  };
}

function staticOneWayArgument(
  masked: string,
  range: { readonly start: number; readonly end: number } | undefined,
): boolean | null {
  if (!range) return false;
  const text = masked.slice(range.start, range.end).trim();
  const value = /^(true|false)$/i.exec(text)?.[1];
  return value ? value.toLowerCase() === "true" : null;
}

function staticRouteTarget(
  source: string,
  masked: string,
  range: { readonly start: number; readonly end: number },
): string | null {
  const literal = staticPhpString(source, range.start, range.end);
  if (literal) return literal.value;
  const start = skipWhitespace(masked, range.start, range.end);
  const end = skipWhitespaceBackward(masked, start, range.end);
  if (masked[start] !== "[" || masked[end - 1] !== "]") return null;
  const values = new Map<string, string>();
  for (const entry of topLevelArgumentRanges(masked, start + 1, end - 1)) {
    if (!masked.slice(entry.start, entry.end).trim()) continue;
    const arrow = topLevelArrayArrow(masked, entry.start, entry.end);
    if (arrow === null) return null;
    const key = staticPhpString(source, entry.start, arrow);
    if (!key) return null;
    if (key.value !== "presenter" && key.value !== "action") continue;
    const value = staticPhpString(source, arrow + 2, entry.end);
    if (!value) return null;
    values.set(key.value, value.value);
  }
  const presenter = values.get("presenter");
  if (!presenter) return null;
  return `${presenter}:${values.get("action") ?? "default"}`;
}

function topLevelArrayArrow(source: string, start: number, end: number): number | null {
  let round = 0;
  let square = 0;
  let curly = 0;
  for (let index = start; index + 1 < end; index += 1) {
    const char = source[index];
    if (char === "(") round += 1;
    else if (char === ")") round -= 1;
    else if (char === "[") square += 1;
    else if (char === "]") square -= 1;
    else if (char === "{") curly += 1;
    else if (char === "}") curly -= 1;
    else if (
      char === "=" &&
      source[index + 1] === ">" &&
      round === 0 &&
      square === 0 &&
      curly === 0
    )
      return index;
  }
  return null;
}

function prefixRouteTarget(raw: string, modulePrefix: string | null): string {
  return modulePrefix && !raw.startsWith(":") ? `${modulePrefix}:${raw}` : raw;
}

function joinModulePrefix(parent: string | null, child: string): string {
  return parent ? `${parent}:${child}` : child;
}

function skipWhitespace(source: string, start: number, end: number): number {
  while (start < end && /\s/.test(source[start] ?? "")) start += 1;
  return start;
}

function skipWhitespaceBackward(source: string, start: number, end: number): number {
  while (end > start && /\s/.test(source[end - 1] ?? "")) end -= 1;
  return end;
}

interface PhpEventContext {
  readonly allowsNamespaceImport: boolean;
  readonly ambiguous: boolean;
  readonly scope: string;
}

function phpEventContexts(masked: string, offsets: readonly number[]): PhpEventContext[] {
  const result: PhpEventContext[] = [];
  const stack: {
    dead: boolean;
    readonly id: number;
    readonly ambiguous: boolean;
    readonly kind: string | null;
  }[] = [];
  let cursor = 0;
  let nextBraceId = 1;
  for (const offset of offsets) {
    while (cursor < offset) {
      const terminator = /^(?:return|throw|exit|die)\b/i.exec(masked.slice(cursor));
      if (terminator && !conditionalTerminatorPrefix(masked, cursor)) {
        let functionIndex = stack.length - 1;
        while (functionIndex >= 0 && stack[functionIndex]?.kind !== "function") {
          functionIndex -= 1;
        }
        if (
          functionIndex >= 0 &&
          !stack.slice(functionIndex + 1).some(({ ambiguous }) => ambiguous)
        ) {
          stack[functionIndex]!.dead = true;
        }
        cursor += terminator[0].length;
        continue;
      }
      if (masked[cursor] === "{") {
        const prefix =
          masked
            .slice(Math.max(0, cursor - 256), cursor)
            .split(/[;{}]/)
            .pop() ?? "";
        const controlFlow =
          /\b(?:if|else|elseif|for|foreach|while|switch|try|catch|finally|do|match)\b[^;{}]*$/i.test(
            prefix,
          );
        const scope = /\b(namespace|class|interface|trait|enum|function)\b[^;{}]*$/i.exec(prefix);
        const ambiguous = controlFlow || !scope;
        stack.push({
          dead: false,
          id: nextBraceId,
          ambiguous,
          kind: scope?.[1]?.toLowerCase() ?? null,
        });
        nextBraceId += 1;
      } else if (masked[cursor] === "}") {
        stack.pop();
      }
      cursor += 1;
    }
    result.push({
      allowsNamespaceImport: stack.every(
        ({ ambiguous, kind }) => !ambiguous && kind === "namespace",
      ),
      ambiguous:
        stack.some(({ dead }) => dead) ||
        stack.some(({ ambiguous }) => ambiguous) ||
        /(?:\?|&&|\|\||\b(?:if|else|elseif|for|foreach|while|switch|do|and|or)\b)[^;{}]*$/i.test(
          masked
            .slice(Math.max(0, offset - 256), offset)
            .split(/[;{}]/)
            .pop() ?? "",
        ),
      scope: stack
        .filter(({ ambiguous }) => !ambiguous)
        .map(({ id }) => id)
        .join("."),
    });
  }
  return result;
}

function conditionalTerminatorPrefix(masked: string, offset: number): boolean {
  const statementPrefix =
    masked
      .slice(Math.max(0, offset - 256), offset)
      .split(/[;{}]/)
      .pop() ?? "";
  return /(?:\?|&&|\|\||\b(?:if|else|elseif|for|foreach|while|switch|do|and|or)\b)[^;{}]*$/i.test(
    statementPrefix,
  );
}

function effectiveRouteSources(
  rootPath: string,
  entries: readonly NetteWorkspaceRouteSourceEntry[],
  overlays: readonly NetteWorkspaceRouteOverlay[],
): NetteWorkspaceRouteSourceEntry[] {
  const overlayByRelativePath = new Map<string, string>();
  for (const overlay of overlays) {
    const path = resolveOverlayPath(rootPath, overlay.path);
    const relativePath = path ? safeWorkspaceRelativePath(rootPath, path) : null;
    if (relativePath !== null) overlayByRelativePath.set(relativePath, overlay.source);
  }
  const seen = new Set<string>();
  return entries.flatMap((entry) => {
    const relativePath = safeWorkspaceRelativePath(rootPath, entry.path);
    if (relativePath === null || seen.has(relativePath)) return [];
    seen.add(relativePath);
    return [
      {
        path: entry.path,
        source: overlayByRelativePath.get(relativePath) ?? entry.source,
      },
    ];
  });
}

function routeTarget(raw: string): NetteWorkspaceRouteTarget | null {
  const parts = raw.split(":").filter(Boolean);
  if (parts.length < 2) return null;
  const action = parts.pop() ?? null;
  const presenter = parts.join(":");
  return presenter ? { raw, presenter, action: action || null } : null;
}

function closingParenthesis(source: string, open: number): number | null {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    if (source[index] !== ")") continue;
    depth -= 1;
    if (depth === 0) return index;
  }
  return null;
}

function topLevelArgumentRanges(
  source: string,
  start: number,
  end: number,
): { readonly start: number; readonly end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let partStart = start;
  let round = 0;
  let square = 0;
  let curly = 0;
  for (let index = start; index < end; index += 1) {
    const char = source[index];
    if (char === "(") round += 1;
    else if (char === ")") round = Math.max(0, round - 1);
    else if (char === "[") square += 1;
    else if (char === "]") square = Math.max(0, square - 1);
    else if (char === "{") curly += 1;
    else if (char === "}") curly = Math.max(0, curly - 1);
    else if (char === "," && round === 0 && square === 0 && curly === 0) {
      ranges.push({ start: partStart, end: index });
      partStart = index + 1;
    }
  }
  ranges.push({ start: partStart, end });
  return ranges;
}

function callArgumentRanges(
  source: string,
  masked: string,
  start: number,
  end: number,
): { readonly start: number; readonly end: number }[] {
  const ranges = topLevelArgumentRanges(masked, start, end);
  const last = ranges[ranges.length - 1];
  if (
    last &&
    !masked.slice(last.start, last.end).trim() &&
    staticPhpString(source, last.start, last.end) === null
  ) {
    ranges.pop();
  }
  return ranges;
}

function staticPhpString(
  source: string,
  start: number,
  end: number,
): { readonly value: string; readonly offset: number } | null {
  while (start < end && /\s/.test(source[start] ?? "")) start += 1;
  while (end > start && /\s/.test(source[end - 1] ?? "")) end -= 1;
  const quote = source[start];
  if ((quote !== "'" && quote !== '"') || source[end - 1] !== quote) return null;
  const body = source.slice(start + 1, end - 1);
  if (quote === '"' && /(?<!\\)\$|\{\$/.test(body)) return null;
  const value =
    quote === "'"
      ? body.replace(/\\([\\'])/g, "$1")
      : body
          .replace(/\\([\\"$])/g, "$1")
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t");
  return { value, offset: start };
}

function resolveOverlayPath(rootPath: string, path: string): string | null {
  const absoluteRelative = safeWorkspaceRelativePath(rootPath, path);
  if (absoluteRelative !== null) return path;
  const normalized = path.split("\\").join("/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return null;
  if (!safeRelativePath(normalized)) return null;
  return joinWorkspacePath(rootPath, normalized);
}

function safeWorkspaceRelativePath(rootPath: string, path: string): string | null {
  const relative = workspaceRelativePath(rootPath, path);
  return relative !== null && safeRelativePath(relative) ? relative : null;
}

function safeRelativePath(path: string): boolean {
  return path
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function boundedOption(value: number | undefined, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return maximum;
  return Math.max(0, Math.min(maximum, Math.floor(value)));
}
