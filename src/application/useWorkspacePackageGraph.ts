import { useEffect, useMemo, useRef, useState } from "react";
import type { ExpressRoutePackageJsonDir } from "../domain/expressRouteScanRoots";
import type { WorkspaceSourceDiscoveryGateway } from "../domain/workspaceSourceDiscovery";
import {
  createWorkspacePackageGraph,
  MAX_WORKSPACE_PACKAGES,
  type WorkspacePackage,
  type WorkspacePackageManifestInput,
} from "../domain/workspacePackageGraph";
import {
  createWorkspacePackagePathLookup,
  type WorkspacePackagePathAnswer,
} from "../domain/workspacePackageForPath";

export const WORKSPACE_PACKAGE_DISCOVERY_LIMITS = {
  maxFiles: 256,
  maxVisited: 50_000,
} as const;
export const MAX_WORKSPACE_PACKAGE_MANIFEST_BYTES = 256 * 1024;
export const MAX_TOTAL_WORKSPACE_PACKAGE_MANIFEST_BYTES = 16 * 1024 * 1024;
export const MAX_PNPM_WORKSPACE_MANIFEST_BYTES = 256 * 1024;
export const PACKAGE_DISCOVERY_INVALIDATION_DEBOUNCE_MS = 75;

const READ_CONCURRENCY = 8;

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

    const discover = async () => {
      const enumeration = await enumeratePackageJsonFiles(gateway, rootPath);
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

      const pnpmWorkspaceRead = readPnpmWorkspaceSource(gateway, rootPath, isCurrent);
      const manifestRead = await readPackageManifests(gateway, rootPath, candidates, isCurrent);
      if (!manifestRead || !isCurrent()) return;
      const pnpmWorkspace = await pnpmWorkspaceRead;
      if (!pnpmWorkspace || !isCurrent()) return;

      const authorityComplete = !manifestRead.bounded && !pnpmWorkspace.bounded;
      const graph = createWorkspacePackageGraph({
        authorityComplete,
        packageManifests: manifestRead.manifests,
        pnpmWorkspaceYaml: pnpmWorkspace.source,
        rootPackageJson:
          manifestRead.manifests.find(({ relativeDirPath }) => relativeDirPath === "")
            ?.packageJson ?? {},
        sourceFilePaths: [],
      });
      if (!isCurrent()) return;
      const authority = graph.truncated || !authorityComplete ? "bounded" : "complete";
      setStoredDiscovery({
        discoveryVersion,
        value: {
          authority,
          authorityDirectories: manifestRead.authorityDirectories,
          incompleteDirectories: manifestRead.incompleteDirectories,
          loaded: true,
          ownerKey,
          packageJsonDirs: manifestRead.packageJsonDirs,
          packageManifests: manifestRead.manifests,
          packages: graph.packages,
          pnpmWorkspaceYaml: pnpmWorkspace.source,
          rootPackageJson:
            manifestRead.manifests.find(({ relativeDirPath }) => relativeDirPath === "")
              ?.packageJson ?? {},
          unscopedAuthorityUncertain: manifestRead.unscopedAuthorityUncertain,
        },
      });
    };

    const delay = previousOwnerKey === ownerKey ? PACKAGE_DISCOVERY_INVALIDATION_DEBOUNCE_MS : 0;
    const startDiscovery = () => {
      void discover().catch(() => {
        if (!isCurrent()) return;
        setStoredDiscovery({ discoveryVersion, value: boundedDiscovery(ownerKey) });
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
      if (sequenceRef.current === sequence) sequenceRef.current += 1;
    };
  }, [discoveryVersion, gateway, ownerKey, rootPath]);

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
): Promise<{ readonly files: readonly string[]; readonly truncated: boolean }> {
  if (!gateway.enumeratePackageJsonFiles) {
    return { files: [], truncated: true };
  }
  try {
    return await gateway.enumeratePackageJsonFiles(rootPath, WORKSPACE_PACKAGE_DISCOVERY_LIMITS);
  } catch {
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
  readonly manifests: readonly WorkspacePackageManifestInput[];
  readonly packageJsonDirs: readonly ExpressRoutePackageJsonDir[];
  readonly unscopedAuthorityUncertain: boolean;
}

async function readPackageManifests(
  gateway: WorkspaceSourceDiscoveryGateway,
  rootPath: string,
  candidates: readonly PackageManifestCandidate[],
  isCurrent: () => boolean,
): Promise<PackageManifestRead | null> {
  const authorityDirectories = new Set<string>();
  const incompleteDirectories = new Set<string>();
  const manifests: WorkspacePackageManifestInput[] = [];
  const packageJsonDirs: ExpressRoutePackageJsonDir[] = [];
  let totalBytes = 0;
  let bounded = false;

  for (const candidate of candidates) {
    if (candidate.relativeDirPath) authorityDirectories.add(candidate.relativeDirPath);
  }

  for (let start = 0; start < candidates.length; start += READ_CONCURRENCY) {
    const batch = candidates.slice(start, start + READ_CONCURRENCY);
    const reads = await Promise.all(
      batch.map(({ relativePath }) =>
        readManifestSource(gateway, rootPath, relativePath, isCurrent),
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
      const bytes = utf8Bytes(source);
      if (
        bytes > MAX_WORKSPACE_PACKAGE_MANIFEST_BYTES ||
        totalBytes + bytes > MAX_TOTAL_WORKSPACE_PACKAGE_MANIFEST_BYTES
      ) {
        bounded = true;
        incompleteDirectories.add(candidate.relativeDirPath);
        continue;
      }
      const packageJson = parseManifest(source);
      if (!packageJson) {
        bounded = true;
        incompleteDirectories.add(candidate.relativeDirPath);
        continue;
      }
      totalBytes += bytes;
      manifests.push({ packageJson, relativeDirPath: candidate.relativeDirPath });
      packageJsonDirs.push({
        packageName: typeof packageJson.name === "string" ? packageJson.name : undefined,
        relativeDirPath: candidate.relativeDirPath,
      });
    }
  }

  return {
    authorityDirectories: [...authorityDirectories].sort(compareText),
    bounded,
    incompleteDirectories: [...incompleteDirectories].sort(compareText),
    manifests,
    packageJsonDirs,
    unscopedAuthorityUncertain: incompleteDirectories.has(""),
  };
}

async function readManifestSource(
  gateway: WorkspaceSourceDiscoveryGateway,
  rootPath: string,
  relativePath: string,
  isCurrent: () => boolean,
): Promise<string | null> {
  try {
    let read = await gateway.readSourceTextBounded(
      rootPath,
      relativePath,
      MAX_WORKSPACE_PACKAGE_MANIFEST_BYTES,
    );
    if (!isCurrent()) return null;
    if (read.status === "changed") {
      read = await gateway.readSourceTextBounded(
        rootPath,
        relativePath,
        MAX_WORKSPACE_PACKAGE_MANIFEST_BYTES,
      );
    }
    if (!isCurrent() || read.status !== "ok") return null;
    return read.content;
  } catch {
    return null;
  }
}

async function readPnpmWorkspaceSource(
  gateway: WorkspaceSourceDiscoveryGateway,
  rootPath: string,
  isCurrent: () => boolean,
): Promise<{ readonly bounded: boolean; readonly source: string | undefined } | null> {
  try {
    let read = await gateway.readSourceTextBounded(
      rootPath,
      "pnpm-workspace.yaml",
      MAX_PNPM_WORKSPACE_MANIFEST_BYTES,
    );
    if (!isCurrent()) return null;
    if (read.status === "changed") {
      read = await gateway.readSourceTextBounded(
        rootPath,
        "pnpm-workspace.yaml",
        MAX_PNPM_WORKSPACE_MANIFEST_BYTES,
      );
    }
    if (!isCurrent()) return null;
    if (read.status === "notFound") return { bounded: false, source: undefined };
    if (read.status !== "ok") return { bounded: true, source: undefined };
    return { bounded: false, source: read.content };
  } catch {
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

function parseManifest(source: string): Readonly<Record<string, unknown>> | null {
  try {
    const parsed: unknown = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Readonly<Record<string, unknown>>;
  } catch {
    return null;
  }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
