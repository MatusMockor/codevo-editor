const MAX_MANIFEST_KEYS = 128;
const MAX_DEPENDENCY_KEYS = 4_096;
const MAX_DEPENDENCY_RANGE_LENGTH = 4_096;

export interface ExpressWorkspaceSignalInput {
  readonly manifest?: unknown;
  readonly routes: readonly unknown[];
}

export function hasExpressWorkspaceSignal({
  manifest,
  routes,
}: ExpressWorkspaceSignalInput): boolean {
  if (routes.length > 0) return true;

  try {
    if (!isRecord(manifest)) return false;
    if (Object.keys(manifest).length > MAX_MANIFEST_KEYS) return false;

    const dependencies = dependencySection(manifest.dependencies);
    if (dependencies === null) return false;
    const devDependencies = dependencySection(manifest.devDependencies);
    if (devDependencies === null) return false;

    return hasExpressDependency(dependencies) || hasExpressDependency(devDependencies);
  } catch {
    return false;
  }
}

function dependencySection(value: unknown): Record<string, unknown> | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;

  const entries = Object.entries(value);
  if (entries.length > MAX_DEPENDENCY_KEYS) return null;
  if (
    entries.some(
      ([, range]) =>
        typeof range !== "string" ||
        range.length === 0 ||
        range.length > MAX_DEPENDENCY_RANGE_LENGTH,
    )
  ) {
    return null;
  }

  return value;
}

function hasExpressDependency(section: Record<string, unknown> | undefined): boolean {
  return typeof section?.express === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
