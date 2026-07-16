import type { EditorPosition } from "../domain/languageServerFeatures";
import type { NetteLinkTarget } from "../domain/latteLinkNavigation";
import { nettePresenterShortNameFromPath } from "../domain/latteLinkNavigation";
import {
  nettePresenterNameFromClass,
  type NettePresenterMapping,
} from "../domain/nettePresenterMapping";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";

export {
  isNettePresenterDiscoverySourcePath,
  nettePresenterLinkTargetsFromSource,
  nettePresenterShortNameFromPath,
} from "../domain/latteLinkNavigation";

export interface NettePresenterLinkDependencies {
  getActiveDocument(): { path: string } | null;
  joinPath(rootPath: string, relativePath: string): string;
  listDirectory(path: string): Promise<{ kind: "directory" | "file"; path: string }[]>;
  openTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
  readFileContent(path: string): Promise<string>;
  readPhpClassSource?(
    className: string,
  ): Promise<{ path: string; source: string } | null>;
  toRelativePath(rootPath: string, path: string): string;
}

export interface NettePresenterLinkCapabilities {
  isPresenterSourcePath(path: string): boolean;
  parsePresenterLinkTarget(target: string): NetteLinkTarget | null;
  presenterActionMethodCandidates(action: string, isSignal: boolean): string[];
  presenterClassCandidatePathsForLink(
    target: NetteLinkTarget,
    currentRelativePath: string,
  ): string[];
  presenterLinkTargetsFromSource(path: string, source: string): string[];
  presenterScanDirectories: readonly string[];
}

export interface NettePresenterCacheEntry {
  expiresAt: number;
  targets: string[];
}

export type NettePresenterCache = Record<string, NettePresenterCacheEntry>;
export type NettePresenterInFlight = Map<string, Promise<string[]>>;

export interface NettePresenterDiscoveryContext {
  cache: NettePresenterCache;
  currentRelativePath: string;
  deps: NettePresenterLinkDependencies;
  frameworkCapabilities: NettePresenterLinkCapabilities;
  inFlight: NettePresenterInFlight;
  isDirectorySkipped(path: string): boolean;
  isCacheWriteCurrent?(): boolean;
  isRequestedRootActive(): boolean;
  isPresenterMappingGenerationCurrent?(): boolean;
  loadPresenterMappings?(): Promise<readonly NettePresenterMapping[]>;
  maxDepth: number;
  maxPresenters: number;
  requestedRoot: string;
  ttlMs: number;
}

interface PresenterScanState {
  presentersFound: number;
  visitedDirectories: Set<string>;
}

export async function loadNettePresenterLinkTargets(
  context: NettePresenterDiscoveryContext,
): Promise<string[]> {
  const { cache, inFlight, requestedRoot } = context;
  const rootKey = normalizedWorkspaceRootKey(requestedRoot);
  const cached = cache[rootKey];

  if (cached && cached.expiresAt > Date.now()) {
    return cached.targets;
  }

  const existing = inFlight.get(rootKey);

  if (existing) {
    return existing;
  }

  const load = scanNettePresenterLinkTargets(context).finally(() => {
    if (inFlight.get(rootKey) === load) {
      inFlight.delete(rootKey);
    }
  });

  inFlight.set(rootKey, load);

  return load;
}

