import { parseBoundedJsonc } from "../domain/boundedJsonc";
import type {
  ExpressImportPathImporter,
  ExpressImportPathResolver,
} from "../domain/expressRouteMounts";
import type { WorkspaceSourceDiscoveryGateway } from "../domain/workspaceSourceDiscovery";
import type { WorkspacePackageGraph } from "../domain/workspacePackageGraph";
import { createTsPathAliasResolver, type TsPathAliasResolver } from "../domain/tsPathAliasResolver";

const MAX_TSCONFIG_BYTES = 256 * 1024;
const MAX_TOTAL_TSCONFIG_BYTES = 4 * 1024 * 1024;
const MAX_CONFIG_FILES = 1_024;
const MAX_EXTENDS_DEPTH = 32;
const MAX_EXTENDS_VALUE_BYTES = 1_024;
const MAX_NODE_MODULE_ANCESTORS = 64;
const BASE_PACKAGE_EXTENDS_PROBES = 256;
const MAX_PACKAGE_EXTENDS_PROBES = 1_024;
const PACKAGE_EXTENDS_PROBES_PER_DIRECTORY = 8;
const MAX_PACKAGE_ENTRY_DEPTH = 8;
const READ_CONCURRENCY = 8;

export type ExpressRouteTsconfigAliasRead =
  | {
      readonly importPathResolver: ExpressImportPathResolver | undefined;
      readonly status: "current";
      readonly truncated: boolean;
    }
  | { readonly status: "stale" };

interface EntryConfig {
  readonly configDirectory: string;
  readonly configPath: string;
}

type ConfigNode =
  | {
      readonly configDirectory: string;
      readonly parsed: unknown;
      readonly status: "parsed";
    }
  | {
      readonly configDirectory: string;
      readonly status: "incomplete";
    }
  | {
      readonly configDirectory: string;
      readonly status: "missing";
    };

interface ResolvedConfig {
  readonly resolve: TsPathAliasResolver;
  readonly resolvedBaseUrl: string;
}

interface AliasReadContext {
  readonly nodesByPath: Map<string, ConfigNode>;
  readonly packageMetadataByPath: Map<string, PackageExtendsMetadata>;
  packageProbeCount: number;
  readonly packageProbeLimit: number;
  stoppedByBudget: boolean;
  totalBytes: number;
  truncated: boolean;
}

