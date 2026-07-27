import { workspaceRelativePath } from "./workspace";
import type { WorkspacePackageManifestInput } from "./workspacePackageGraph";

export const NO_PROBLEMS_PACKAGE_KEY = ":no-package";
export const LOADING_PROBLEMS_PACKAGE_KEY = ":package-loading";
export const UNKNOWN_PROBLEMS_PACKAGE_KEY = ":package-unknown";

export interface ProblemsPackageIdentity {
  readonly key: string;
  readonly kind: "package" | "none";
  readonly label: string;
  readonly relativeDirPath: string | null;
}

export const NO_PROBLEMS_PACKAGE: ProblemsPackageIdentity = Object.freeze({
  key: NO_PROBLEMS_PACKAGE_KEY,
  kind: "none",
  label: "No package",
  relativeDirPath: null,
});

export const UNKNOWN_PROBLEMS_PACKAGE: ProblemsPackageIdentity = Object.freeze({
  key: UNKNOWN_PROBLEMS_PACKAGE_KEY,
  kind: "none",
  label: "Package unknown (workspace scan bounded)",
  relativeDirPath: null,
});

export const LOADING_PROBLEMS_PACKAGE: ProblemsPackageIdentity = Object.freeze({
  key: LOADING_PROBLEMS_PACKAGE_KEY,
  kind: "none",
  label: "Package pending (workspace scan loading)",
  relativeDirPath: null,
});

export interface ProblemsPackageAttribution {
  readonly identities: readonly ProblemsPackageIdentity[];
  packageForPath(path: string): ProblemsPackageIdentity;
}

interface PackageDirectoryNode {
  readonly children: Map<string, PackageDirectoryNode>;
  incomplete?: boolean;
  identity?: ProblemsPackageIdentity;
}

export function createProblemsPackageAttribution({
  filePaths,
  incompleteDirectories = [],
  packageManifests,
  unscopedFallbackIdentity,
  unscopedAuthorityUncertain = false,
  workspaceRoot,
}: {
  readonly filePaths: readonly string[];
  readonly incompleteDirectories?: readonly string[];
  readonly packageManifests: readonly WorkspacePackageManifestInput[];
  readonly unscopedFallbackIdentity?: ProblemsPackageIdentity;
  readonly unscopedAuthorityUncertain?: boolean;
  readonly workspaceRoot: string | null;
}): ProblemsPackageAttribution {
  const root = packageDirectoryIndex(packageManifests, incompleteDirectories);
  const fallbackIdentity =
    unscopedFallbackIdentity ??
    (unscopedAuthorityUncertain ? UNKNOWN_PROBLEMS_PACKAGE : NO_PROBLEMS_PACKAGE);
  const byPath = new Map<string, ProblemsPackageIdentity>();
  const identities = new Map<string, ProblemsPackageIdentity>();

  for (const path of filePaths) {
    const identity = packageForFilePath(path, workspaceRoot, root, fallbackIdentity);
    byPath.set(path, identity);
    identities.set(identity.key, identity);
  }

  return {
    identities: [...identities.values()].sort(comparePackageIdentities),
    packageForPath: (path) => byPath.get(path) ?? fallbackIdentity,
  };
}

function packageDirectoryIndex(
  packageManifests: readonly WorkspacePackageManifestInput[],
  incompleteDirectories: readonly string[],
): PackageDirectoryNode {
  const root: PackageDirectoryNode = { children: new Map() };
  const packages = packageManifests.flatMap(({ packageJson, relativeDirPath }) => {
    const name = packageManifestName(packageJson);
    return name ? [{ name, relativeDirPath }] : [];
  });
  const duplicateNames = duplicatePackageNames(packages);

  for (const workspacePackage of packages) {
    if (duplicateNames.has(workspacePackage.name)) {
      continue;
    }

    const segments = relativePathSegments(workspacePackage.relativeDirPath);
    if (!segments) {
      continue;
    }

    let node = root;
    for (const segment of segments) {
      const child = node.children.get(segment) ?? { children: new Map() };
      node.children.set(segment, child);
      node = child;
    }

    node.identity = {
      key: workspacePackage.name,
      kind: "package",
      label: workspacePackage.name,
      relativeDirPath: workspacePackage.relativeDirPath,
    };
  }

  for (const relativeDirPath of incompleteDirectories) {
    const segments = relativePathSegments(relativeDirPath);
    if (!segments) {
      continue;
    }

    let node = root;
    for (const segment of segments) {
      const child = node.children.get(segment) ?? { children: new Map() };
      node.children.set(segment, child);
      node = child;
    }
    node.incomplete = true;
  }

  return root;
}

function packageManifestName(packageJson: unknown): string | null {
  if (!packageJson || typeof packageJson !== "object" || Array.isArray(packageJson)) {
    return null;
  }
  const name = (packageJson as Record<string, unknown>).name;
  if (typeof name !== "string" || name.length === 0 || name.length > 214) {
    return null;
  }
  if (
    name === NO_PROBLEMS_PACKAGE_KEY ||
    name === LOADING_PROBLEMS_PACKAGE_KEY ||
    name === UNKNOWN_PROBLEMS_PACKAGE_KEY
  ) {
    return null;
  }
  return name;
}

function duplicatePackageNames(
  packages: readonly { readonly name: string; readonly relativeDirPath: string }[],
): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const workspacePackage of packages) {
    if (seen.has(workspacePackage.name)) {
      duplicates.add(workspacePackage.name);
      continue;
    }

    seen.add(workspacePackage.name);
  }

  return duplicates;
}

function packageForFilePath(
  path: string,
  workspaceRoot: string | null,
  root: PackageDirectoryNode,
  fallbackIdentity: ProblemsPackageIdentity,
): ProblemsPackageIdentity {
  if (!workspaceRoot) {
    return fallbackIdentity;
  }

  const relativePath = workspaceRelativePath(workspaceRoot, path);
  if (!relativePath) {
    return fallbackIdentity;
  }

  const segments = relativePathSegments(relativePath);
  if (!segments) {
    return fallbackIdentity;
  }

  let identity = root.incomplete ? UNKNOWN_PROBLEMS_PACKAGE : fallbackIdentity;
  identity = root.identity ?? identity;
  let node = root;

  for (const segment of segments) {
    const child = node.children.get(segment);
    if (!child) {
      return identity;
    }

    node = child;
    if (node.incomplete) {
      identity = UNKNOWN_PROBLEMS_PACKAGE;
    }
    identity = node.identity ?? identity;
  }

  return identity;
}

function relativePathSegments(path: string): readonly string[] | null {
  const normalized = path
    .split("\\")
    .join("/")
    .replace(/^\.\/+/u, "")
    .replace(/\/+$/u, "");
  if (!normalized) {
    return [];
  }

  const segments = normalized.split("/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }

  return segments;
}

function comparePackageIdentities(
  left: ProblemsPackageIdentity,
  right: ProblemsPackageIdentity,
): number {
  if (left.kind !== right.kind) {
    return left.kind === "package" ? -1 : 1;
  }

  return left.label.localeCompare(right.label);
}
