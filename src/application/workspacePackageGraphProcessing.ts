import {
  createWorkspacePackageGraph,
  MAX_WORKSPACE_PACKAGES,
  type WorkspacePackage,
  type WorkspacePackageManifestInput,
} from "../domain/workspacePackageGraph";

export const WORKSPACE_PACKAGE_PROCESSING_LIMITS = {
  maxDurationMs: 2_000,
  maxManifestBytesPerSlice: 256 * 1024,
  maxManifestsPerSlice: 8,
  maxSliceMs: 4,
} as const;

export interface WorkspacePackageManifestSource {
  readonly relativeDirPath: string;
  readonly source: string;
  readonly utf8Bytes: number;
}

export interface WorkspacePackageProcessingRuntime {
  now(): number;
  yieldToMainThread(signal: AbortSignal): Promise<void>;
}

export interface WorkspacePackageProcessingResult {
  readonly incompleteDirectories: readonly string[];
  readonly manifests: readonly WorkspacePackageManifestInput[];
  readonly packageJsonDirs: readonly {
    readonly packageName: string | undefined;
    readonly relativeDirPath: string;
  }[];
  readonly packages: readonly WorkspacePackage[];
  readonly rootPackageJson: unknown;
  readonly timedOut: boolean;
  readonly truncated: boolean;
}

export async function processWorkspacePackageGraph(
  {
    authorityComplete,
    manifestSources,
    pnpmWorkspaceYaml,
  }: {
    readonly authorityComplete: boolean;
    readonly manifestSources: readonly WorkspacePackageManifestSource[];
    readonly pnpmWorkspaceYaml: string | undefined;
  },
  signal: AbortSignal,
  runtime: WorkspacePackageProcessingRuntime = DEFAULT_PROCESSING_RUNTIME,
): Promise<WorkspacePackageProcessingResult> {
  if (manifestSources.length > MAX_WORKSPACE_PACKAGES) {
    return boundedResult(
      manifestSources
        .slice(0, MAX_WORKSPACE_PACKAGES)
        .map(({ relativeDirPath }) => relativeDirPath),
    );
  }
  const startedAt = runtime.now();
  let sliceStartedAt = startedAt;
  let sliceBytes = 0;
  let sliceManifests = 0;
  const incompleteDirectories = new Set<string>();
  const manifests: WorkspacePackageManifestInput[] = [];
  const packageJsonDirs: WorkspacePackageProcessingResult["packageJsonDirs"][number][] = [];

  for (let index = 0; index < manifestSources.length; index += 1) {
    throwIfAborted(signal);
    if (runtime.now() - startedAt >= WORKSPACE_PACKAGE_PROCESSING_LIMITS.maxDurationMs) {
      for (let remaining = index; remaining < manifestSources.length; remaining += 1) {
        const source = manifestSources[remaining];
        if (source) incompleteDirectories.add(source.relativeDirPath);
      }
      return partialResult(manifests, packageJsonDirs, incompleteDirectories);
    }

    const input = manifestSources[index];
    if (!input) continue;
    if (
      !Number.isSafeInteger(input.utf8Bytes) ||
      input.utf8Bytes < 0 ||
      input.utf8Bytes > WORKSPACE_PACKAGE_PROCESSING_LIMITS.maxManifestBytesPerSlice ||
      input.source.length > WORKSPACE_PACKAGE_PROCESSING_LIMITS.maxManifestBytesPerSlice
    ) {
      incompleteDirectories.add(input.relativeDirPath);
      continue;
    }
    const measuredBytes = new TextEncoder().encode(input.source).length;
    if (measuredBytes !== input.utf8Bytes) {
      incompleteDirectories.add(input.relativeDirPath);
      continue;
    }
    if (
      sliceManifests > 0 &&
      (sliceBytes + input.utf8Bytes >
        WORKSPACE_PACKAGE_PROCESSING_LIMITS.maxManifestBytesPerSlice ||
        sliceManifests >= WORKSPACE_PACKAGE_PROCESSING_LIMITS.maxManifestsPerSlice ||
        runtime.now() - sliceStartedAt >= WORKSPACE_PACKAGE_PROCESSING_LIMITS.maxSliceMs)
    ) {
      await runtime.yieldToMainThread(signal);
      throwIfAborted(signal);
      if (runtime.now() - startedAt >= WORKSPACE_PACKAGE_PROCESSING_LIMITS.maxDurationMs) {
        for (let remaining = index; remaining < manifestSources.length; remaining += 1) {
          const source = manifestSources[remaining];
          if (source) incompleteDirectories.add(source.relativeDirPath);
        }
        return partialResult(manifests, packageJsonDirs, incompleteDirectories);
      }
      sliceStartedAt = runtime.now();
      sliceBytes = 0;
      sliceManifests = 0;
    }

    const packageJson = parseManifest(input.source);
    if (!packageJson) {
      incompleteDirectories.add(input.relativeDirPath);
    } else {
      manifests.push({ packageJson, relativeDirPath: input.relativeDirPath });
      packageJsonDirs.push({
        packageName: typeof packageJson.name === "string" ? packageJson.name : undefined,
        relativeDirPath: input.relativeDirPath,
      });
    }
    sliceBytes += input.utf8Bytes;
    sliceManifests += 1;

    const hasMore = index + 1 < manifestSources.length;
    if (
      hasMore &&
      (sliceBytes === WORKSPACE_PACKAGE_PROCESSING_LIMITS.maxManifestBytesPerSlice ||
        sliceManifests >= WORKSPACE_PACKAGE_PROCESSING_LIMITS.maxManifestsPerSlice ||
        runtime.now() - sliceStartedAt >= WORKSPACE_PACKAGE_PROCESSING_LIMITS.maxSliceMs)
    ) {
      await runtime.yieldToMainThread(signal);
      throwIfAborted(signal);
      sliceStartedAt = runtime.now();
      sliceBytes = 0;
      sliceManifests = 0;
    }
  }

  // Graph matching is bounded independently, but still starts in a fresh task
  // after manifest parsing so the two CPU-heavy phases never share one UI turn.
  if (manifestSources.length > 0) {
    await runtime.yieldToMainThread(signal);
    throwIfAborted(signal);
  }
  if (runtime.now() - startedAt >= WORKSPACE_PACKAGE_PROCESSING_LIMITS.maxDurationMs) {
    return partialResult(manifests, packageJsonDirs, incompleteDirectories);
  }

  const rootPackageJson =
    manifests.find(({ relativeDirPath }) => relativeDirPath === "")?.packageJson ?? {};
  const graph = createWorkspacePackageGraph({
    authorityComplete: authorityComplete && incompleteDirectories.size === 0,
    packageManifests: manifests,
    pnpmWorkspaceYaml,
    rootPackageJson,
    sourceFilePaths: [],
  });
  await runtime.yieldToMainThread(signal);
  throwIfAborted(signal);
  if (runtime.now() - startedAt >= WORKSPACE_PACKAGE_PROCESSING_LIMITS.maxDurationMs) {
    return partialResult(manifests, packageJsonDirs, incompleteDirectories);
  }
  return {
    incompleteDirectories: [...incompleteDirectories].sort(compareText),
    manifests,
    packageJsonDirs,
    packages: graph.packages,
    rootPackageJson,
    timedOut: false,
    truncated: graph.truncated,
  };
}

