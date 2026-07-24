import {
  expressRoutesForReceiversInSourceBounded,
  staticJavaScriptStringArgumentAt,
  type ExpressRoute,
} from "./expressRoutes";
import { maskJavaScriptSource } from "./javascriptSourceMask";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];
const MAX_BINDINGS = 20_000;
const MAX_CONSTANTS = 4_096;
const MAX_CONSTANT_DEPTH = 32;
const MAX_STATIC_PREFIX_BYTES = 4_096;
const MAX_MOUNT_DEPTH = 64;
const MAX_EXPORT_DEPTH = 64;
const MAX_IMPORT_PATH_CANDIDATES = 4;

export type ExpressImportPathResolver = (specifier: string) => readonly string[];

export interface ExpressRouteMountSnapshot {
  readonly packageLabel?: string;
  readonly relativeFilePath: string;
  readonly source: string;
}

export interface ResolvedExpressRouteCandidate extends ExpressRoute {
  readonly packageLabel?: string;
  readonly relativeFilePath: string;
}

export interface BoundedResolvedExpressRoutes {
  readonly routes: ResolvedExpressRouteCandidate[];
  readonly truncated: boolean;
}

interface SymbolReference {
  readonly filePath: string;
  readonly name: string;
  readonly packageLabel?: string;
}

interface ReExportBinding {
  readonly exported: string | "*";
  readonly imported: string | "*";
  readonly specifier: string;
}

interface MountDeclaration {
  readonly owner: string;
  readonly prefix: string;
  readonly target: string;
}

interface FileAnalysis {
  readonly appReceivers: ReadonlySet<string>;
  readonly exports: ReadonlyMap<string, string>;
  readonly filePath: string;
  readonly imports: ReadonlyMap<string, { imported: string; specifier: string }>;
  readonly mounts: readonly MountDeclaration[];
  readonly packageLabel?: string;
  readonly reExports: readonly ReExportBinding[];
  readonly routes: readonly ExpressRoute[];
  readonly routerReceivers: ReadonlySet<string>;
  readonly truncated: boolean;
}

interface MountEdge {
  readonly owner: SymbolReference;
  readonly prefix: string;
}

interface RuntimePrefixes {
  readonly prefixes: string[];
  readonly truncated: boolean;
}

interface SymbolResolutionContext {
  exhausted: boolean;
  traversals: number;
}

interface StaticStringParser {
  readonly constants: ReadonlyMap<string, string>;
  readonly source: string;
  offset: number;
}

interface BindingBudget {
  truncated: boolean;
  used: number;
}

interface TopLevelOffsetScan {
  readonly malformed: boolean;
  readonly offsets: Uint8Array;
}

export function normalizeExpressPackageLabel(packageLabel: string | undefined): string | undefined {
  return packageLabel === "" ? undefined : packageLabel;
}

/**
 * Resolves only statically proven Express router mounts. Unknown imports,
 * dynamic prefixes and ambiguous module targets deliberately produce no
 * derived runtime path.
 */
export function resolveExpressRouteMountsBounded(
  snapshots: readonly ExpressRouteMountSnapshot[],
  maxRoutes: number,
  importPathResolver?: ExpressImportPathResolver,
): BoundedResolvedExpressRoutes {
  const limit = boundedLimit(maxRoutes);
  const analyses = snapshots.map((snapshot) => analyzeFile(snapshot, importPathResolver));
  const analysesByPath = uniqueAnalysesByModule(analyses);
  const mountEdges = new Map<string, MountEdge[]>();
  const symbolResolution: SymbolResolutionContext = { exhausted: false, traversals: 0 };
  let bindingCount = 0;
  let truncated = analyses.some((analysis) => analysis.truncated);

  for (const analysis of analyses) {
    for (const mount of analysis.mounts) {
      bindingCount += 1;
      if (bindingCount > MAX_BINDINGS) {
        truncated = true;
        break;
      }
      const target = resolveLocalSymbol(
        analysis,
        mount.target,
        analysesByPath,
        symbolResolution,
        importPathResolver,
      );
      if (!target || !isRouterSymbol(target, analysesByPath)) continue;
      const owner = resolveLocalSymbol(
        analysis,
        mount.owner,
        analysesByPath,
        symbolResolution,
        importPathResolver,
      );
      if (!owner || !isExpressReceiver(owner, analysesByPath)) continue;
      const key = symbolKey(target);
      const edges = mountEdges.get(key) ?? [];
      if (!edges.some((edge) => sameSymbol(edge.owner, owner) && edge.prefix === mount.prefix)) {
        edges.push({ owner, prefix: mount.prefix });
        mountEdges.set(key, edges);
      }
    }
    if (bindingCount > MAX_BINDINGS) break;
  }
  truncated ||= symbolResolution.exhausted;

  const routes: ResolvedExpressRouteCandidate[] = [];
  for (const analysis of analyses) {
    for (const route of analysis.routes) {
      const receiver = {
        filePath: analysis.filePath,
        name: route.receiver,
        ...(analysis.packageLabel ? { packageLabel: analysis.packageLabel } : {}),
      };
      const resolvedPrefixes = analysis.appReceivers.has(route.receiver)
        ? { prefixes: [""], truncated: false }
        : runtimePrefixesBounded(
            receiver,
            mountEdges,
            analysesByPath,
            Math.max(0, limit - routes.length),
          );
      truncated ||= resolvedPrefixes.truncated;
      const prefixes = resolvedPrefixes.prefixes;
      const paths =
        prefixes.length === 0
          ? [route.path]
          : prefixes.map((prefix) => joinPaths(prefix, route.path));
      for (const path of paths) {
        if (routes.length >= limit) return { routes, truncated: true };
        routes.push({
          ...route,
          path,
          relativeFilePath: analysis.filePath,
          ...(analysis.packageLabel ? { packageLabel: analysis.packageLabel } : {}),
        });
      }
    }
  }
  return { routes, truncated };
}

