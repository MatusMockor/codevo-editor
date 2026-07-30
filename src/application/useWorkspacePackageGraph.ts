import { useEffect, useMemo, useRef, useState } from "react";
import type { ExpressRoutePackageJsonDir } from "../domain/expressRouteScanRoots";
import type { WorkspaceSourceDiscoveryGateway } from "../domain/workspaceSourceDiscovery";
import {
  MAX_WORKSPACE_PACKAGES,
  type WorkspacePackage,
  type WorkspacePackageManifestInput,
} from "../domain/workspacePackageGraph";
import {
  createWorkspacePackagePathLookup,
  type WorkspacePackagePathAnswer,
} from "../domain/workspacePackageForPath";
import {
  processWorkspacePackageGraph,
  type WorkspacePackageManifestSource,
  type WorkspacePackageProcessingRuntime,
} from "./workspacePackageGraphProcessing";
import { runWorkspacePackageDiscoveryOperation } from "./workspacePackageDiscoveryOperationQueue";

export const WORKSPACE_PACKAGE_DISCOVERY_LIMITS = {
  maxFiles: 256,
  maxVisited: 50_000,
} as const;
export const MAX_WORKSPACE_PACKAGE_MANIFEST_BYTES = 256 * 1024;
export const MAX_TOTAL_WORKSPACE_PACKAGE_MANIFEST_BYTES = 16 * 1024 * 1024;
export const MAX_PNPM_WORKSPACE_MANIFEST_BYTES = 256 * 1024;
export const PACKAGE_DISCOVERY_INVALIDATION_DEBOUNCE_MS = 75;
export const WORKSPACE_PACKAGE_DISCOVERY_DEADLINE_MS = 5_000;

const READ_CONCURRENCY = 4;

export type WorkspacePackageAuthority = "loading" | "bounded" | "complete";

interface WorkspacePackageDiscoveryState {
  readonly authority: WorkspacePackageAuthority;
  readonly authorityDirectories: readonly string[];
  readonly incompleteDirectories: readonly string[];
  readonly loaded: boolean;
  readonly ownerKey: string | null;
  readonly packageJsonDirs: readonly ExpressRoutePackageJsonDir[];
  readonly packageManifests: readonly WorkspacePackageManifestInput[];
  readonly packages: readonly WorkspacePackage[];
  readonly pnpmWorkspaceYaml: string | undefined;
  readonly rootPackageJson: unknown;
  readonly unscopedAuthorityUncertain: boolean;
}

export interface WorkspacePackageDiscovery extends WorkspacePackageDiscoveryState {
  packageForPath(path: string): WorkspacePackagePathAnswer;
}

interface UseWorkspacePackageGraphOptions {
  readonly discoveryVersion: number;
  readonly enabled: boolean;
  readonly gateway: WorkspaceSourceDiscoveryGateway;
  readonly processingRuntime?: WorkspacePackageProcessingRuntime;
  readonly rootPath: string | null;
  readonly workspaceId: string | null;
}

interface StoredWorkspacePackageDiscovery {
  readonly discoveryVersion: number | null;
  readonly value: WorkspacePackageDiscoveryState;
}

const EMPTY_DISCOVERY: WorkspacePackageDiscoveryState = {
  authority: "loading",
  authorityDirectories: [],
  incompleteDirectories: [],
  loaded: false,
  ownerKey: null,
  packageJsonDirs: [],
  packageManifests: [],
  packages: [],
  pnpmWorkspaceYaml: undefined,
  rootPackageJson: {},
  unscopedAuthorityUncertain: false,
};

function initialDiscovery(ownerKey: string | null): WorkspacePackageDiscoveryState {
  return ownerKey ? { ...EMPTY_DISCOVERY, ownerKey } : EMPTY_DISCOVERY;
}

function boundedDiscovery(ownerKey: string): WorkspacePackageDiscoveryState {
  return {
    ...EMPTY_DISCOVERY,
    authority: "bounded",
    loaded: true,
    ownerKey,
    unscopedAuthorityUncertain: true,
  };
}