export async function readExpressRouteTsconfigAliases({
  allowUnscopedRoot,
  gateway,
  incompleteDirectories,
  isCurrent,
  packageDirectories,
  rootPath,
  workspacePackageGraph,
}: {
  readonly allowUnscopedRoot: boolean;
  readonly gateway: WorkspaceSourceDiscoveryGateway;
  readonly incompleteDirectories: readonly string[];
  readonly isCurrent: () => boolean;
  readonly packageDirectories: readonly string[];
  readonly rootPath: string;
  readonly workspacePackageGraph: WorkspacePackageGraph;
}): Promise<ExpressRouteTsconfigAliasRead> {
  const entryConfigs = uniqueConfigDirectories(["", ...packageDirectories]).map(
    (configDirectory): EntryConfig => ({
      configDirectory,
      configPath: tsconfigRelativePath(configDirectory),
    }),
  );
  const incomplete = new Set(incompleteDirectories);
  const context: AliasReadContext = {
    nodesByPath: new Map(
      entryConfigs
        .filter(({ configDirectory }) => incomplete.has(configDirectory))
        .map(({ configDirectory, configPath }) => [
          configPath,
          { configDirectory, status: "incomplete" },
        ]),
    ),
    packageMetadataByPath: new Map(),
    packageProbeCount: 0,
    packageProbeLimit: Math.min(
      MAX_PACKAGE_EXTENDS_PROBES,
      BASE_PACKAGE_EXTENDS_PROBES +
        packageDirectories.length * PACKAGE_EXTENDS_PROBES_PER_DIRECTORY,
    ),
    stoppedByBudget: false,
    totalBytes: 0,
    truncated: incomplete.size > 0,
  };
  const readableEntries = entryConfigs.filter(
    ({ configDirectory }) => !incomplete.has(configDirectory),
  );

  for (
    let start = 0;
    start < readableEntries.length && !context.stoppedByBudget;
    start += READ_CONCURRENCY
  ) {
    const entries = readableEntries.slice(start, start + READ_CONCURRENCY);
    const reads = await Promise.all(
      entries.map(({ configPath }) => readConfigSource(gateway, rootPath, configPath, isCurrent)),
    );
    if (!isCurrent() || reads.some(({ status }) => status === "stale")) {
      return { status: "stale" };
    }
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const read = reads[index];
      if (!entry || !read || read.status === "stale") continue;
      admitConfigRead(entry.configPath, entry.configDirectory, read, context, false);
      await yieldToMainThread();
      if (!isCurrent()) return { status: "stale" };
    }
  }

  if (context.stoppedByBudget) {
    for (const entry of entryConfigs) {
      if (!context.nodesByPath.has(entry.configPath)) {
        context.nodesByPath.set(entry.configPath, {
          configDirectory: entry.configDirectory,
          status: "incomplete",
        });
      }
    }
  }

  const resolvedByPath = new Map<string, ResolvedConfig | null>();
  const visiting = new Set<string>();
  const resolvers: ScopedResolver[] = [];
  for (const entry of entryConfigs) {
    const resolved = await resolveConfig(
      entry.configPath,
      0,
      visiting,
      resolvedByPath,
      context,
      gateway,
      rootPath,
      isCurrent,
      workspacePackageGraph,
    );
    if (!isCurrent()) return { status: "stale" };
    const entryNode = context.nodesByPath.get(entry.configPath);
    if (entry.configDirectory === "" || entryNode?.status !== "missing") {
      resolvers.push({
        configDirectory: entry.configDirectory,
        ...(resolved ? { resolve: resolved.resolve } : {}),
      });
    }
    await yieldToMainThread();
    if (!isCurrent()) return { status: "stale" };
  }

  return {
    importPathResolver: scopedTsPathAliasResolver(resolvers, allowUnscopedRoot),
    status: "current",
    truncated: context.truncated,
  };
}

async function resolveConfig(
  configPath: string,
  depth: number,
  visiting: Set<string>,
  resolvedByPath: Map<string, ResolvedConfig | null>,
  context: AliasReadContext,
  gateway: WorkspaceSourceDiscoveryGateway,
  rootPath: string,
  isCurrent: () => boolean,
  workspacePackageGraph: WorkspacePackageGraph,
): Promise<ResolvedConfig | null> {
  if (resolvedByPath.has(configPath)) {
    if (depth > 0 && context.nodesByPath.get(configPath)?.status === "missing") {
      context.truncated = true;
    }
    return resolvedByPath.get(configPath) ?? null;
  }
  if (depth > MAX_EXTENDS_DEPTH || visiting.has(configPath)) {
    context.truncated = true;
    return null;
  }
  const node = await loadConfigNode(configPath, context, gateway, rootPath, isCurrent);
  if (!isCurrent()) return null;
  if (!node || node.status !== "parsed") {
    if (depth > 0 && node?.status === "missing") context.truncated = true;
    resolvedByPath.set(configPath, null);
    return null;
  }
  await yieldToMainThread();
  if (!isCurrent()) return null;

  visiting.add(configPath);
  try {
    const extended = await extendedTsconfigPath(
      node.parsed,
      node.configDirectory,
      context,
      gateway,
      rootPath,
      isCurrent,
      workspacePackageGraph,
    );
    if (!isCurrent()) return null;
    if (extended.status === "unsupported") {
      context.truncated = true;
      resolvedByPath.set(configPath, null);
      return null;
    }
    const parent =
      extended.status === "resolved"
        ? await resolveConfig(
            extended.relativePath,
            depth + 1,
            visiting,
            resolvedByPath,
            context,
            gateway,
            rootPath,
            isCurrent,
            workspacePackageGraph,
          )
        : undefined;
    if (!isCurrent()) return null;
    if (extended.status === "resolved" && !parent) {
      resolvedByPath.set(configPath, null);
      return null;
    }
    const local = createTsPathAliasResolver(node.parsed, {
      configDirectory: node.configDirectory,
      ...(parent ? { inheritedBaseUrl: parent.resolvedBaseUrl } : {}),
    });
    context.truncated ||= local.truncated;
    if (local.resolvedBaseUrl === null) {
      resolvedByPath.set(configPath, null);
      return null;
    }
    const resolved: ResolvedConfig = {
      resolve: hasOwnTsconfigPaths(node.parsed)
        ? local.resolve
        : (parent?.resolve ?? local.resolve),
      resolvedBaseUrl: local.resolvedBaseUrl,
    };
    resolvedByPath.set(configPath, resolved);
    return resolved;
  } finally {
    visiting.delete(configPath);
  }
}

