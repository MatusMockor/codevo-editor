import { workspaceRelativePath } from "./workspace";
import type { WorkspacePackageManifestInput } from "./workspacePackageGraph";

export type WorkspacePackagePathAuthority = "loading" | "bounded" | "complete";

export type WorkspacePackagePathAnswer =
  | {
      readonly kind: "package";
      readonly name: string;
      readonly relativeDirPath: string;
    }
  | { readonly kind: "no-package" }
  | { readonly kind: "loading" }
  | { readonly kind: "unknown" };

export interface WorkspacePackagePathLookup {
  readonly packages: readonly Extract<WorkspacePackagePathAnswer, { readonly kind: "package" }>[];
  packageForPath(path: string): WorkspacePackagePathAnswer;
}

interface PackageDirectoryNode {
  readonly children: Map<string, PackageDirectoryNode>;
  incomplete?: boolean;
  package?: Extract<WorkspacePackagePathAnswer, { readonly kind: "package" }>;
}

interface WorkspacePackagePathLookupOptions {
  readonly authority: WorkspacePackagePathAuthority;
  readonly excludedPackageNames?: readonly string[];
  readonly incompleteDirectories: readonly string[];
  readonly packageManifests: readonly WorkspacePackageManifestInput[];
  readonly unscopedAuthorityUncertain: boolean;
  readonly workspaceRoot: string | null;
}

const NO_PACKAGE: WorkspacePackagePathAnswer = Object.freeze({ kind: "no-package" });
const LOADING: WorkspacePackagePathAnswer = Object.freeze({ kind: "loading" });
const UNKNOWN: WorkspacePackagePathAnswer = Object.freeze({ kind: "unknown" });
const RESERVED_PACKAGE_NAMES = new Set([":no-package", ":package-loading", ":package-unknown"]);

export function createWorkspacePackagePathLookup({
  authority,
  excludedPackageNames = [],
  incompleteDirectories,
  packageManifests,
  unscopedAuthorityUncertain,
  workspaceRoot,
}: WorkspacePackagePathLookupOptions): WorkspacePackagePathLookup {
  const root: PackageDirectoryNode = { children: new Map() };
  const excludedNames = new Set([...RESERVED_PACKAGE_NAMES, ...excludedPackageNames]);
  const declaredPackages = packageManifests.flatMap(({ packageJson, relativeDirPath }) => {
    const name = packageManifestName(packageJson);
    if (!name || excludedNames.has(name)) return [];
    return [{ name, relativeDirPath }];
  });
  const duplicateNames = duplicatePackageNames(declaredPackages);
  const packages: Extract<WorkspacePackagePathAnswer, { readonly kind: "package" }>[] = [];

  for (const declaredPackage of declaredPackages) {
    if (duplicateNames.has(declaredPackage.name)) continue;
    const segments = relativePathSegments(declaredPackage.relativeDirPath);
    if (!segments) continue;
    const answer = {
      kind: "package" as const,
      name: declaredPackage.name,
      relativeDirPath: declaredPackage.relativeDirPath,
    };
    packages.push(answer);
    directoryNode(root, segments).package = answer;
  }

  for (const relativeDirPath of incompleteDirectories) {
    const segments = relativePathSegments(relativeDirPath);
    if (!segments) continue;
    directoryNode(root, segments).incomplete = true;
  }

  const fallback = fallbackAnswer(authority, unscopedAuthorityUncertain);
  return {
    packages,
    packageForPath: (path) => resolvePackageForPath(path, workspaceRoot, root, fallback),
  };
}

function packageManifestName(packageJson: unknown): string | null {
  if (!packageJson || typeof packageJson !== "object" || Array.isArray(packageJson)) return null;
  const name = (packageJson as Record<string, unknown>).name;
  if (typeof name !== "string" || name.length === 0 || name.length > 214) return null;
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

function directoryNode(
  root: PackageDirectoryNode,
  segments: readonly string[],
): PackageDirectoryNode {
  let node = root;
  for (const segment of segments) {
    const child = node.children.get(segment) ?? { children: new Map() };
    node.children.set(segment, child);
    node = child;
  }
  return node;
}

function fallbackAnswer(
  authority: WorkspacePackagePathAuthority,
  unscopedAuthorityUncertain: boolean,
): WorkspacePackagePathAnswer {
  if (authority === "loading") return LOADING;
  if (unscopedAuthorityUncertain) return UNKNOWN;
  return NO_PACKAGE;
}

function resolvePackageForPath(
  path: string,
  workspaceRoot: string | null,
  root: PackageDirectoryNode,
  fallback: WorkspacePackagePathAnswer,
): WorkspacePackagePathAnswer {
  if (!workspaceRoot) return fallback;
  const relativePath = workspaceRelativePath(workspaceRoot, path);
  if (!relativePath) return fallback;
  const segments = relativePathSegments(relativePath);
  if (!segments) return fallback;

  let answer = root.incomplete ? UNKNOWN : fallback;
  answer = root.package ?? answer;
  let node = root;

  for (const segment of segments) {
    const child = node.children.get(segment);
    if (!child) return answer;
    node = child;
    if (node.incomplete) answer = UNKNOWN;
    answer = node.package ?? answer;
  }

  return answer;
}

function relativePathSegments(path: string): readonly string[] | null {
  const normalized = path
    .split("\\")
    .join("/")
    .replace(/^\.\/+/u, "")
    .replace(/\/+$/u, "");
  if (!normalized) return [];
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