function analyzeFile(
  snapshot: ExpressRouteMountSnapshot,
  importPathResolver: ExpressImportPathResolver | undefined,
): FileAnalysis {
  const { source } = snapshot;
  const packageLabel = normalizeExpressPackageLabel(snapshot.packageLabel);
  if (
    !/\b(?:app|router|express|Router)\b/.test(source) &&
    !/\b(?:import|export|require|module|exports)\b/.test(source)
  ) {
    return {
      appReceivers: new Set(),
      exports: new Map(),
      filePath: snapshot.relativeFilePath,
      imports: new Map(),
      mounts: [],
      reExports: [],
      ...(packageLabel ? { packageLabel } : {}),
      routes: [],
      routerReceivers: new Set(),
      truncated: false,
    };
  }
  const masked = maskJavaScriptSource(source);
  const topLevelScan = collectTopLevelOffsets(masked);
  const topLevelOffsets = topLevelScan.offsets;
  const bindingBudget: BindingBudget = { truncated: false, used: 0 };
  if (topLevelScan.malformed) bindingBudget.truncated = true;
  const expressFactories = new Set<string>();
  const routerFactories = new Set<string>();
  const routerReceivers = new Set<string>();
  const imports = new Map<string, { imported: string; specifier: string }>();

  collectExpressImports(
    source,
    masked,
    topLevelOffsets,
    bindingBudget,
    expressFactories,
    routerFactories,
    routerReceivers,
    imports,
    importPathResolver,
  );
  const appReceivers = new Set<string>();
  collectReceiverDeclarations(
    source,
    masked,
    topLevelOffsets,
    bindingBudget,
    expressFactories,
    routerFactories,
    appReceivers,
    routerReceivers,
  );
  const stringConstants = collectStaticStringConstants(
    source,
    masked,
    topLevelOffsets,
    bindingBudget,
  );
  // Conventional names remain useful for local route discovery, but they are
  // not symbol authority for mount resolution without an Express declaration.
  const receivers = [...new Set(["app", "router", ...appReceivers, ...routerReceivers])];
  const parsed = expressRoutesForReceiversInSourceBounded(
    source,
    receivers,
    Number.POSITIVE_INFINITY,
  );

  return {
    appReceivers,
    exports: collectExports(source, masked, topLevelOffsets, bindingBudget),
    filePath: snapshot.relativeFilePath,
    imports,
    mounts: collectMounts(
      source,
      masked,
      topLevelOffsets,
      receivers,
      stringConstants,
      bindingBudget,
    ),
    ...(packageLabel ? { packageLabel } : {}),
    routes: parsed.routes,
    reExports: collectReExports(source, masked, topLevelOffsets, bindingBudget, importPathResolver),
    routerReceivers,
    truncated: bindingBudget.truncated,
  };
}