export function useWorkspacePackageGraph({
  discoveryVersion,
  enabled,
  gateway,
  processingRuntime,
  rootPath,
  workspaceId,
}: UseWorkspacePackageGraphOptions): WorkspacePackageDiscovery {
  const ownerKey = enabled && rootPath && workspaceId ? `${workspaceId}\u0000${rootPath}` : null;
  const ownerRef = useRef<string | null>(null);
  const sequenceRef = useRef(0);
  const [storedDiscovery, setStoredDiscovery] = useState<StoredWorkspacePackageDiscovery>({
    discoveryVersion: null,
    value: EMPTY_DISCOVERY,
  });

  useEffect(() => {
    const previousOwnerKey = ownerRef.current;
    ownerRef.current = ownerKey;
    sequenceRef.current += 1;
    const sequence = sequenceRef.current;
    if (!ownerKey || !rootPath) {
      setStoredDiscovery({ discoveryVersion: null, value: EMPTY_DISCOVERY });
      return;
    }

    const isCurrent = () => ownerRef.current === ownerKey && sequenceRef.current === sequence;
    setStoredDiscovery((current) =>
      current.discoveryVersion === discoveryVersion && current.value.ownerKey === ownerKey
        ? current
        : { discoveryVersion, value: initialDiscovery(ownerKey) },
    );

    const discover = async (signal: AbortSignal) => {
      const enumeration = await enumeratePackageJsonFiles(gateway, rootPath, signal);
      if (!isCurrent()) return;
      if (enumeration.truncated || enumeration.files.length > MAX_WORKSPACE_PACKAGES) {
        setStoredDiscovery({ discoveryVersion, value: boundedDiscovery(ownerKey) });
        return;
      }

      const candidates = packageManifestCandidates(enumeration.files);
      if (!candidates) {
        setStoredDiscovery({ discoveryVersion, value: boundedDiscovery(ownerKey) });
        return;
      }

      const pnpmWorkspaceRead = readPnpmWorkspaceSource(gateway, rootPath, isCurrent, signal);
      const manifestRead = await readPackageManifests(
        gateway,
        rootPath,
        candidates,
        isCurrent,
        signal,
      );
      if (!manifestRead || !isCurrent()) return;
      const pnpmWorkspace = await pnpmWorkspaceRead;
      if (!pnpmWorkspace || !isCurrent()) return;

      const authorityComplete = !manifestRead.bounded && !pnpmWorkspace.bounded;
      const processing = await processWorkspacePackageGraph(
        {
          authorityComplete,
          manifestSources: manifestRead.manifestSources,
          pnpmWorkspaceYaml: pnpmWorkspace.source,
        },
        signal,
        processingRuntime,
      );
      if (!isCurrent()) return;
      const incompleteDirectories = [
        ...new Set([...manifestRead.incompleteDirectories, ...processing.incompleteDirectories]),
      ].sort(compareText);
      const processingBounded =
        processing.timedOut || processing.truncated || processing.incompleteDirectories.length > 0;
      const authority = processingBounded || !authorityComplete ? "bounded" : "complete";
      setStoredDiscovery({
        discoveryVersion,
        value: {
          authority,
          authorityDirectories: manifestRead.authorityDirectories,
          incompleteDirectories,
          loaded: true,
          ownerKey,
          packageJsonDirs: processing.packageJsonDirs,
          packageManifests: processing.manifests,
          packages: processing.packages,
          pnpmWorkspaceYaml: pnpmWorkspace.source,
          rootPackageJson: processing.rootPackageJson,
          unscopedAuthorityUncertain:
            manifestRead.unscopedAuthorityUncertain || incompleteDirectories.includes(""),
        },
      });
    };

    let controller: AbortController | null = null;
    let deadlineTimer: number | null = null;
    const delay = previousOwnerKey === ownerKey ? PACKAGE_DISCOVERY_INVALIDATION_DEBOUNCE_MS : 0;
    const startDiscovery = () => {
      controller = new AbortController();
      deadlineTimer = window.setTimeout(
        () => controller?.abort(),
        WORKSPACE_PACKAGE_DISCOVERY_DEADLINE_MS,
      );
      void discover(controller.signal)
        .catch(() => {
          if (!isCurrent()) return;
          setStoredDiscovery({ discoveryVersion, value: boundedDiscovery(ownerKey) });
        })
        .finally(() => {
          if (deadlineTimer !== null) {
            window.clearTimeout(deadlineTimer);
            deadlineTimer = null;
          }
        });
    };
    const timer = delay > 0 ? window.setTimeout(startDiscovery, delay) : null;
    if (timer === null) {
      startDiscovery();
    }

    return () => {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      if (deadlineTimer !== null) {
        window.clearTimeout(deadlineTimer);
      }
      controller?.abort();
      if (sequenceRef.current === sequence) sequenceRef.current += 1;
    };
  }, [discoveryVersion, gateway, ownerKey, processingRuntime, rootPath]);

  const ownedDiscovery =
    storedDiscovery.discoveryVersion === discoveryVersion &&
    storedDiscovery.value.ownerKey === ownerKey
      ? storedDiscovery.value
      : initialDiscovery(ownerKey);
  const pathLookup = useMemo(
    () =>
      createWorkspacePackagePathLookup({
        authority: ownedDiscovery.authority,
        incompleteDirectories: ownedDiscovery.incompleteDirectories,
        packageManifests: ownedDiscovery.packageManifests,
        unscopedAuthorityUncertain: ownedDiscovery.unscopedAuthorityUncertain,
        workspaceRoot: rootPath,
      }),
    [
      ownedDiscovery.authority,
      ownedDiscovery.incompleteDirectories,
      ownedDiscovery.packageManifests,
      ownedDiscovery.unscopedAuthorityUncertain,
      rootPath,
    ],
  );
  return useMemo(
    () => ({ ...ownedDiscovery, packageForPath: pathLookup.packageForPath }),
    [ownedDiscovery, pathLookup.packageForPath],
  );
}