function boundedResult(incompleteDirectories: readonly string[]): WorkspacePackageProcessingResult {
  return {
    incompleteDirectories: [...new Set(incompleteDirectories)].sort(compareText),
    manifests: [],
    packageJsonDirs: [],
    packages: [],
    rootPackageJson: {},
    timedOut: false,
    truncated: true,
  };
}

function partialResult(
  manifests: readonly WorkspacePackageManifestInput[],
  packageJsonDirs: WorkspacePackageProcessingResult["packageJsonDirs"],
  incompleteDirectories: ReadonlySet<string>,
): WorkspacePackageProcessingResult {
  return {
    incompleteDirectories: [...incompleteDirectories].sort(compareText),
    manifests,
    packageJsonDirs,
    packages: [],
    rootPackageJson:
      manifests.find(({ relativeDirPath }) => relativeDirPath === "")?.packageJson ?? {},
    timedOut: true,
    truncated: true,
  };
}

function parseManifest(source: string): Readonly<Record<string, unknown>> | null {
  try {
    const parsed: unknown = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Readonly<Record<string, unknown>>;
  } catch {
    return null;
  }
}

const DEFAULT_PROCESSING_RUNTIME: WorkspacePackageProcessingRuntime = {
  now: () => performance.now(),
  yieldToMainThread: async (signal) => {
    throwIfAborted(signal);
    const scheduler = (
      globalThis as typeof globalThis & {
        readonly scheduler?: { yield?: () => Promise<void> };
      }
    ).scheduler;
    if (scheduler?.yield) {
      await scheduler.yield();
      return;
    }
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
  },
};

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Workspace package processing was cancelled.", "AbortError");
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
