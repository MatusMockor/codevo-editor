export interface LatteDirectoryEntry {
  kind: "directory" | "file";
  path: string;
}

export interface NetteTemplateDiscoveryDependencies {
  joinPath(rootPath: string, relativePath: string): string;
  listDirectory(path: string): Promise<LatteDirectoryEntry[]>;
  toRelativePath(rootPath: string, path: string): string;
}

export interface NetteTemplateCacheEntry {
  complete: boolean;
  expiresAt: number;
  relativePaths: string[];
}

export type LatteTemplateCache = Record<string, NetteTemplateCacheEntry>;

export interface NetteTemplateScanContext {
  cache: LatteTemplateCache;
  deps: NetteTemplateDiscoveryDependencies;
  isRequestedRootActive(): boolean;
  maxDepth: number;
  maxTemplates: number;
  requestedRoot: string;
  scanDirectories: readonly string[];
  ttlMs: number;
}

interface TemplateScanState {
  depthLimitHit: boolean;
  templatesFound: number;
  visitedDirectories: Set<string>;
}

const LATTE_TEMPLATE_EXTENSION = ".latte";
const LATTE_SCAN_SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  ".git",
  ".idea",
  ".vscode",
  "assets",
  "log",
  "node_modules",
  "temp",
  "vendor",
]);

export function isLatteScanSkippedDirectory(path: string): boolean {
  const segments = path.split("/");
  const basename = segments[segments.length - 1] ?? "";

  return LATTE_SCAN_SKIPPED_DIRECTORIES.has(basename);
}

export async function listLatteTemplateRelativePaths(
  context: NetteTemplateScanContext,
): Promise<string[]> {
  const {
    cache,
    deps,
    isRequestedRootActive,
    maxTemplates,
    requestedRoot,
    scanDirectories,
    ttlMs,
  } = context;
  const cached = cache[requestedRoot];

  if (cached && cached.expiresAt > Date.now()) {
    return cached.relativePaths;
  }

  const relativePaths = new Set<string>();
  const scanState: TemplateScanState = {
    depthLimitHit: false,
    templatesFound: 0,
    visitedDirectories: new Set<string>(),
  };

  for (const directory of scanDirectories) {
    await collectLatteTemplates(
      context,
      deps.joinPath(requestedRoot, directory),
      relativePaths,
      0,
      scanState,
    );

    if (!isRequestedRootActive()) {
      return [];
    }

    if (scanState.templatesFound >= maxTemplates) {
      break;
    }
  }

  const sorted = Array.from(relativePaths).sort((left, right) =>
    left.localeCompare(right),
  );
  cache[requestedRoot] = {
    complete: !scanState.depthLimitHit && scanState.templatesFound < maxTemplates,
    expiresAt: Date.now() + ttlMs,
    relativePaths: sorted,
  };

  return sorted;
}

async function collectLatteTemplates(
  context: NetteTemplateScanContext,
  directory: string,
  into: Set<string>,
  depth: number,
  scanState: TemplateScanState,
): Promise<void> {
  const {
    deps,
    isRequestedRootActive,
    maxDepth,
    maxTemplates,
    requestedRoot,
  } = context;

  if (depth > maxDepth) {
    scanState.depthLimitHit = true;
    return;
  }

  if (scanState.templatesFound >= maxTemplates) {
    return;
  }

  if (scanState.visitedDirectories.has(directory)) {
    return;
  }

  scanState.visitedDirectories.add(directory);

  let entries: LatteDirectoryEntry[];

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

    if (scanState.templatesFound >= maxTemplates) {
      return;
    }

    if (entry.kind === "directory") {
      if (isLatteScanSkippedDirectory(entry.path)) {
        continue;
      }

      await collectLatteTemplates(context, entry.path, into, depth + 1, scanState);
      continue;
    }

    if (!entry.path.endsWith(LATTE_TEMPLATE_EXTENSION)) {
      continue;
    }

    into.add(deps.toRelativePath(requestedRoot, entry.path));
    scanState.templatesFound += 1;
  }
}