async function enumeratePackageJsonFiles(
  gateway: WorkspaceSourceDiscoveryGateway,
  rootPath: string,
  signal: AbortSignal,
): Promise<{ readonly files: readonly string[]; readonly truncated: boolean }> {
  if (!gateway.enumeratePackageJsonFiles) {
    return { files: [], truncated: true };
  }
  try {
    return await runWorkspacePackageDiscoveryOperation(gateway, signal, () =>
      gateway.enumeratePackageJsonFiles!(rootPath, WORKSPACE_PACKAGE_DISCOVERY_LIMITS),
    );
  } catch {
    if (signal.aborted) throw abortError();
    return { files: [], truncated: true };
  }
}

interface PackageManifestCandidate {
  readonly relativeDirPath: string;
  readonly relativePath: string;
}

function packageManifestCandidates(
  relativePaths: readonly string[],
): readonly PackageManifestCandidate[] | null {
  const candidates: PackageManifestCandidate[] = [];
  const seen = new Set<string>();
  for (const relativePath of relativePaths) {
    if (seen.has(relativePath)) continue;
    seen.add(relativePath);
    const relativeDirPath = packageJsonDirPath(relativePath);
    if (relativeDirPath === null) return null;
    candidates.push({ relativeDirPath, relativePath });
  }
  return candidates;
}

interface PackageManifestRead {
  readonly authorityDirectories: readonly string[];
  readonly bounded: boolean;
  readonly incompleteDirectories: readonly string[];
  readonly manifestSources: readonly WorkspacePackageManifestSource[];
  readonly unscopedAuthorityUncertain: boolean;
}

async function readPackageManifests(
  gateway: WorkspaceSourceDiscoveryGateway,
  rootPath: string,
  candidates: readonly PackageManifestCandidate[],
  isCurrent: () => boolean,
  signal: AbortSignal,
): Promise<PackageManifestRead | null> {
  const authorityDirectories = new Set<string>();
  const incompleteDirectories = new Set<string>();
  const manifestSources: WorkspacePackageManifestSource[] = [];
  let totalBytes = 0;
  let bounded = false;

  for (const candidate of candidates) {
    if (candidate.relativeDirPath) authorityDirectories.add(candidate.relativeDirPath);
  }

  for (let start = 0; start < candidates.length; start += READ_CONCURRENCY) {
    const batch = candidates.slice(start, start + READ_CONCURRENCY);
    const reads = await Promise.all(
      batch.map(({ relativePath }) =>
        readManifestSource(gateway, rootPath, relativePath, isCurrent, signal),
      ),
    );
    if (!isCurrent()) return null;
    for (let index = 0; index < batch.length; index += 1) {
      const candidate = batch[index];
      const source = reads[index];
      if (!candidate) continue;
      if (source === null) {
        bounded = true;
        incompleteDirectories.add(candidate.relativeDirPath);
        continue;
      }
      if (source.length > MAX_WORKSPACE_PACKAGE_MANIFEST_BYTES) {
        bounded = true;
        incompleteDirectories.add(candidate.relativeDirPath);
        continue;
      }
      const bytes = utf8Bytes(source);
      if (
        bytes > MAX_WORKSPACE_PACKAGE_MANIFEST_BYTES ||
        totalBytes + bytes > MAX_TOTAL_WORKSPACE_PACKAGE_MANIFEST_BYTES
      ) {
        bounded = true;
        incompleteDirectories.add(candidate.relativeDirPath);
        continue;
      }
      totalBytes += bytes;
      manifestSources.push({
        relativeDirPath: candidate.relativeDirPath,
        source,
        utf8Bytes: bytes,
      });
    }
    if (start + READ_CONCURRENCY < candidates.length) {
      await yieldDiscoveryTurn(signal);
      if (!isCurrent()) return null;
    }
  }

  return {
    authorityDirectories: [...authorityDirectories].sort(compareText),
    bounded,
    incompleteDirectories: [...incompleteDirectories].sort(compareText),
    manifestSources,
    unscopedAuthorityUncertain: incompleteDirectories.has(""),
  };
}