function collectExpressImports(
  source: string,
  masked: string,
  topLevelOffsets: Uint8Array,
  budget: BindingBudget,
  expressFactories: Set<string>,
  routerFactories: Set<string>,
  routerReceivers: Set<string>,
  imports: Map<string, { imported: string; specifier: string }>,
  importPathResolver: ExpressImportPathResolver | undefined,
): void {
  const importPattern = /\bimport\s+([^;\n]+?)\s+from\s+(['"])([^'"\r\n]+)\2/g;
  for (const match of source.matchAll(importPattern)) {
    const offset = match.index ?? 0;
    if (
      !isUnconditionalModuleStatementAt(source, masked, topLevelOffsets, offset) ||
      !isCodeKeywordAt(masked, offset, "import") ||
      codeKeywordCount(masked, offset, match[0].length, "from") !== 1
    ) {
      continue;
    }
    const clause = (match[1] ?? "").trim();
    const specifier = match[3] ?? "";
    if (specifier === "express") {
      const defaultImport = clause.match(/^([A-Za-z_$][\w$]*)/);
      if (defaultImport?.[1] && consumeBinding(budget)) expressFactories.add(defaultImport[1]);
      const namespaceImport = clause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (namespaceImport?.[1] && consumeBinding(budget)) {
        expressFactories.add(namespaceImport[1]);
      }
      for (const named of clause.matchAll(/\bRouter\s*(?:as\s+([A-Za-z_$][\w$]*))?/g)) {
        if (consumeBinding(budget)) routerFactories.add(named[1] ?? "Router");
      }
      continue;
    }
    if (!isFollowedImportSpecifier(specifier, importPathResolver)) continue;
    const defaultImport = clause.match(/^([A-Za-z_$][\w$]*)\s*(?:,|$)/);
    if (defaultImport?.[1] && consumeBinding(budget)) {
      imports.set(defaultImport[1], { imported: "default", specifier });
    }
    const braces = clause.match(/\{([^}]*)\}/)?.[1];
    for (const item of braces?.split(",") ?? []) {
      const named = item.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (named?.[1] && consumeBinding(budget)) {
        imports.set(named[2] ?? named[1], { imported: named[1], specifier });
      }
    }
  }

  const requirePattern =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*(['"])([^'"\r\n]+)\2\s*\)/g;
  for (const match of source.matchAll(requirePattern)) {
    const offset = match.index ?? 0;
    if (
      !isUnconditionalModuleStatementAt(source, masked, topLevelOffsets, offset) ||
      !isCodeDeclarationAt(masked, offset)
    ) {
      continue;
    }
    const local = match[1] ?? "";
    const specifier = match[3] ?? "";
    if (specifier === "express" && consumeBinding(budget)) expressFactories.add(local);
    else if (isFollowedImportSpecifier(specifier, importPathResolver) && consumeBinding(budget)) {
      imports.set(local, { imported: "default", specifier });
    }
  }

  const requireMemberPattern =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*(['"])([^'"\r\n]+)\2\s*\)\s*\.\s*([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(requireMemberPattern)) {
    const offset = match.index ?? 0;
    if (
      !isUnconditionalModuleStatementAt(source, masked, topLevelOffsets, offset) ||
      !isCodeDeclarationAt(masked, offset)
    ) {
      continue;
    }
    const local = match[1] ?? "";
    const specifier = match[3] ?? "";
    const imported = match[4] ?? "";
    if (specifier === "express" && imported === "Router") {
      const afterMember = skipTrivia(masked, offset + match[0].length);
      if (consumeBinding(budget)) {
        if (masked[afterMember] === "(") routerReceivers.add(local);
        else routerFactories.add(local);
      }
    } else if (isFollowedImportSpecifier(specifier, importPathResolver) && consumeBinding(budget)) {
      imports.set(local, { imported, specifier });
    }
  }

  const requireDestructuringPattern =
    /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\(\s*(['"])([^'"\r\n]+)\2\s*\)/g;
  for (const match of source.matchAll(requireDestructuringPattern)) {
    const offset = match.index ?? 0;
    if (
      !isUnconditionalModuleStatementAt(source, masked, topLevelOffsets, offset) ||
      !isCodeDeclarationAt(masked, offset)
    ) {
      continue;
    }
    const specifier = match[3] ?? "";
    for (const item of (match[1] ?? "").split(",")) {
      const named = item.trim().match(/^([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?$/);
      if (!named?.[1]) continue;
      const imported = named[1];
      const local = named[2] ?? imported;
      if (specifier === "express" && imported === "Router" && consumeBinding(budget)) {
        routerFactories.add(local);
      } else if (
        isFollowedImportSpecifier(specifier, importPathResolver) &&
        consumeBinding(budget)
      ) {
        imports.set(local, { imported, specifier });
      }
    }
  }
}

function collectReceiverDeclarations(
  source: string,
  masked: string,
  topLevelOffsets: Uint8Array,
  budget: BindingBudget,
  expressFactories: ReadonlySet<string>,
  routerFactories: ReadonlySet<string>,
  appReceivers: Set<string>,
  routerReceivers: Set<string>,
): void {
  const declaration =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)(?:\s*\.\s*(Router))?\s*\(/g;
  for (const match of masked.matchAll(declaration)) {
    if (!isUnconditionalModuleStatementAt(source, masked, topLevelOffsets, match.index ?? 0)) {
      continue;
    }
    const local = match[1] ?? "";
    const factory = match[2] ?? "";
    if (match[3] === "Router" && expressFactories.has(factory)) {
      if (consumeBinding(budget)) routerReceivers.add(local);
    } else if (routerFactories.has(factory)) {
      if (consumeBinding(budget)) routerReceivers.add(local);
    } else if (expressFactories.has(factory) && consumeBinding(budget)) {
      appReceivers.add(local);
    }
  }
}

function collectExports(
  source: string,
  masked: string,
  topLevelOffsets: Uint8Array,
  budget: BindingBudget,
): Map<string, string> {
  const exports = new Map<string, string>();
  for (const match of masked.matchAll(/\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;?/g)) {
    if (!isUnconditionalModuleStatementAt(source, masked, topLevelOffsets, match.index ?? 0)) {
      continue;
    }
    if (consumeBinding(budget)) exports.set("default", match[1] ?? "");
  }
  for (const match of masked.matchAll(/\bmodule\s*\.\s*exports\s*=\s*([A-Za-z_$][\w$]*)\s*;?/g)) {
    if (!isUnconditionalModuleStatementAt(source, masked, topLevelOffsets, match.index ?? 0)) {
      continue;
    }
    if (consumeBinding(budget)) exports.set("default", match[1] ?? "");
  }
  for (const match of masked.matchAll(
    /\b(?:module\s*\.\s*)?exports\s*\.\s*([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;?/g,
  )) {
    if (!isUnconditionalModuleStatementAt(source, masked, topLevelOffsets, match.index ?? 0)) {
      continue;
    }
    if (consumeBinding(budget)) exports.set(match[1] ?? "", match[2] ?? "");
  }
  for (const match of masked.matchAll(/\bmodule\s*\.\s*exports\s*=\s*\{([^}]*)\}/g)) {
    if (!isUnconditionalModuleStatementAt(source, masked, topLevelOffsets, match.index ?? 0)) {
      continue;
    }
    for (const item of (match[1] ?? "").split(",")) {
      const named = item.trim().match(/^([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?$/);
      if (named?.[1] && consumeBinding(budget)) {
        exports.set(named[1], named[2] ?? named[1]);
      }
    }
  }
  for (const match of masked.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    if (!isUnconditionalModuleStatementAt(source, masked, topLevelOffsets, match.index ?? 0)) {
      continue;
    }
    if (/^\s*from\b/.test(masked.slice((match.index ?? 0) + match[0].length))) continue;
    for (const item of (match[1] ?? "").split(",")) {
      const named = item.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (named?.[1] && consumeBinding(budget)) {
        exports.set(named[2] ?? named[1], named[1]);
      }
    }
  }
  return exports;
}

function collectReExports(
  source: string,
  masked: string,
  topLevelOffsets: Uint8Array,
  budget: BindingBudget,
  importPathResolver: ExpressImportPathResolver | undefined,
): ReExportBinding[] {
  const bindings: ReExportBinding[] = [];
  const namedPattern = /\bexport\s*\{([^}]*)\}\s*from\s*(['"])([^'"\r\n]+)\2\s*;?/g;
  for (const match of source.matchAll(namedPattern)) {
    const offset = match.index ?? 0;
    if (
      !isUnconditionalModuleStatementAt(source, masked, topLevelOffsets, offset) ||
      !isCodeKeywordAt(masked, offset, "export")
    ) {
      continue;
    }
    const specifier = match[3] ?? "";
    if (!isFollowedImportSpecifier(specifier, importPathResolver)) continue;
    for (const item of (match[1] ?? "").split(",")) {
      const named = item.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (named?.[1] && consumeBinding(budget)) {
        bindings.push({
          exported: named[2] ?? named[1],
          imported: named[1],
          specifier,
        });
      }
    }
  }
  const starPattern = /\bexport\s*\*\s*from\s*(['"])([^'"\r\n]+)\1\s*;?/g;
  for (const match of source.matchAll(starPattern)) {
    const offset = match.index ?? 0;
    if (
      !isUnconditionalModuleStatementAt(source, masked, topLevelOffsets, offset) ||
      !isCodeKeywordAt(masked, offset, "export")
    ) {
      continue;
    }
    const specifier = match[2] ?? "";
    if (isFollowedImportSpecifier(specifier, importPathResolver) && consumeBinding(budget)) {
      bindings.push({ exported: "*", imported: "*", specifier });
    }
  }
  return bindings;
}

function collectStaticStringConstants(
  source: string,
  masked: string,
  topLevelOffsets: Uint8Array,
  budget: BindingBudget,
): ReadonlyMap<string, string> {
  const expressions = new Map<string, string>();
  const ambiguous = new Set<string>();
  const declaration = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\r\n]+)/g;
  let count = 0;
  for (const match of source.matchAll(declaration)) {
    const offset = match.index ?? 0;
    if (
      !isUnconditionalModuleStatementAt(source, masked, topLevelOffsets, offset) ||
      !isCodeKeywordAt(masked, offset, "const")
    ) {
      continue;
    }
    count += 1;
    if (count > MAX_CONSTANTS) {
      budget.truncated = true;
      return new Map();
    }
    if (!consumeBinding(budget)) continue;
    const name = match[1] ?? "";
    if (expressions.has(name) || ambiguous.has(name)) {
      expressions.delete(name);
      ambiguous.add(name);
      continue;
    }
    expressions.set(name, match[2] ?? "");
  }

  const resolved = new Map<string, string>();
  const resolve = (name: string, seen: ReadonlySet<string>, depth: number): string | null => {
    const cached = resolved.get(name);
    if (cached !== undefined) return cached;
    if (depth > MAX_CONSTANT_DEPTH || seen.has(name) || ambiguous.has(name)) return null;
    const expression = expressions.get(name);
    if (expression === undefined) return null;
    const value = parseStaticStringExpression(expression, resolved, (nestedName) =>
      resolve(nestedName, new Set(seen).add(name), depth + 1),
    );
    if (value === null || staticStringByteLength(value) > MAX_STATIC_PREFIX_BYTES) return null;
    resolved.set(name, value);
    return value;
  };

  for (const name of expressions.keys()) resolve(name, new Set(), 0);
  return resolved;
}

function staticMountPrefixArgumentAt(
  source: string,
  from: number,
  constants: ReadonlyMap<string, string>,
): { readonly endOffset: number; readonly value: string } | null {
  const parser: StaticStringParser = { constants, offset: skipTrivia(source, from), source };
  const value = parseStaticStringSum(parser, () => null);
  if (value === null || staticStringByteLength(value) > MAX_STATIC_PREFIX_BYTES) return null;
  parser.offset = skipTrivia(source, parser.offset);
  return source[parser.offset] === "," ? { endOffset: parser.offset, value } : null;
}

function parseStaticStringExpression(
  source: string,
  constants: ReadonlyMap<string, string>,
  resolveUnknown: (name: string) => string | null,
): string | null {
  const parser: StaticStringParser = { constants, offset: skipTrivia(source, 0), source };
  const value = parseStaticStringSum(parser, resolveUnknown);
  parser.offset = skipTrivia(source, parser.offset);
  return value !== null && parser.offset === source.length ? value : null;
}

function parseStaticStringSum(
  parser: StaticStringParser,
  resolveUnknown: (name: string) => string | null,
): string | null {
  let value = parseStaticStringTerm(parser, resolveUnknown);
  if (value === null) return null;
  while (true) {
    parser.offset = skipTrivia(parser.source, parser.offset);
    if (parser.source[parser.offset] !== "+") return value;
    parser.offset = skipTrivia(parser.source, parser.offset + 1);
    const next = parseStaticStringTerm(parser, resolveUnknown);
    if (next === null) return null;
    value += next;
    if (staticStringByteLength(value) > MAX_STATIC_PREFIX_BYTES) return null;
  }
}

function parseStaticStringTerm(
  parser: StaticStringParser,
  resolveUnknown: (name: string) => string | null,
): string | null {
  parser.offset = skipTrivia(parser.source, parser.offset);
  const character = parser.source[parser.offset];
  if (character === "'" || character === '"') {
    const literal = staticJavaScriptStringArgumentAt(`${parser.source},`, parser.offset);
    if (!literal) return null;
    parser.offset = literal.endOffset;
    return literal.value;
  }
  if (character === "`") return parseStaticTemplate(parser, resolveUnknown);
  if (character === "(") {
    parser.offset += 1;
    const value = parseStaticStringSum(parser, resolveUnknown);
    parser.offset = skipTrivia(parser.source, parser.offset);
    if (value === null || parser.source[parser.offset] !== ")") return null;
    parser.offset += 1;
    return value;
  }
  const identifier = parser.source.slice(parser.offset).match(/^([A-Za-z_$][\w$]*)/)?.[1];
  if (!identifier) return null;
  parser.offset += identifier.length;
  return parser.constants.get(identifier) ?? resolveUnknown(identifier);
}

function parseStaticTemplate(
  parser: StaticStringParser,
  resolveUnknown: (name: string) => string | null,
): string | null {
  let value = "";
  parser.offset += 1;
  while (parser.offset < parser.source.length) {
    const character = parser.source[parser.offset] ?? "";
    if (character === "`") {
      parser.offset += 1;
      return value;
    }
    if (character === "\\") {
      if (
        parser.source[parser.offset + 1] === "0" &&
        /[0-9]/.test(parser.source[parser.offset + 2] ?? "")
      ) {
        return null;
      }
      const escaped = decodeSimpleStringEscape(parser.source[parser.offset + 1]);
      if (escaped === null) return null;
      value += escaped;
      parser.offset += 2;
      continue;
    }
    if (character === "$" && parser.source[parser.offset + 1] === "{") {
      const interpolation = parser.source
        .slice(parser.offset + 2)
        .match(/^\s*([A-Za-z_$][\w$]*)\s*\}/);
      if (!interpolation?.[1]) return null;
      const nested = parser.constants.get(interpolation[1]) ?? resolveUnknown(interpolation[1]);
      if (nested === null) return null;
      value += nested;
      parser.offset += 2 + interpolation[0].length;
      continue;
    }
    value += character;
    parser.offset += 1;
    if (staticStringByteLength(value) > MAX_STATIC_PREFIX_BYTES) return null;
  }
  return null;
}

function decodeSimpleStringEscape(character: string | undefined): string | null {
  if (character === undefined || character === "\n" || character === "\r") return null;
  return (
    {
      "0": "\0",
      "\\": "\\",
      "`": "`",
      $: "$",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
    }[character] ?? null
  );
}

function staticStringByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function collectMounts(
  source: string,
  masked: string,
  topLevelOffsets: Uint8Array,
  receivers: readonly string[],
  stringConstants: ReadonlyMap<string, string>,
  budget: BindingBudget,
): MountDeclaration[] {
  const mounts: MountDeclaration[] = [];
  const receiverPattern = receivers.map(escapeRegExp).join("|");
  if (!receiverPattern) return mounts;
  const pattern = new RegExp(`(^|[^\\w$])(${receiverPattern})\\s*\\.\\s*use\\s*\\(`, "gm");
  for (const match of masked.matchAll(pattern)) {
    const matchOffset = match.index ?? 0;
    const receiverOffset = matchOffset + (match[1]?.length ?? 0);
    if (!isUnconditionalModuleStatementAt(source, masked, topLevelOffsets, receiverOffset)) {
      continue;
    }
    if (!isStandaloneReceiver(masked, receiverOffset)) continue;
    const openOffset = matchOffset + match[0].lastIndexOf("(");
    const literal =
      staticJavaScriptStringArgumentAt(source, openOffset + 1) ??
      staticMountPrefixArgumentAt(source, openOffset + 1, stringConstants);
    if (!literal || source[literal.endOffset] !== ",") continue;
    const targetStart = skipTrivia(source, literal.endOffset + 1);
    const target = source.slice(targetStart).match(/^([A-Za-z_$][\w$]*)/)?.[1];
    if (!target) continue;
    const targetEnd = skipTrivia(source, targetStart + target.length);
    if (source[targetEnd] !== ")" && source[targetEnd] !== ",") continue;
    if (consumeBinding(budget)) {
      mounts.push({ owner: match[2] ?? "", prefix: literal.value, target });
    }
  }
  return mounts;
}

function resolveLocalSymbol(
  analysis: FileAnalysis,
  localName: string,
  files: ReadonlyMap<string, FileAnalysis>,
  context: SymbolResolutionContext,
  importPathResolver: ExpressImportPathResolver | undefined,
  seen: ReadonlySet<string> = new Set(),
  depth = 0,
): SymbolReference | null {
  if (!consumeSymbolTraversal(context, depth)) return null;
  const localKey = symbolKey({
    filePath: analysis.filePath,
    name: localName,
    ...(analysis.packageLabel ? { packageLabel: analysis.packageLabel } : {}),
  });
  if (seen.has(localKey)) return null;
  if (analysis.appReceivers.has(localName) || analysis.routerReceivers.has(localName)) {
    return {
      filePath: analysis.filePath,
      name: localName,
      ...(analysis.packageLabel ? { packageLabel: analysis.packageLabel } : {}),
    };
  }
  const binding = analysis.imports.get(localName);
  if (!binding) return null;
  const target = resolveModuleAnalysis(analysis, binding.specifier, files, importPathResolver);
  return target
    ? resolveExportedSymbol(
        target,
        binding.imported,
        files,
        context,
        importPathResolver,
        new Set(seen).add(localKey),
        depth + 1,
      )
    : null;
}

function resolveExportedSymbol(
  analysis: FileAnalysis,
  exportedName: string,
  files: ReadonlyMap<string, FileAnalysis>,
  context: SymbolResolutionContext,
  importPathResolver: ExpressImportPathResolver | undefined,
  seen: ReadonlySet<string>,
  depth: number,
): SymbolReference | null {
  if (!consumeSymbolTraversal(context, depth)) return null;
  const exportKey = `${moduleKey(analysis.packageLabel, analysis.filePath)}\u0000export\u0000${exportedName}`;
  if (seen.has(exportKey)) return null;
  const nextSeen = new Set(seen).add(exportKey);
  const candidates: SymbolReference[] = [];
  const local = analysis.exports.get(exportedName);
  if (local) {
    const resolved = resolveLocalSymbol(
      analysis,
      local,
      files,
      context,
      importPathResolver,
      nextSeen,
      depth + 1,
    );
    return resolved;
  }
  const directBindings = analysis.reExports.filter((binding) => binding.exported === exportedName);
  if (directBindings.length > 0) {
    if (directBindings.length !== 1) return null;
    const binding = directBindings[0];
    if (!binding) return null;
    const target = resolveModuleAnalysis(analysis, binding.specifier, files, importPathResolver);
    return target
      ? resolveExportedSymbol(
          target,
          binding.imported,
          files,
          context,
          importPathResolver,
          nextSeen,
          depth + 1,
        )
      : null;
  }
  for (const binding of analysis.reExports) {
    if (binding.exported !== "*" || exportedName === "default") continue;
    const target = resolveModuleAnalysis(analysis, binding.specifier, files, importPathResolver);
    if (!target) continue;
    const resolved = resolveExportedSymbol(
      target,
      exportedName,
      files,
      context,
      importPathResolver,
      nextSeen,
      depth + 1,
    );
    if (resolved && !candidates.some((candidate) => sameSymbol(candidate, resolved))) {
      candidates.push(resolved);
    }
  }
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

function resolveModuleAnalysis(
  from: FileAnalysis,
  specifier: string,
  files: ReadonlyMap<string, FileAnalysis>,
  importPathResolver: ExpressImportPathResolver | undefined,
): FileAnalysis | null {
  const bases = resolveModuleBases(from, specifier, importPathResolver);
  const candidates = new Set<string>();
  for (const base of bases) {
    const explicitExtension = SOURCE_EXTENSIONS.find((extension) => base.endsWith(extension));
    const extensionlessBase = explicitExtension ? base.slice(0, -explicitExtension.length) : base;
    candidates.add(base);
    for (const extension of SOURCE_EXTENSIONS) {
      candidates.add(
        explicitExtension ? `${extensionlessBase}${extension}` : `${base}${extension}`,
      );
      candidates.add(`${base}/index${extension}`);
    }
  }
  const matches = [...candidates]
    .map((candidate) => files.get(moduleKey(from.packageLabel, candidate)))
    .filter((candidate): candidate is FileAnalysis => candidate !== undefined);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function resolveModuleBases(
  from: FileAnalysis,
  specifier: string,
  importPathResolver: ExpressImportPathResolver | undefined,
): readonly string[] {
  if (specifier.startsWith(".")) {
    const relative = normalizeRelativeModulePath(`${directoryName(from.filePath)}/${specifier}`);
    return relative ? [relative] : [];
  }
  const candidates = importPathResolver?.(specifier) ?? [];
  const bases: string[] = [];
  for (const candidate of candidates.slice(0, MAX_IMPORT_PATH_CANDIDATES)) {
    if (candidate.startsWith("/") || /^[A-Za-z]:[\\/]/.test(candidate)) continue;
    const normalized = normalizeRelativeModulePath(candidate);
    if (!normalized || bases.includes(normalized)) continue;
    bases.push(normalized);
  }
  return bases;
}

function isFollowedImportSpecifier(
  specifier: string,
  importPathResolver: ExpressImportPathResolver | undefined,
): boolean {
  return specifier.startsWith(".") || importPathResolver !== undefined;
}

function directoryName(filePath: string): string {
  const separator = filePath.lastIndexOf("/");
  return separator < 0 ? "." : filePath.slice(0, separator);
}

function normalizeRelativeModulePath(path: string): string | null {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.length > 0 ? segments.join("/") : null;
}

function runtimePrefixesBounded(
  symbol: SymbolReference,
  edges: ReadonlyMap<string, readonly MountEdge[]>,
  files: ReadonlyMap<string, FileAnalysis>,
  maxPrefixes: number,
): RuntimePrefixes {
  const limit = boundedLimit(maxPrefixes);
  const results = new Set<string>();
  let traversals = 0;
  let truncated = false;
  const visit = (
    current: SymbolReference,
    suffix: string,
    seen: ReadonlySet<string>,
    depth: number,
  ) => {
    if (truncated) return;
    if (depth > MAX_MOUNT_DEPTH) {
      truncated = true;
      return;
    }
    const key = symbolKey(current);
    if (seen.has(key)) return;
    const nextSeen = new Set(seen).add(key);
    for (const edge of edges.get(key) ?? []) {
      traversals += 1;
      if (traversals > MAX_BINDINGS) {
        truncated = true;
        return;
      }
      const ownerFile = files.get(moduleKey(edge.owner.packageLabel, edge.owner.filePath));
      const combined = joinPaths(edge.prefix, suffix);
      if (ownerFile?.appReceivers.has(edge.owner.name)) {
        if (!results.has(combined) && results.size >= limit) {
          truncated = true;
          return;
        }
        results.add(combined);
      } else visit(edge.owner, combined, nextSeen, depth + 1);
      if (truncated) return;
    }
  };
  visit(symbol, "", new Set(), 0);
  return { prefixes: [...results].sort(), truncated };
}

function isRouterSymbol(
  symbol: SymbolReference,
  files: ReadonlyMap<string, FileAnalysis>,
): boolean {
  return (
    files.get(moduleKey(symbol.packageLabel, symbol.filePath))?.routerReceivers.has(symbol.name) ??
    false
  );
}

function isExpressReceiver(
  symbol: SymbolReference,
  files: ReadonlyMap<string, FileAnalysis>,
): boolean {
  const file = files.get(moduleKey(symbol.packageLabel, symbol.filePath));
  return Boolean(file?.appReceivers.has(symbol.name) || file?.routerReceivers.has(symbol.name));
}

function joinPaths(prefix: string, routePath: string): string {
  if (!prefix) return routePath;
  if (!routePath || routePath === "/") return prefix || "/";
  return `${prefix.replace(/\/+$/, "")}/${routePath.replace(/^\/+/, "")}`;
}

function symbolKey(symbol: SymbolReference): string {
  return `${moduleKey(symbol.packageLabel, symbol.filePath)}\u0000${symbol.name}`;
}

function sameSymbol(left: SymbolReference, right: SymbolReference): boolean {
  return (
    left.packageLabel === right.packageLabel &&
    left.filePath === right.filePath &&
    left.name === right.name
  );
}

function moduleKey(packageLabel: string | undefined, filePath: string): string {
  return `${normalizeExpressPackageLabel(packageLabel) ?? ""}\u0000${filePath}`;
}

function uniqueAnalysesByModule(analyses: readonly FileAnalysis[]): Map<string, FileAnalysis> {
  const files = new Map<string, FileAnalysis>();
  const ambiguous = new Set<string>();
  for (const analysis of analyses) {
    const key = moduleKey(analysis.packageLabel, analysis.filePath);
    if (files.has(key) || ambiguous.has(key)) {
      files.delete(key);
      ambiguous.add(key);
    } else {
      files.set(key, analysis);
    }
  }
  return files;
}

function consumeSymbolTraversal(context: SymbolResolutionContext, depth: number): boolean {
  if (context.exhausted) return false;
  context.traversals += 1;
  if (depth > MAX_EXPORT_DEPTH || context.traversals > MAX_BINDINGS) {
    context.exhausted = true;
    return false;
  }
  return true;
}

function isCodeKeywordAt(masked: string, offset: number, keyword: string): boolean {
  return masked.slice(offset, offset + keyword.length) === keyword;
}

function codeKeywordCount(masked: string, offset: number, length: number, keyword: string): number {
  return [...masked.slice(offset, offset + length).matchAll(new RegExp(`\\b${keyword}\\b`, "g"))]
    .length;
}

function isCodeDeclarationAt(masked: string, offset: number): boolean {
  return /^(?:const|let|var)\b/.test(masked.slice(offset));
}

function collectTopLevelOffsets(masked: string): TopLevelOffsetScan {
  const offsets = new Uint8Array(masked.length);
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  const delimiters: string[] = [];
  const forHeaderDepths: number[] = [];
  let pendingForHeaderOffset = -1;
  let invalid = false;
  for (let offset = 0; offset < masked.length; offset += 1) {
    const character = masked[offset];
    const inForHeader = forHeaderDepths.length > 0;
    if (braceDepth === 0 && bracketDepth === 0 && parenthesisDepth === 0 && !inForHeader) {
      offsets[offset] = 1;
    }

    if (braceDepth === 0 && !inForHeader && isStandaloneKeywordAt(masked, offset, "for")) {
      pendingForHeaderOffset = forHeaderOpeningParenthesis(masked, offset + "for".length);
    }

    if (character === "(") {
      delimiters.push(character);
      parenthesisDepth += 1;
      if (offset === pendingForHeaderOffset) {
        forHeaderDepths.push(parenthesisDepth);
        pendingForHeaderOffset = -1;
      }
    } else if (character === ")") {
      if (delimiters.pop() !== "(" || parenthesisDepth === 0) invalid = true;
      else {
        if (forHeaderDepths[forHeaderDepths.length - 1] === parenthesisDepth) {
          forHeaderDepths.pop();
        }
        parenthesisDepth -= 1;
      }
    } else if (character === "{") {
      delimiters.push(character);
      braceDepth += 1;
    } else if (character === "[") {
      delimiters.push(character);
      bracketDepth += 1;
    } else if (character === "]") {
      if (delimiters.pop() !== "[" || bracketDepth === 0) invalid = true;
      else bracketDepth -= 1;
    } else if (character === "}") {
      if (delimiters.pop() !== "{" || braceDepth === 0) invalid = true;
      else braceDepth -= 1;
    }
  }
  if (
    invalid ||
    delimiters.length > 0 ||
    braceDepth !== 0 ||
    bracketDepth !== 0 ||
    parenthesisDepth !== 0 ||
    forHeaderDepths.length > 0
  ) {
    return { malformed: true, offsets: new Uint8Array(masked.length) };
  }
  maskControlledSingleStatementBodies(masked, offsets);
  return { malformed: false, offsets };
}

function isUnconditionalModuleStatementAt(
  source: string,
  masked: string,
  topLevelOffsets: Uint8Array,
  offset: number,
): boolean {
  if (topLevelOffsets[offset] !== 1) return false;
  if (!isDirectModuleStatementStart(source, masked, offset)) return false;
  let cursor = previousNonWhitespace(masked, offset - 1);
  if (cursor < 0) return true;

  if (masked[cursor] === ":") return false;
  const previousWord = identifierEndingAt(masked, cursor);
  if (previousWord && (previousWord.value === "else" || previousWord.value === "do")) {
    return false;
  }
  if (masked[cursor] !== ")") return true;

  const opening = matchingOpeningParenthesis(masked, cursor);
  if (opening === null) return false;
  cursor = previousNonWhitespace(masked, opening - 1);
  let control = identifierEndingAt(masked, cursor);
  if (control?.value === "await") {
    cursor = previousNonWhitespace(masked, control.start - 1);
    control = identifierEndingAt(masked, cursor);
  }
  return !control || !["for", "if", "while", "with"].includes(control.value);
}

function isDirectModuleStatementStart(source: string, masked: string, offset: number): boolean {
  let boundary = offset - 1;
  while (boundary >= 0 && !["\n", ";", "}"].includes(masked[boundary] ?? "")) boundary -= 1;
  if (masked.slice(boundary + 1, offset).trim() !== "") return false;
  if (boundary < 0 || masked[boundary] !== "\n") return true;

  const lineStart = boundary + 1;
  const previousOffset = previousNonWhitespace(masked, boundary - 1);
  if (previousOffset < 0) return true;
  const previous = masked[previousOffset] ?? "";
  if ("([{,:.?=<>!&|+-*%^~\\/".includes(previous)) {
    // A masked string/template literal leaves its assignment operator as the last visible
    // character. The raw line must actually end in its closing delimiter; whitespace alone after
    // an assignment remains an ambiguous continuation and therefore fails closed.
    const rawPreviousLine = source.slice(source.lastIndexOf("\n", lineStart - 2) + 1, lineStart);
    if (previous === "=" && /['"`]\s*$/.test(rawPreviousLine)) return true;
    return false;
  }
  const previousWord = identifierEndingAt(masked, previousOffset)?.value;
  return (
    !previousWord ||
    !["await", "delete", "new", "return", "throw", "typeof", "void", "yield"].includes(previousWord)
  );
}

function maskControlledSingleStatementBodies(masked: string, offsets: Uint8Array): void {
  for (const match of masked.matchAll(/\b(?:if|for|while|with)\b/g)) {
    const keywordOffset = match.index ?? 0;
    const previousOffset = previousNonWhitespace(masked, keywordOffset - 1);
    if (
      offsets[keywordOffset] !== 1 ||
      !isStandaloneKeywordAt(masked, keywordOffset, match[0]) ||
      (previousOffset >= 0 && masked[previousOffset] === ".")
    ) {
      continue;
    }
    const opening =
      match[0] === "for"
        ? forHeaderOpeningParenthesis(masked, keywordOffset + match[0].length)
        : skipTrivia(masked, keywordOffset + match[0].length);
    if (opening < 0 || masked[opening] !== "(") {
      offsets.fill(0);
      return;
    }
    const closing = matchingClosingParenthesis(masked, opening);
    if (closing === null) {
      offsets.fill(0);
      return;
    }
    maskSingleStatementBody(masked, offsets, closing + 1);
  }

  for (const match of masked.matchAll(/\b(?:else|do)\b/g)) {
    const keywordOffset = match.index ?? 0;
    if (offsets[keywordOffset] !== 1 || !isStandaloneKeywordAt(masked, keywordOffset, match[0])) {
      continue;
    }
    maskSingleStatementBody(masked, offsets, keywordOffset + match[0].length);
  }

  for (const match of masked.matchAll(/\b[A-Za-z_$][\w$]*\s*:/g)) {
    const labelOffset = match.index ?? 0;
    if (offsets[labelOffset] !== 1) continue;
    maskSingleStatementBody(masked, offsets, labelOffset + match[0].length);
  }
}

function maskSingleStatementBody(masked: string, offsets: Uint8Array, from: number): void {
  const start = skipTrivia(masked, from);
  if (masked[start] === "{") return;
  for (let offset = start; offset < masked.length; offset += 1) {
    if (masked[offset] === ";" && offsets[offset] === 1) {
      offsets.fill(0, start, offset + 1);
      return;
    }
  }
  offsets.fill(0, start);
}

function matchingClosingParenthesis(source: string, openOffset: number): number | null {
  let depth = 1;
  for (let offset = openOffset + 1; offset < source.length; offset += 1) {
    if (source[offset] === "(") depth += 1;
    else if (source[offset] === ")") {
      depth -= 1;
      if (depth === 0) return offset;
    }
  }
  return null;
}

function previousNonWhitespace(source: string, from: number): number {
  let offset = from;
  while (offset >= 0 && /\s/.test(source[offset] ?? "")) offset -= 1;
  return offset;
}

function identifierEndingAt(
  source: string,
  end: number,
): { readonly start: number; readonly value: string } | null {
  if (end < 0 || !/[A-Za-z0-9_$]/.test(source[end] ?? "")) return null;
  let start = end;
  while (start > 0 && /[A-Za-z0-9_$]/.test(source[start - 1] ?? "")) start -= 1;
  const value = source.slice(start, end + 1);
  return /^[A-Za-z_$][\w$]*$/.test(value) ? { start, value } : null;
}

function matchingOpeningParenthesis(source: string, closeOffset: number): number | null {
  let depth = 1;
  for (let offset = closeOffset - 1; offset >= 0; offset -= 1) {
    if (source[offset] === ")") depth += 1;
    else if (source[offset] === "(") {
      depth -= 1;
      if (depth === 0) return offset;
    }
  }
  return null;
}

function consumeBinding(budget: BindingBudget): boolean {
  if (budget.used >= MAX_BINDINGS) {
    budget.truncated = true;
    return false;
  }
  budget.used += 1;
  return true;
}

function isStandaloneKeywordAt(source: string, offset: number, keyword: string): boolean {
  if (source.slice(offset, offset + keyword.length) !== keyword) return false;
  const previous = source[offset - 1] ?? "";
  const next = source[offset + keyword.length] ?? "";
  return !/[A-Za-z0-9_$]/.test(previous) && !/[A-Za-z0-9_$]/.test(next);
}

function forHeaderOpeningParenthesis(source: string, from: number): number {
  let offset = skipTrivia(source, from);
  if (isStandaloneKeywordAt(source, offset, "await")) {
    offset = skipTrivia(source, offset + "await".length);
  }
  return source[offset] === "(" ? offset : -1;
}

function isStandaloneReceiver(source: string, receiverOffset: number): boolean {
  let index = receiverOffset - 1;
  while (index >= 0 && /\s/.test(source[index] ?? "")) index -= 1;
  return source[index] !== ".";
}

function skipTrivia(source: string, from: number): number {
  let index = from;
  while (index < source.length) {
    if (/\s/.test(source[index] ?? "")) index += 1;
    else if (source.slice(index, index + 2) === "//") {
      const newline = source.indexOf("\n", index + 2);
      index = newline < 0 ? source.length : newline + 1;
    } else if (source.slice(index, index + 2) === "/*") {
      const close = source.indexOf("*/", index + 2);
      index = close < 0 ? source.length : close + 2;
    } else break;
  }
  return index;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function boundedLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : Infinity;
}
