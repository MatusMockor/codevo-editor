import type { WorkspacePackageManifestInput } from "./workspacePackageGraph";
import {
  createWorkspacePackagePathLookup,
  type WorkspacePackagePathAnswer,
} from "./workspacePackageForPath";

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
  const fallbackIdentity =
    unscopedFallbackIdentity ??
    (unscopedAuthorityUncertain ? UNKNOWN_PROBLEMS_PACKAGE : NO_PROBLEMS_PACKAGE);
  const lookup = createWorkspacePackagePathLookup({
    authority: fallbackIdentity === LOADING_PROBLEMS_PACKAGE ? "loading" : "complete",
    incompleteDirectories,
    packageManifests,
    unscopedAuthorityUncertain,
    workspaceRoot,
  });
  const byPath = new Map<string, ProblemsPackageIdentity>();
  const identities = new Map<string, ProblemsPackageIdentity>();

  for (const path of filePaths) {
    const identity = problemIdentityForAnswer(lookup.packageForPath(path), fallbackIdentity);
    byPath.set(path, identity);
    identities.set(identity.key, identity);
  }

  return {
    identities: [...identities.values()].sort(comparePackageIdentities),
    packageForPath: (path) => byPath.get(path) ?? fallbackIdentity,
  };
}

function problemIdentityForAnswer(
  answer: WorkspacePackagePathAnswer,
  fallbackIdentity: ProblemsPackageIdentity,
): ProblemsPackageIdentity {
  if (answer.kind === "loading") return LOADING_PROBLEMS_PACKAGE;
  if (answer.kind === "unknown") return UNKNOWN_PROBLEMS_PACKAGE;
  if (answer.kind === "no-package") return fallbackIdentity;
  return {
    key: answer.name,
    kind: "package",
    label: answer.name,
    relativeDirPath: answer.relativeDirPath,
  };
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