async function readManifestSource(
  gateway: WorkspaceSourceDiscoveryGateway,
  rootPath: string,
  relativePath: string,
  isCurrent: () => boolean,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    let read = await runWorkspacePackageDiscoveryOperation(gateway, signal, () =>
      gateway.readSourceTextBounded(rootPath, relativePath, MAX_WORKSPACE_PACKAGE_MANIFEST_BYTES),
    );
    if (!isCurrent()) return null;
    if (read.status === "changed") {
      read = await runWorkspacePackageDiscoveryOperation(gateway, signal, () =>
        gateway.readSourceTextBounded(rootPath, relativePath, MAX_WORKSPACE_PACKAGE_MANIFEST_BYTES),
      );
    }
    if (!isCurrent() || read.status !== "ok") return null;
    return read.content;
  } catch {
    if (signal.aborted) throw abortError();
    return null;
  }
}

async function readPnpmWorkspaceSource(
  gateway: WorkspaceSourceDiscoveryGateway,
  rootPath: string,
  isCurrent: () => boolean,
  signal: AbortSignal,
): Promise<{ readonly bounded: boolean; readonly source: string | undefined } | null> {
  try {
    let read = await runWorkspacePackageDiscoveryOperation(gateway, signal, () =>
      gateway.readSourceTextBounded(
        rootPath,
        "pnpm-workspace.yaml",
        MAX_PNPM_WORKSPACE_MANIFEST_BYTES,
      ),
    );
    if (!isCurrent()) return null;
    if (read.status === "changed") {
      read = await runWorkspacePackageDiscoveryOperation(gateway, signal, () =>
        gateway.readSourceTextBounded(
          rootPath,
          "pnpm-workspace.yaml",
          MAX_PNPM_WORKSPACE_MANIFEST_BYTES,
        ),
      );
    }
    if (!isCurrent()) return null;
    if (read.status === "notFound") return { bounded: false, source: undefined };
    if (read.status !== "ok") return { bounded: true, source: undefined };
    if (
      read.content.length > MAX_PNPM_WORKSPACE_MANIFEST_BYTES ||
      utf8Bytes(read.content) > MAX_PNPM_WORKSPACE_MANIFEST_BYTES
    ) {
      return { bounded: true, source: undefined };
    }
    return { bounded: false, source: read.content };
  } catch {
    if (signal.aborted) throw abortError();
    return { bounded: true, source: undefined };
  }
}

function packageJsonDirPath(relativePath: string): string | null {
  if (relativePath === "package.json") return "";
  if (
    relativePath.length > 4_096 ||
    relativePath.includes("\\") ||
    !relativePath.endsWith("/package.json")
  ) {
    return null;
  }
  const relativeDirPath = relativePath.slice(0, -"/package.json".length);
  const segments = relativeDirPath.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    segments.includes("node_modules")
  ) {
    return null;
  }
  return relativeDirPath;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError();
  return await new Promise<T>((resolve, reject) => {
    const cancel = () => {
      signal.removeEventListener("abort", cancel);
      reject(abortError());
    };
    signal.addEventListener("abort", cancel, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", cancel);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", cancel);
        reject(error);
      },
    );
  });
}

async function yieldDiscoveryTurn(signal: AbortSignal): Promise<void> {
  await abortable(
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    }),
    signal,
  );
}

function abortError(): DOMException {
  return new DOMException("Workspace package discovery was cancelled.", "AbortError");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
