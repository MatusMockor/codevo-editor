export const MAX_ROOTS = 256;

const MAX_PACKAGE_NAME_LENGTH = 214;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u;

export interface ExpressRoutePackageJsonDir {
  readonly packageName: unknown;
  readonly relativeDirPath: string;
}

export interface ExpressRouteScanRootFile {
  readonly packageLabel?: string;
  readonly relativeFilePath: string;
}

export interface ExpressRouteScanRootsResult {
  readonly files: readonly ExpressRouteScanRootFile[];
  readonly truncated: boolean;
}

export interface ExpressRoutePackageRoot {
  readonly packageLabel: string;
  readonly relativeDirPath: string;
}

export interface ExpressRoutePackageRootsResult {
  readonly roots: readonly ExpressRoutePackageRoot[];
  readonly truncated: boolean;
}

export function expressRouteScanRoots({
  packageJsonDirs,
  relativeFilePaths,
}: {
  readonly packageJsonDirs: readonly ExpressRoutePackageJsonDir[];
  readonly relativeFilePaths: readonly string[];
}): ExpressRouteScanRootsResult {
  const { roots, truncated } = expressRoutePackageRoots(packageJsonDirs);
  return {
    files: relativeFilePaths.map((relativeFilePath) => ({
      relativeFilePath,
      packageLabel: nearestPackageLabel(relativeFilePath, roots),
    })),
    truncated,
  };
}

export function expressRoutePackageRoots(
  packageJsonDirs: readonly ExpressRoutePackageJsonDir[],
): ExpressRoutePackageRootsResult {
  const rootsByDir = new Map<string, ExpressRoutePackageRoot>();
  for (const candidate of packageJsonDirs) {
    const relativeDirPath = normalizeRelativeDirPath(candidate.relativeDirPath);
    const packageLabel = normalizePackageName(candidate.packageName);
    if (relativeDirPath === null || packageLabel === undefined) continue;
    rootsByDir.set(relativeDirPath, { packageLabel, relativeDirPath });
  }
  const root = rootsByDir.get("");
  rootsByDir.delete("");
  const nestedRoots = [...rootsByDir.values()].sort((left, right) =>
    compareText(left.relativeDirPath, right.relativeDirPath),
  );
  return {
    roots: [...(root ? [root] : []), ...nestedRoots.slice(0, MAX_ROOTS)],
    truncated: nestedRoots.length > MAX_ROOTS,
  };
}

function nearestPackageLabel(
  relativeFilePath: string,
  roots: readonly ExpressRoutePackageRoot[],
): string | undefined {
  let nearest: ExpressRoutePackageRoot | undefined;
  for (const root of roots) {
    if (
      root.relativeDirPath &&
      relativeFilePath !== root.relativeDirPath &&
      !relativeFilePath.startsWith(`${root.relativeDirPath}/`)
    ) {
      continue;
    }
    if (!nearest || root.relativeDirPath.length > nearest.relativeDirPath.length) nearest = root;
  }
  return nearest?.packageLabel;
}

function normalizeRelativeDirPath(value: string): string | null {
  const normalized = value.split("\\").join("/").replace(/\/+$/u, "");
  if (!normalized) return "";
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  return normalized;
}

function normalizePackageName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value || value !== value.trim() || value.length > MAX_PACKAGE_NAME_LENGTH) return undefined;
  if (!PACKAGE_NAME_PATTERN.test(value)) return undefined;
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
