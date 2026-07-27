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
const MAX_STATIC_IMPORT_CLAUSE_CHARACTERS = 4_096;
const MAX_STATIC_IMPORT_SPECIFIER_CHARACTERS = 4_096;
const MAX_STATIC_EXPRESSION_DEPTH = 64;
const MAX_STATIC_EXPRESSION_WORK = 16_384;

export interface ExpressImportPathImporter {
  readonly packageLabel?: string;
  readonly relativeFilePath: string;
}

export type ExpressImportPathResolver = (
  specifier: string,
  importer: ExpressImportPathImporter,
) => readonly string[];

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
  /** True only when a deterministic resource/result bound omitted analysis or route output. */
  readonly capacityTruncated: boolean;
  readonly routes: ResolvedExpressRouteCandidate[];
  /** Includes both capacity truncation and malformed source that cannot be analyzed completely. */
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

interface StaticMountArguments {
  readonly prefix: string;
  readonly targets: readonly string[];
  readonly truncated: boolean;
}

interface FileAnalysis {
  readonly appReceivers: ReadonlySet<string>;
  readonly capacityTruncated: boolean;
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
  depth: number;
  exhausted: boolean;
  offset: number;
  work: number;
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
  const analyses = snapshots.map((snapshot) => analyzeFile(snapshot, importPathResolver, limit));
  const analysesByPath = uniqueAnalysesByModule(analyses);
  const mountEdges = new Map<string, MountEdge[]>();
  const symbolResolution: SymbolResolutionContext = { exhausted: false, traversals: 0 };
  let bindingCount = 0;
  let truncated = analyses.some((analysis) => analysis.truncated);
  let capacityTruncated = analyses.some((analysis) => analysis.capacityTruncated);