async function loadConfigNode(
  configPath: string,
  context: AliasReadContext,
  gateway: WorkspaceSourceDiscoveryGateway,
  rootPath: string,
  isCurrent: () => boolean,
): Promise<ConfigNode | undefined> {
  const existing = context.nodesByPath.get(configPath);
  if (existing) return existing;
  if (context.nodesByPath.size >= MAX_CONFIG_FILES || context.stoppedByBudget) {
    context.truncated = true;
    return undefined;
  }
  const read = await readConfigSource(gateway, rootPath, configPath, isCurrent);
  if (!isCurrent() || read.status === "stale") return undefined;
  return admitConfigRead(configPath, configDirectoryFromPath(configPath), read, context, true);
}

type ConfigSourceRead =
  | { readonly content: string; readonly status: "source" }
  | { readonly status: "incomplete" }
  | { readonly status: "missing" }
  | { readonly status: "stale" };

async function readConfigSource(
  gateway: WorkspaceSourceDiscoveryGateway,
  rootPath: string,
  configPath: string,
  isCurrent: () => boolean,
  maxBytes: number = MAX_TSCONFIG_BYTES,
): Promise<ConfigSourceRead> {
  try {
    let read = await gateway.readSourceTextBounded(rootPath, configPath, maxBytes);
    if (!isCurrent()) return { status: "stale" };
    if (read.status === "changed") {
      read = await gateway.readSourceTextBounded(rootPath, configPath, maxBytes);
    }
    if (!isCurrent()) return { status: "stale" };
    if (read.status === "ok") return { content: read.content, status: "source" };
    return read.status === "notFound" ? { status: "missing" } : { status: "incomplete" };
  } catch {
    return isCurrent() ? { status: "incomplete" } : { status: "stale" };
  }
}

function admitConfigRead(
  configPath: string,
  configDirectory: string,
  read:
    | { readonly content: string; readonly status: "source" }
    | { readonly status: "incomplete" }
    | { readonly status: "missing" },
  context: AliasReadContext,
  requiredByExtends: boolean,
): ConfigNode {
  if (read.status === "missing") {
    const node: ConfigNode = { configDirectory, status: "missing" };
    context.nodesByPath.set(configPath, node);
    context.truncated ||= requiredByExtends;
    return node;
  }
  if (read.status === "incomplete") {
    const node: ConfigNode = { configDirectory, status: "incomplete" };
    context.nodesByPath.set(configPath, node);
    context.truncated = true;
    return node;
  }
  const bytes = utf8ByteLength(read.content);
  if (context.totalBytes + bytes > MAX_TOTAL_TSCONFIG_BYTES) {
    const node: ConfigNode = { configDirectory, status: "incomplete" };
    context.nodesByPath.set(configPath, node);
    context.stoppedByBudget = true;
    context.truncated = true;
    return node;
  }
  context.totalBytes += bytes;
  try {
    const node: ConfigNode = {
      configDirectory,
      parsed: parseBoundedJsonc(read.content, {
        maxDepth: MAX_EXTENDS_DEPTH,
        maxNodes: MAX_TSCONFIG_BYTES,
      }),
      status: "parsed",
    };
    context.nodesByPath.set(configPath, node);
    return node;
  } catch {
    const node: ConfigNode = { configDirectory, status: "incomplete" };
    context.nodesByPath.set(configPath, node);
    context.truncated ||= requiredByExtends;
    return node;
  }
}

