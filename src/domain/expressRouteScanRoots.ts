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

export function expressRouteScanRoots({
  packageJsonDirs,
  relativeFilePaths,
}: {
  readonly packageJsonDirs: readonly ExpressRoutePackageJsonDir[];
  readonly relativeFilePaths: readonly string[];
}): ExpressRouteScanRootsResult {
  const roots = normalizedPackageRoots(packageJsonDirs);
  return {
    files: relativeFilePaths.map((relativeFilePath) => ({
      relativeFilePath,
      packageLabel: nearestPackageLabel(relativeFilePath, roots.accepted),
    })),
    truncated: roots.truncated,
  };
}

function normalizedPackageRoots(packageJsonDirs: readonly ExpressRoutePackageJsonDir[]): {
  readonly accepted: readonly NormalizedPackageRoot[];
  readonly truncated: boolean;
} {
  const rootsByDir = new Map<string, NormalizedPackageRoot>();
  for (const candidate of packageJsonDirs) {
    const relativeDirPath = normalizeRelativeDirPath(candidate.relativeDirPath);
    const packageLabel = normalizePackageName(candidate.packageName);
    if (!relativeDirPath || packageLabel === undefined) continue;
    rootsByDir.set(relativeDirPath, { packageLabel, relativeDirPath });
  }
  const roots = [...rootsByDir.values()].sort((left, right) =>
    compareText(left.relativeDirPath, right.relativeDirPath),
  );
  return {
    accepted: roots.slice(0, MAX_ROOTS),
    truncated: roots.length > MAX_ROOTS,
  };
}

interface NormalizedPackageRoot {
  readonly packageLabel: string;
  readonly relativeDirPath: string;
}

function nearestPackageLabel(
  relativeFilePath: string,
  roots: readonly NormalizedPackageRoot[],
): string | undefined {
  let nearest: NormalizedPackageRoot | undefined;
  for (const root of roots) {
    if (!root.relativeDirPath) continue;
    if (
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