export async function scanNettePresenterLinkTargets(
  context: NettePresenterDiscoveryContext,
): Promise<string[]> {
  const {
    cache,
    deps,
    frameworkCapabilities,
    isRequestedRootActive,
    maxPresenters,
    requestedRoot,
    ttlMs,
  } = context;
  const presenterPaths = new Set<string>();
  const mappings = context.loadPresenterMappings
    ? await context.loadPresenterMappings()
    : [];

  if (
    !isRequestedRootActive() ||
    (context.isCacheWriteCurrent && !context.isCacheWriteCurrent())
  ) {
    return [];
  }

  const scanState: PresenterScanState = {
    presentersFound: 0,
    visitedDirectories: new Set<string>(),
  };

  for (const directory of frameworkCapabilities.presenterScanDirectories) {
    await collectNettePresenterPaths(
      context,
      deps.joinPath(requestedRoot, directory),
      presenterPaths,
      0,
      scanState,
    );

    if (!isRequestedRootActive()) {
      return [];
    }

    if (scanState.presentersFound >= maxPresenters) {
      break;
    }
  }

  const targets = new Set<string>();

  for (const path of presenterPaths) {
    if (!isRequestedRootActive()) {
      return [];
    }

    let content: string;

    try {
      content = await deps.readFileContent(path);
    } catch {
      if (!isRequestedRootActive()) {
        return [];
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return [];
    }

    for (const target of mappedPresenterTargetsFromSource(
      path,
      content,
      mappings,
      frameworkCapabilities.presenterLinkTargetsFromSource(path, content),
    )) {
      targets.add(target);
    }
  }

  if (
    !isRequestedRootActive() ||
    (context.isCacheWriteCurrent && !context.isCacheWriteCurrent())
  ) {
    return [];
  }

  const sorted = Array.from(targets).sort((left, right) =>
    left.localeCompare(right),
  );
  cache[normalizedWorkspaceRootKey(requestedRoot)] = {
    expiresAt: Date.now() + ttlMs,
    targets: sorted,
  };

  return sorted;
}

function mappedPresenterTargetsFromSource(
  path: string,
  source: string,
  mappings: readonly NettePresenterMapping[],
  targets: readonly string[],
): string[] {
  if (mappings.length === 0) {
    return [...targets];
  }

  const className = phpPrimaryQualifiedClassName(source);
  const presenterNames = className
    ? Array.from(new Set(mappings.flatMap((mapping) => {
        const name = nettePresenterNameFromClass(className, [mapping]);
        return name ? [name] : [];
      })))
    : [];
  const shortName = nettePresenterShortNameFromPath(path);

  if (presenterNames.length === 0 || !shortName) {
    return [...targets];
  }

  const prefix = `${shortName}:`;

  return targets.flatMap((target) => {
    if (!target.startsWith(prefix)) {
      return [target];
    }

    return presenterNames.map(
      (presenterName) => `:${presenterName}:${target.slice(prefix.length)}`,
    );
  });
}

function phpPrimaryQualifiedClassName(source: string): string | null {
  const className = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(source)?.[1];

  if (!className) {
    return null;
  }

  const namespace = /\bnamespace\s+([^;{]+)\s*[;{]/.exec(source)?.[1]?.trim();

  return namespace ? `${namespace}\\${className}` : className;
}

async function collectNettePresenterPaths(
  context: NettePresenterDiscoveryContext,
  directory: string,
  into: Set<string>,
  depth: number,
  scanState: PresenterScanState,
): Promise<void> {
  const {
    deps,
    frameworkCapabilities,
    isDirectorySkipped,
    isRequestedRootActive,
    maxDepth,
    maxPresenters,
  } = context;

  if (depth > maxDepth) {
    return;
  }

  if (scanState.presentersFound >= maxPresenters) {
    return;
  }

  if (scanState.visitedDirectories.has(directory)) {
    return;
  }

  scanState.visitedDirectories.add(directory);

  let entries: { kind: "directory" | "file"; path: string }[];

  try {
    entries = await deps.listDirectory(directory);
  } catch {
    return;
  }

  if (!isRequestedRootActive()) {
    return;
  }

  for (const entry of entries) {
    if (!isRequestedRootActive()) {
      return;
    }

    if (scanState.presentersFound >= maxPresenters) {
      return;
    }

    if (entry.kind === "directory") {
      if (isDirectorySkipped(entry.path)) {
        continue;
      }

      await collectNettePresenterPaths(
        context,
        entry.path,
        into,
        depth + 1,
        scanState,
      );
      continue;
    }

    if (!frameworkCapabilities.isPresenterSourcePath(entry.path)) {
      continue;
    }

    into.add(entry.path);
    scanState.presentersFound += 1;
  }
}