type RelativeExtendedTsconfigPath =
  | { readonly status: "none" | "unsupported" }
  | { readonly relativePath: string; readonly status: "resolved" };

async function extendedTsconfigPath(
  config: unknown,
  configDirectory: string,
  context: AliasReadContext,
  gateway: WorkspaceSourceDiscoveryGateway,
  rootPath: string,
  isCurrent: () => boolean,
  workspacePackageGraph: WorkspacePackageGraph,
): Promise<RelativeExtendedTsconfigPath> {
  if (!isUnknownRecord(config)) return { status: "unsupported" };
  const value = config.extends;
  if (value === undefined) return { status: "none" };
  if (
    typeof value !== "string" ||
    utf8ByteLength(value) > MAX_EXTENDS_VALUE_BYTES ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return { status: "unsupported" };
  }
  if (!value.startsWith("./") && !value.startsWith("../")) {
    return resolvePackageExtendedTsconfigPath(
      value,
      configDirectory,
      context,
      gateway,
      rootPath,
      isCurrent,
      workspacePackageGraph,
    );
  }
  const normalized = resolveWorkspaceRelativePath(configDirectory, value);
  if (normalized === null) {
    return { status: "unsupported" };
  }
  const configPath = normalized.endsWith(".json") ? normalized : `${normalized}.json`;
  if (!/^tsconfig(?:\.[^/]+)?\.json$/u.test(fileName(configPath))) {
    return { status: "unsupported" };
  }
  return { relativePath: configPath, status: "resolved" };
}

async function resolvePackageExtendedTsconfigPath(
  specifier: string,
  configDirectory: string,
  context: AliasReadContext,
  gateway: WorkspaceSourceDiscoveryGateway,
  rootPath: string,
  isCurrent: () => boolean,
  workspacePackageGraph: WorkspacePackageGraph,
): Promise<RelativeExtendedTsconfigPath> {
  const parsed = parsePackageSpecifier(specifier);
  if (!parsed) return { status: "unsupported" };
  const workspaceResolution = parsed.subpath
    ? workspacePackageGraph.resolvePackagePath(specifier)
    : workspacePackageGraph.resolvePackageDirectory(parsed.packageName);
  if (workspaceResolution.status === "resolved" && parsed.subpath) {
    const resolved = await probeConfigCandidates(
      configCandidatePaths(workspaceResolution.relativePath),
      context,
      gateway,
      rootPath,
      isCurrent,
    );
    return resolved.status === "missing" ? { status: "unsupported" } : resolved;
  }
  if (workspaceResolution.status === "resolved") {
    return resolveBarePackageDirectory(
      workspaceResolution.relativePath,
      context,
      gateway,
      rootPath,
      isCurrent,
    );
  }
  const ancestorDirectories = nodeModulesAncestorDirectories(configDirectory);
  for (const ancestorDirectory of ancestorDirectories) {
    const packageBase = joinWorkspacePath(ancestorDirectory, `node_modules/${parsed.packageName}`);
    if (!packageBase) return { status: "unsupported" };
    if (parsed.subpath) {
      const resolved = await probeConfigCandidates(
        configCandidatePaths(joinWorkspacePath(packageBase, parsed.subpath)),
        context,
        gateway,
        rootPath,
        isCurrent,
      );
      if (resolved.status !== "missing") return resolved;
      continue;
    }
    const fileFallback = await probeConfigCandidates(
      [`${packageBase}.json`],
      context,
      gateway,
      rootPath,
      isCurrent,
    );
    if (fileFallback.status !== "missing") return fileFallback;
    const metadata = await readPackageExtendsMetadata(
      `${packageBase}/package.json`,
      context,
      gateway,
      rootPath,
      isCurrent,
    );
    if (metadata.status === "stale") return { status: "unsupported" };
    if (metadata.status === "unsupported") return { status: "unsupported" };
    if (metadata.status === "entry") {
      const entryBase = resolveWorkspaceRelativePath(packageBase, metadata.entry);
      if (!entryBase) return { status: "unsupported" };
      const resolved = await probeConfigCandidates(
        configCandidatePaths(entryBase),
        context,
        gateway,
        rootPath,
        isCurrent,
      );
      if (resolved.status === "resolved") return resolved;
    }
    const fallback = await probeConfigCandidates(
      [`${packageBase}/tsconfig.json`],
      context,
      gateway,
      rootPath,
      isCurrent,
    );
    if (fallback.status !== "missing") return fallback;
  }
  return { status: "unsupported" };
}

