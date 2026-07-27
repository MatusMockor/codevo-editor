import { parseBoundedJsonc } from "../domain/boundedJsonc";
import type {
  ExpressImportPathImporter,
  ExpressImportPathResolver,
} from "../domain/expressRouteMounts";
import type { WorkspaceSourceDiscoveryGateway } from "../domain/workspaceSourceDiscovery";
import { createTsPathAliasResolver, type TsPathAliasResolver } from "../domain/tsPathAliasResolver";

const MAX_TSCONFIG_BYTES = 256 * 1024;
const MAX_TOTAL_TSCONFIG_BYTES = 4 * 1024 * 1024;
const MAX_CONFIG_FILES = 1_024;
const MAX_EXTENDS_DEPTH = 32;
const MAX_EXTENDS_VALUE_BYTES = 1_024;
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
}: {
  readonly allowUnscopedRoot: boolean;
  readonly gateway: WorkspaceSourceDiscoveryGateway;
  readonly incompleteDirectories: readonly string[];
  readonly isCurrent: () => boolean;
  readonly packageDirectories: readonly string[];
  readonly rootPath: string;
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
    const extended = relativeExtendedTsconfigPath(node.parsed, node.configDirectory);
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
): Promise<ConfigSourceRead> {
  try {
    let read = await gateway.readSourceTextBounded(rootPath, configPath, MAX_TSCONFIG_BYTES);
    if (!isCurrent()) return { status: "stale" };
    if (read.status === "changed") {
      read = await gateway.readSourceTextBounded(rootPath, configPath, MAX_TSCONFIG_BYTES);
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

function relativeExtendedTsconfigPath(
  config: unknown,
  configDirectory: string,
): RelativeExtendedTsconfigPath {
  if (!isUnknownRecord(config)) return { status: "unsupported" };
  const value = config.extends;
  if (value === undefined) return { status: "none" };
  if (
    typeof value !== "string" ||
    utf8ByteLength(value) > MAX_EXTENDS_VALUE_BYTES ||
    (!value.startsWith("./") && !value.startsWith("../")) ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return { status: "unsupported" };
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