  for (const analysis of analyses) {
    for (const mount of analysis.mounts) {
      bindingCount += 1;
      if (bindingCount > MAX_BINDINGS) {
        truncated = true;
        capacityTruncated = true;
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
  capacityTruncated ||= symbolResolution.exhausted;

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
      capacityTruncated ||= resolvedPrefixes.truncated;
      const prefixes = resolvedPrefixes.prefixes;
      const paths =
        prefixes.length === 0
          ? [route.path]
          : prefixes.map((prefix) => joinPaths(prefix, route.path));
      for (const path of paths) {
        if (routes.length >= limit) {
          return { capacityTruncated: true, routes, truncated: true };
        }
        routes.push({
          ...route,
          path,
          relativeFilePath: analysis.filePath,
          ...(analysis.packageLabel ? { packageLabel: analysis.packageLabel } : {}),
        });
      }
    }
  }
  return { capacityTruncated, routes, truncated };
}

function analyzeFile(
  snapshot: ExpressRouteMountSnapshot,
  importPathResolver: ExpressImportPathResolver | undefined,
  maxRoutes: number,
): FileAnalysis {
  const { source } = snapshot;
  const packageLabel = normalizeExpressPackageLabel(snapshot.packageLabel);
  if (
    !/\b(?:app|router|express|Router)\b/.test(source) &&
    !/\b(?:import|export|require|module|exports)\b/.test(source)
  ) {
    return {
      appReceivers: new Set(),
      capacityTruncated: false,
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
  const topLevelScan = collectTopLevelOffsets(source, masked);
  const topLevelOffsets = topLevelScan.offsets;
  const bindingBudget: BindingBudget = { truncated: false, used: 0 };
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
  const parsed = expressRoutesForReceiversInSourceBounded(source, receivers, maxRoutes);
  const exports = collectExports(source, masked, topLevelOffsets, bindingBudget);
  const mounts = collectMounts(
    source,
    masked,
    topLevelOffsets,
    receivers,
    stringConstants,
    bindingBudget,
  );
  const reExports = collectReExports(
    source,
    masked,
    topLevelOffsets,
    bindingBudget,
    importPathResolver,
  );

  return {
    appReceivers,
    capacityTruncated: bindingBudget.truncated || parsed.truncated,
    exports,
    filePath: snapshot.relativeFilePath,
    imports,
    mounts,
    ...(packageLabel ? { packageLabel } : {}),
    routes: parsed.routes,
    reExports,
    routerReceivers,
    truncated: topLevelScan.malformed || bindingBudget.truncated || parsed.truncated,
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
  const importPattern = /\bimport\b/g;
  let importMatch: RegExpExecArray | null;
  while ((importMatch = importPattern.exec(masked)) !== null) {
    const offset = importMatch.index;
    if (!isCodeKeywordAt(masked, offset, "import")) continue;
    if (masked[previousNonWhitespace(masked, offset - 1)] === ".") continue;
    if (!isUnconditionalModuleStatementAt(source, masked, topLevelOffsets, offset)) continue;
    const clauseOffset = offset + "import".length;
    const firstClauseOffset = skipWhitespaceBounded(masked, clauseOffset, masked.length);
    if (
      masked[firstClauseOffset] === "(" ||
      masked[firstClauseOffset] === "." ||
      source[firstClauseOffset] === "'" ||
      source[firstClauseOffset] === '"'
    ) {
      importPattern.lastIndex = firstClauseOffset + 1;
      continue;
    }
    const scanEnd = Math.min(masked.length, clauseOffset + MAX_STATIC_IMPORT_CLAUSE_CHARACTERS);
    const boundedClause = masked.slice(clauseOffset, scanEnd);
    const fromMatch = /\bfrom\b/.exec(boundedClause);
    if (!fromMatch) {
      if (scanEnd < masked.length) budget.truncated = true;
      importPattern.lastIndex = scanEnd;
      continue;
    }
    const fromOffset = clauseOffset + fromMatch.index;
    const clause = masked.slice(clauseOffset, fromOffset).trim();
    if (
      !isSupportedStaticImportClause(clause) ||
      /[;]/.test(clause) ||
      /\b(?:import|export|from)\b/.test(clause) ||
      /^type\b/.test(clause)
    ) {
      importPattern.lastIndex = fromOffset + "from".length;
      continue;
    }
    const postFromEnd = Math.min(
      source.length,
      fromOffset + "from".length + MAX_STATIC_IMPORT_SPECIFIER_CHARACTERS,
    );
    const specifierOffset = skipTriviaBounded(source, fromOffset + "from".length, postFromEnd);
    if (specifierOffset === null) {
      budget.truncated = true;
      importPattern.lastIndex = postFromEnd;
      continue;
    }
    const quote = source[specifierOffset];
    if (quote !== "'" && quote !== '"') {
      importPattern.lastIndex = specifierOffset + 1;
      continue;
    }
    const specifierEnd = boundedModuleSpecifierEnd(
      source,
      specifierOffset,
      Math.min(source.length, specifierOffset + MAX_STATIC_IMPORT_SPECIFIER_CHARACTERS),
    );
    if (specifierEnd === null) {
      if (
        specifierOffset + MAX_STATIC_IMPORT_SPECIFIER_CHARACTERS < source.length &&
        !/[\r\n]/.test(
          source.slice(
            specifierOffset + 1,
            specifierOffset + MAX_STATIC_IMPORT_SPECIFIER_CHARACTERS,
          ),
        )
      ) {
        budget.truncated = true;
      }
      importPattern.lastIndex = specifierOffset + 1;
      continue;
    }
    importPattern.lastIndex = specifierEnd + 1;
    const specifier = source.slice(specifierOffset + 1, specifierEnd);
    if (specifier.includes("\\")) continue;
    if (specifier === "express") {
      const defaultImport = clause.match(/^([A-Za-z_$][\w$]*)/);
      if (defaultImport?.[1] && consumeBinding(budget)) expressFactories.add(defaultImport[1]);
      const namespaceImport = clause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (namespaceImport?.[1] && consumeBinding(budget)) {
        expressFactories.add(namespaceImport[1]);
      }
      const braces = clause.match(/\{([^}]*)\}/)?.[1];
      for (const item of braces?.split(",") ?? []) {
        if (/^\s*type\b/.test(item)) continue;
        const named = item.trim().match(/^Router(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
        if (named && consumeBinding(budget)) routerFactories.add(named[1] ?? "Router");
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
      if (/^\s*type\b/.test(item)) continue;
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

function isSupportedStaticImportClause(clause: string): boolean {
  const identifier = "[A-Za-z_$][\\w$]*";
  const namedItem = `(?:type\\s+)?${identifier}(?:\\s+as\\s+${identifier})?`;
  const namedBindings = `\\{\\s*(?:${namedItem}(?:\\s*,\\s*${namedItem})*\\s*,?)?\\s*\\}`;
  const namespaceBinding = `\\*\\s+as\\s+${identifier}`;
  return new RegExp(
    `^(?:${identifier}|(?:${identifier}\\s*,\\s*)?(?:${namedBindings}|${namespaceBinding}))$`,
  ).test(clause);
}

function skipWhitespaceBounded(source: string, from: number, end: number): number {
  let offset = from;
  while (offset < end && /\s/.test(source[offset] ?? "")) offset += 1;
  return offset;
}

function skipTriviaBounded(source: string, from: number, end: number): number | null {
  let offset = from;
  while (offset < end) {
    if (/\s/.test(source[offset] ?? "")) {
      offset += 1;
    } else if (source.slice(offset, offset + 2) === "//") {
      offset += 2;
      while (offset < end && source[offset] !== "\n") offset += 1;
      if (offset >= end) return null;
      offset += 1;
    } else if (source.slice(offset, offset + 2) === "/*") {
      offset += 2;
      while (offset + 1 < end && source.slice(offset, offset + 2) !== "*/") offset += 1;
      if (offset + 1 >= end) return null;
      offset += 2;
    } else {
      return offset;
    }
  }
  return null;
}

function boundedModuleSpecifierEnd(
  source: string,
  quoteOffset: number,
  end: number,
): number | null {
  const quote = source[quoteOffset];
  for (let offset = quoteOffset + 1; offset < end; offset += 1) {
    const character = source[offset];
    if (character === "\r" || character === "\n" || character === "\\") return null;
    if (character === quote) return offset;
  }
  return null;
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
    /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;\r\n]{1,1024})?\s*=\s*([A-Za-z_$][\w$]*)(?:\s*\.\s*(Router))?\s*\(/g;
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
  for (const match of masked.matchAll(/\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/g)) {
    if (!isUnconditionalModuleStatementAt(source, masked, topLevelOffsets, match.index ?? 0)) {
      continue;
    }
    if (consumeBinding(budget)) exports.set(match[1] ?? "", match[1] ?? "");
  }
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
    const parsed = parseStaticStringExpression(expression, resolved, (nestedName) =>
      resolve(nestedName, new Set(seen).add(name), depth + 1),
    );
    if (parsed.exhausted) {
      budget.truncated = true;
      return null;
    }
    const value = parsed.value;
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
  budget: BindingBudget,
): { readonly endOffset: number; readonly value: string } | null {
  const parser = staticStringParser(source, constants, from);
  const value = parseStaticStringSum(parser, () => null);
  if (parser.exhausted) budget.truncated = true;
  if (value === null || staticStringByteLength(value) > MAX_STATIC_PREFIX_BYTES) return null;
  skipStaticExpressionTrivia(parser);
  return source[parser.offset] === "," ? { endOffset: parser.offset, value } : null;
}

function parseStaticStringExpression(
  source: string,
  constants: ReadonlyMap<string, string>,
  resolveUnknown: (name: string) => string | null,
): { readonly exhausted: boolean; readonly value: string | null } {
  const parser = staticStringParser(source, constants, 0);
  const value = parseStaticStringSum(parser, resolveUnknown);
  skipStaticExpressionTrivia(parser);
  return {
    exhausted: parser.exhausted,
    value: value !== null && parser.offset === source.length ? value : null,
  };
}

function parseStaticStringSum(
  parser: StaticStringParser,
  resolveUnknown: (name: string) => string | null,
): string | null {
  if (!consumeStaticExpressionWork(parser)) return null;
  let value = parseStaticStringTerm(parser, resolveUnknown);
  if (value === null) return null;
  while (true) {
    if (!skipStaticExpressionTrivia(parser)) return null;
    if (parser.source[parser.offset] !== "+") return value;
    parser.offset += 1;
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
  if (!consumeStaticExpressionWork(parser)) return null;
  if (!skipStaticExpressionTrivia(parser)) return null;
  const character = parser.source[parser.offset];
  if (character === "'" || character === '"') {
    return parseStaticQuotedString(parser);
  }
  if (character === "`") return parseStaticTemplate(parser, resolveUnknown);
  if (character === "(") {
    if (parser.depth >= MAX_STATIC_EXPRESSION_DEPTH) {
      parser.exhausted = true;
      return null;
    }
    parser.offset += 1;
    parser.depth += 1;
    const value = parseStaticStringSum(parser, resolveUnknown);
    parser.depth -= 1;
    if (!skipStaticExpressionTrivia(parser)) return null;
    if (value === null || parser.source[parser.offset] !== ")") return null;
    parser.offset += 1;
    return value;
  }
  const identifierStart = parser.offset;
  if (!/[A-Za-z_$]/.test(parser.source[identifierStart] ?? "")) return null;
  parser.offset += 1;
  while (/[\w$]/.test(parser.source[parser.offset] ?? "")) {
    if (!consumeStaticExpressionWork(parser)) return null;
    parser.offset += 1;
  }
  const identifier = parser.source.slice(identifierStart, parser.offset);
  return parser.constants.get(identifier) ?? resolveUnknown(identifier);
}

function parseStaticTemplate(
  parser: StaticStringParser,
  resolveUnknown: (name: string) => string | null,
): string | null {
  let value = "";
  parser.offset += 1;
  while (parser.offset < parser.source.length) {
    if (!consumeStaticExpressionWork(parser)) return null;
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
      const interpolation = parseStaticTemplateInterpolation(parser);
      if (interpolation === null) return null;
      const nested = parser.constants.get(interpolation) ?? resolveUnknown(interpolation);
      if (nested === null) return null;
      value += nested;
      continue;
    }
    value += character;
    parser.offset += 1;
    if (staticStringByteLength(value) > MAX_STATIC_PREFIX_BYTES) return null;
  }
  return null;
}

function parseStaticQuotedString(parser: StaticStringParser): string | null {
  const start = parser.offset;
  const quote = parser.source[start];
  let offset = start + 1;
  while (offset < parser.source.length) {
    if (!consumeStaticExpressionWork(parser)) return null;
    const character = parser.source[offset] ?? "";
    if (character === "\n" || character === "\r") return null;
    if (character === "\\") {
      offset += 2;
      continue;
    }
    if (character === quote) {
      const boundedLiteral = `${parser.source.slice(start, offset + 1)},`;
      const parsed = staticJavaScriptStringArgumentAt(boundedLiteral, 0);
      if (!parsed) return null;
      parser.offset = offset + 1;
      return parsed.value;
    }
    offset += 1;
  }
  return null;
}

function parseStaticTemplateInterpolation(parser: StaticStringParser): string | null {
  parser.offset += 2;
  if (!skipStaticExpressionTrivia(parser)) return null;
  const start = parser.offset;
  if (!/[A-Za-z_$]/.test(parser.source[start] ?? "")) return null;
  parser.offset += 1;
  while (/[\w$]/.test(parser.source[parser.offset] ?? "")) {
    if (!consumeStaticExpressionWork(parser)) return null;
    parser.offset += 1;
  }
  const identifier = parser.source.slice(start, parser.offset);
  if (!skipStaticExpressionTrivia(parser) || parser.source[parser.offset] !== "}") return null;
  parser.offset += 1;
  return identifier;
}

function staticStringParser(
  source: string,
  constants: ReadonlyMap<string, string>,
  offset: number,
): StaticStringParser {
  return { constants, depth: 0, exhausted: false, offset, source, work: 0 };
}

function consumeStaticExpressionWork(parser: StaticStringParser, amount = 1): boolean {
  parser.work += amount;
  if (parser.work <= MAX_STATIC_EXPRESSION_WORK) return true;
  parser.exhausted = true;
  return false;
}

function skipStaticExpressionTrivia(parser: StaticStringParser): boolean {
  while (parser.offset < parser.source.length) {
    if (!consumeStaticExpressionWork(parser)) return false;
    if (/\s/.test(parser.source[parser.offset] ?? "")) {
      parser.offset += 1;
    } else if (parser.source.slice(parser.offset, parser.offset + 2) === "//") {
      const newline = parser.source.indexOf("\n", parser.offset + 2);
      const nextOffset = newline < 0 ? parser.source.length : newline + 1;
      if (!consumeStaticExpressionWork(parser, nextOffset - parser.offset - 1)) return false;
      parser.offset = nextOffset;
    } else if (parser.source.slice(parser.offset, parser.offset + 2) === "/*") {
      const close = parser.source.indexOf("*/", parser.offset + 2);
      const nextOffset = close < 0 ? parser.source.length : close + 2;
      if (!consumeStaticExpressionWork(parser, nextOffset - parser.offset - 1)) return false;
      parser.offset = nextOffset;
    } else {
      return true;
    }
  }
  return true;
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
    const parsed = staticMountArgumentsAt(
      source,
      openOffset + 1,
      stringConstants,
      Math.max(0, MAX_BINDINGS - budget.used),
      budget,
    );
    if (!parsed) continue;
    if (parsed.truncated) {
      budget.truncated = true;
      continue;
    }
    for (const target of parsed.targets) {
      if (!consumeBinding(budget)) break;
      mounts.push({ owner: match[2] ?? "", prefix: parsed.prefix, target });
    }
  }
  return mounts;
}

function staticMountArgumentsAt(
  source: string,
  from: number,
  stringConstants: ReadonlyMap<string, string>,
  maxTargets: number,
  budget: BindingBudget,
): StaticMountArguments | null {
  const literal =
    staticJavaScriptStringArgumentAt(source, from) ??
    staticMountPrefixArgumentAt(source, from, stringConstants, budget);
  const prefix = literal?.value ?? "";
  let offset = skipTrivia(source, literal ? literal.endOffset + 1 : from);
  const targets: string[] = [];

  while (offset < source.length) {
    if (targets.length >= maxTargets) {
      return { prefix, targets: [], truncated: true };
    }
    const target = bareIdentifierAt(source, offset);
    if (!target) return null;
    targets.push(target.value);
    offset = skipTrivia(source, target.endOffset);
    if (source[offset] === ")") break;
    if (source[offset] !== ",") return null;
    offset = skipTrivia(source, offset + 1);
    if (source[offset] === ")") return null;
  }

  if (source[offset] !== ")" || targets.length === 0) return null;
  // Two bare identifiers without a literal prefix are indistinguishable from
  // app.use(dynamicPrefix, router). Resolve that syntax fail-closed.
  if (!literal && targets.length !== 1) return null;
  return { prefix, targets, truncated: false };
}

function bareIdentifierAt(
  source: string,
  offset: number,
): { readonly endOffset: number; readonly value: string } | null {
  if (!/[A-Za-z_$]/.test(source[offset] ?? "")) return null;
  let endOffset = offset + 1;
  while (/[\w$]/.test(source[endOffset] ?? "")) endOffset += 1;
  return { endOffset, value: source.slice(offset, endOffset) };
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
    .map((candidate) => {
      if (!specifier.startsWith(".")) return files.get(workspacePathModuleKey(candidate));
      return (
        files.get(moduleKey(from.packageLabel, candidate)) ??
        files.get(workspacePathModuleKey(candidate))
      );
    })
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
  const candidates =
    importPathResolver?.(specifier, {
      relativeFilePath: from.filePath,
      ...(from.packageLabel ? { packageLabel: from.packageLabel } : {}),
    }) ?? [];
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

function workspacePathModuleKey(filePath: string): string {
  return `\u0001${filePath}`;
}

function uniqueAnalysesByModule(analyses: readonly FileAnalysis[]): Map<string, FileAnalysis> {
  const files = new Map<string, FileAnalysis>();
  const ambiguous = new Set<string>();
  for (const analysis of analyses) {
    for (const key of [
      moduleKey(analysis.packageLabel, analysis.filePath),
      workspacePathModuleKey(analysis.filePath),
    ]) {
      if (files.has(key) || ambiguous.has(key)) {
        files.delete(key);
        ambiguous.add(key);
      } else {
        files.set(key, analysis);
      }
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

function isCodeDeclarationAt(masked: string, offset: number): boolean {
  return /^(?:const|let|var)\b/.test(masked.slice(offset));
}

function collectTopLevelOffsets(source: string, masked: string): TopLevelOffsetScan {
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
  retainDirectModuleStatementStarts(source, offsets, masked);
  return { malformed: false, offsets };
}

function isUnconditionalModuleStatementAt(
  _source: string,
  masked: string,
  topLevelOffsets: Uint8Array,
  offset: number,
): boolean {
  if (topLevelOffsets[offset] !== 1) return false;
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

function retainDirectModuleStatementStarts(
  source: string,
  offsets: Uint8Array,
  masked: string,
): void {
  const previousWordDecision = new Map<number, boolean>();
  let boundaryAllowsStatement = true;
  let currentLineStart = 0;
  let lastNonWhitespace = -1;
  let whitespaceSinceBoundary = true;

  for (let offset = 0; offset < masked.length; offset += 1) {
    const wasTopLevel = offsets[offset] === 1;
    offsets[offset] = wasTopLevel && whitespaceSinceBoundary && boundaryAllowsStatement ? 1 : 0;
    const character = masked[offset] ?? "";
    if (character === "\n") {
      boundaryAllowsStatement = lineBreakAllowsDirectStatement(
        source,
        masked,
        currentLineStart,
        offset,
        lastNonWhitespace,
        previousWordDecision,
      );
      whitespaceSinceBoundary = true;
      currentLineStart = offset + 1;
    } else if (character === ";" || character === "}") {
      boundaryAllowsStatement = true;
      whitespaceSinceBoundary = true;
      lastNonWhitespace = offset;
    } else if (!/\s/.test(character)) {
      whitespaceSinceBoundary = false;
      lastNonWhitespace = offset;
    }
  }
}

function lineBreakAllowsDirectStatement(
  source: string,
  masked: string,
  lineStart: number,
  newlineOffset: number,
  previousOffset: number,
  previousWordDecision: Map<number, boolean>,
): boolean {
  if (previousOffset < 0) return true;
  const previous = masked[previousOffset] ?? "";
  if ("([{,:.?=<>!&|+-*%^~\\/".includes(previous)) {
    // A masked string/template literal leaves its assignment operator as the last visible
    // character. The raw line must actually end in its closing delimiter; whitespace alone after
    // an assignment remains an ambiguous continuation and therefore fails closed.
    return previous === "=" && /['"`]\s*$/.test(source.slice(lineStart, newlineOffset));
  }
  const cached = previousWordDecision.get(previousOffset);
  if (cached !== undefined) return cached;
  const previousWord = identifierEndingAt(masked, previousOffset)?.value;
  const allowed =
    !previousWord ||
    !["await", "delete", "new", "return", "throw", "typeof", "void", "yield"].includes(
      previousWord,
    );
  previousWordDecision.set(previousOffset, allowed);
  return allowed;
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