async function resolveBarePackageDirectory(
  packageBase: string,
  context: AliasReadContext,
  gateway: WorkspaceSourceDiscoveryGateway,
  rootPath: string,
  isCurrent: () => boolean,
): Promise<RelativeExtendedTsconfigPath> {
  const metadata = await readPackageExtendsMetadata(
    `${packageBase}/package.json`,
    context,
    gateway,
    rootPath,
    isCurrent,
  );
  if (metadata.status === "stale" || metadata.status === "unsupported") {
    return { status: "unsupported" };
  }
  if (metadata.status === "entry") {
    const entryBase = resolveWorkspaceRelativePath(packageBase, metadata.entry);
    if (!entryBase) return { status: "unsupported" };
    const resolved = await probeConfigCandidates(
      configCandidatePaths(entryBase),
      context,
      gateway,
      rootPath,
      isCurrent,
    );
    if (resolved.status === "resolved") return resolved;
  }
  const fallback = await probeConfigCandidates(
    [`${packageBase}/tsconfig.json`],
    context,
    gateway,
    rootPath,
    isCurrent,
  );
  return fallback.status === "missing" ? { status: "unsupported" } : fallback;
}

function parsePackageSpecifier(
  specifier: string,
): { readonly packageName: string; readonly subpath: string } | null {
  if (
    !specifier ||
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.length > MAX_EXTENDS_VALUE_BYTES
  ) {
    return null;
  }
  const segments = specifier.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  const packageSegmentCount = specifier.startsWith("@") ? 2 : 1;
  if (segments.length < packageSegmentCount) return null;
  const packageName = segments.slice(0, packageSegmentCount).join("/");
  const subpath = segments.slice(packageSegmentCount).join("/");
  return { packageName, subpath };
}

function nodeModulesAncestorDirectories(configDirectory: string): readonly string[] {
  const segments = configDirectory ? configDirectory.split("/") : [];
  const directories: string[] = [];
  for (let index = segments.length; index >= 0; index -= 1) {
    if (directories.length >= MAX_NODE_MODULE_ANCESTORS) break;
    directories.push(segments.slice(0, index).join("/"));
  }
  return directories;
}

function configCandidatePaths(base: string | null): readonly string[] {
  if (!base) return [];
  if (base.endsWith(".json")) return [base];
  return [base, `${base}.json`, `${base}/tsconfig.json`];
}

async function probeConfigCandidates(
  candidates: readonly string[],
  context: AliasReadContext,
  gateway: WorkspaceSourceDiscoveryGateway,
  rootPath: string,
  isCurrent: () => boolean,
): Promise<RelativeExtendedTsconfigPath | { readonly status: "missing" }> {
  if (configReadBudgetUnavailable(context)) return { status: "unsupported" };
  let incomplete = false;
  for (const configPath of candidates) {
    const existing = context.nodesByPath.get(configPath);
    if (existing?.status === "parsed") return { relativePath: configPath, status: "resolved" };
    if (existing?.status === "incomplete") {
      incomplete = true;
      continue;
    }
    if (existing?.status === "missing") continue;
    if (configReadBudgetUnavailable(context)) return { status: "unsupported" };
    if (!consumePackageProbe(context)) return { status: "unsupported" };
    const readLimit = remainingConfigReadBytes(context);
    const read = await readConfigSource(gateway, rootPath, configPath, isCurrent, readLimit);
    if (!isCurrent() || read.status === "stale") return { status: "unsupported" };
    if (read.status === "incomplete") {
      context.totalBytes += readLimit;
      context.stoppedByBudget = context.totalBytes >= MAX_TOTAL_TSCONFIG_BYTES;
      context.truncated = true;
    }
    const node = admitConfigRead(
      configPath,
      configDirectoryFromPath(configPath),
      read,
      context,
      false,
    );
    if (node.status === "parsed") return { relativePath: configPath, status: "resolved" };
    if (node.status === "incomplete") incomplete = true;
  }
  return incomplete ? { status: "unsupported" } : { status: "missing" };
}

type PackageExtendsMetadata =
  | { readonly entry: string; readonly status: "entry" }
  | { readonly status: "missing" | "stale" | "unsupported" };

async function readPackageExtendsMetadata(
  packageJsonPath: string,
  context: AliasReadContext,
  gateway: WorkspaceSourceDiscoveryGateway,
  rootPath: string,
  isCurrent: () => boolean,
): Promise<PackageExtendsMetadata> {
  const cached = context.packageMetadataByPath.get(packageJsonPath);
  if (cached) return cached;
  if (configReadBudgetUnavailable(context)) return { status: "unsupported" };
  if (!consumePackageProbe(context)) return { status: "unsupported" };
  const readLimit = remainingConfigReadBytes(context);
  const read = await readConfigSource(
    gateway,
    rootPath,
    packageJsonPath,
    isCurrent,
    readLimit,
  );
  if (!isCurrent() || read.status === "stale") return { status: "stale" };
  if (read.status === "missing") {
    const result = { status: "missing" } as const;
    context.packageMetadataByPath.set(packageJsonPath, result);
    return result;
  }
  if (read.status === "incomplete") {
    context.totalBytes += readLimit;
    context.stoppedByBudget = context.totalBytes >= MAX_TOTAL_TSCONFIG_BYTES;
    context.truncated = true;
    const result = { status: "unsupported" } as const;
    context.packageMetadataByPath.set(packageJsonPath, result);
    return result;
  }
  const bytes = utf8ByteLength(read.content);
  if (context.totalBytes + bytes > MAX_TOTAL_TSCONFIG_BYTES) {
    context.stoppedByBudget = true;
    context.truncated = true;
    return { status: "unsupported" };
  }
  context.totalBytes += bytes;
  try {
    const parsed = parseBoundedJsonc(read.content, {
      maxDepth: MAX_PACKAGE_ENTRY_DEPTH,
      maxNodes: MAX_TSCONFIG_BYTES,
    });
    const entry = packageConfigEntry(parsed);
    const result: PackageExtendsMetadata = entry
      ? { entry, status: "entry" }
      : { status: "missing" };
    context.packageMetadataByPath.set(packageJsonPath, result);
    return result;
  } catch {
    const result = { status: "unsupported" } as const;
    context.packageMetadataByPath.set(packageJsonPath, result);
    return result;
  }
}

function configReadBudgetUnavailable(context: AliasReadContext): boolean {
  if (
    !context.stoppedByBudget &&
    context.nodesByPath.size < MAX_CONFIG_FILES &&
    context.totalBytes < MAX_TOTAL_TSCONFIG_BYTES
  ) {
    return false;
  }
  context.stoppedByBudget ||= context.totalBytes >= MAX_TOTAL_TSCONFIG_BYTES;
  context.truncated = true;
  return true;
}

function remainingConfigReadBytes(context: AliasReadContext): number {
  return Math.min(MAX_TSCONFIG_BYTES, MAX_TOTAL_TSCONFIG_BYTES - context.totalBytes);
}

function packageConfigEntry(manifest: unknown): string | null {
  if (!isUnknownRecord(manifest)) return null;
  if (typeof manifest.tsconfig === "string") return manifest.tsconfig;
  const exported = packageExportEntry(manifest.exports, 0);
  if (exported) return exported;
  return null;
}

function packageExportEntry(value: unknown, depth: number): string | null {
  if (depth > MAX_PACKAGE_ENTRY_DEPTH) return null;
  if (typeof value === "string") return value;
  if (!isUnknownRecord(value)) return null;
  if (Object.prototype.hasOwnProperty.call(value, ".")) {
    return packageExportEntry(value["."], depth + 1);
  }
  for (const condition of ["types", "source", "import", "require", "default"]) {
    if (!Object.prototype.hasOwnProperty.call(value, condition)) continue;
    const entry = packageExportEntry(value[condition], depth + 1);
    if (entry) return entry;
  }
  return null;
}

function consumePackageProbe(context: AliasReadContext): boolean {
  context.packageProbeCount += 1;
  if (context.packageProbeCount <= context.packageProbeLimit) return true;
  context.truncated = true;
  return false;
}

function joinWorkspacePath(directory: string, relativePath: string): string | null {
  if (!relativePath || relativePath.includes("\\") || relativePath.startsWith("/")) return null;
  const segments = directory ? directory.split("/") : [];
  for (const segment of relativePath.split("/")) {
    if (!segment || segment === "." || segment === "..") return null;
    segments.push(segment);
  }
  const normalized = segments.join("/");
  return normalized.length <= 4_096 ? normalized : null;
}

function resolveWorkspaceRelativePath(
  configDirectory: string,
  relativePath: string,
): string | null {
  const segments = configDirectory ? configDirectory.split("/") : [];
  for (const segment of relativePath.split("/")) {
    if (segment === ".") continue;
    if (!segment) return null;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    if (segment.toLowerCase() === "node_modules") return null;
    segments.push(segment);
  }
  const normalized = segments.join("/");
  return normalized.length > 0 && normalized.length <= 4_096 ? normalized : null;
}

interface ScopedResolver {
  readonly configDirectory: string;
  readonly resolve?: TsPathAliasResolver;
}

function scopedTsPathAliasResolver(
  resolvers: readonly ScopedResolver[],
  allowUnscopedRoot: boolean,
): ExpressImportPathResolver | undefined {
  if (resolvers.length === 0) return undefined;
  const ordered = [...resolvers].sort(
    (left, right) =>
      right.configDirectory.length - left.configDirectory.length ||
      compareText(left.configDirectory, right.configDirectory),
  );
  const resolverByImporter = new Map<string, TsPathAliasResolver | null>();
  return (specifier: string, importer: ExpressImportPathImporter) => {
    let resolver = resolverByImporter.get(importer.relativeFilePath);
    if (resolver === undefined) {
      const owner = ordered.find(({ configDirectory }) =>
        pathBelongsToConfig(importer.relativeFilePath, configDirectory),
      );
      resolver =
        !owner || (owner.configDirectory === "" && !allowUnscopedRoot)
          ? null
          : (owner.resolve ?? null);
      if (resolverByImporter.size < MAX_CONFIG_FILES) {
        resolverByImporter.set(importer.relativeFilePath, resolver);
      }
    }
    return resolver?.(specifier) ?? [];
  };
}

function pathBelongsToConfig(relativeFilePath: string, configDirectory: string): boolean {
  return (
    configDirectory === "" ||
    relativeFilePath === configDirectory ||
    relativeFilePath.startsWith(`${configDirectory}/`)
  );
}

function uniqueConfigDirectories(directories: readonly string[]): readonly string[] {
  return directories.filter(
    (directory, index, candidates) => candidates.indexOf(directory) === index,
  );
}

function configDirectoryFromPath(configPath: string): string {
  const separator = configPath.lastIndexOf("/");
  return separator < 0 ? "" : configPath.slice(0, separator);
}

function tsconfigRelativePath(configDirectory: string): string {
  return configDirectory ? `${configDirectory}/tsconfig.json` : "tsconfig.json";
}

function fileName(relativePath: string): string {
  return relativePath.slice(relativePath.lastIndexOf("/") + 1);
}

function hasOwnTsconfigPaths(config: unknown): boolean {
  return (
    isUnknownRecord(config) &&
    isUnknownRecord(config.compilerOptions) &&
    Object.prototype.hasOwnProperty.call(config.compilerOptions, "paths")
  );
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit < 0x80) bytes += 1;
    else if (codeUnit < 0x800) bytes += 2;
    else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
