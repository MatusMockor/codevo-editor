import {
  PHP_CLOVER_COVERAGE_LIMITS,
  phpCoverageMetric,
  type PhpCloverCoverageReport,
  type PhpCoverageMetric,
} from "./phpCloverCoverage";
import {
  canonicalPhpCoverageRelativePath,
  canonicalPhpCoverageRootPath,
  joinPhpCoveragePath,
  phpCoverageRelativePath,
  phpCoverageRelativePathsEqual,
} from "./phpCoveragePath";

export type PhpCoverageLineStatus = "covered" | "uncovered";

export interface PhpCoverageLineState {
  readonly lineNumber: number;
  readonly hits: number;
  readonly status: PhpCoverageLineStatus;
}

export interface PhpCoverageInvalidationIdentity {
  readonly activeFilePath: string;
  readonly relativePath: string;
  readonly rootPath: string;
}

export interface PhpActiveFileCoverageProjection {
  readonly identity: PhpCoverageInvalidationIdentity;
  readonly lines: readonly PhpCoverageLineState[];
  readonly summary: PhpCoverageMetric;
}

/**
 * Projects one unchanged active PHP file from a decoded Clover report.
 * Workspace ownership and run revision remain application concerns; this
 * domain identity captures only the canonical path inputs they invalidate.
 */
export function projectPhpCoverageForActiveFile({
  activeFileDirty,
  activeFilePath,
  report,
  workspaceRoot,
}: {
  readonly activeFileDirty: boolean;
  readonly activeFilePath: string | null;
  readonly report: PhpCloverCoverageReport | null;
  readonly workspaceRoot: string | null;
}): PhpActiveFileCoverageProjection | null {
  if (
    activeFileDirty ||
    !report ||
    !Array.isArray(report.files) ||
    !workspaceRoot ||
    !activeFilePath
  ) {
    return null;
  }
  const rootPath = canonicalPhpCoverageRootPath(workspaceRoot);
  const relativePath = phpCoverageRelativePath(workspaceRoot, activeFilePath);
  if (!rootPath || !relativePath || !isPhpSourcePath(relativePath)) return null;
  const canonicalActiveFilePath = joinPhpCoveragePath(rootPath, relativePath);
  if (!canonicalActiveFilePath || report.files.length > PHP_CLOVER_COVERAGE_LIMITS.maxFiles) {
    return null;
  }

  const hitsByLine = new Map<number, number>();
  let matchingLineRecords = 0;
  let foundMatchingFile = false;
  for (const file of report.files) {
    if (!file || typeof file !== "object") return null;
    const candidatePath = canonicalPhpCoverageRelativePath(file.path);
    if (
      !candidatePath ||
      !phpCoverageRelativePathsEqual(rootPath, candidatePath, relativePath) ||
      !Array.isArray(file.lines)
    ) {
      continue;
    }
    foundMatchingFile = true;
    for (const line of file.lines) {
      matchingLineRecords += 1;
      if (
        matchingLineRecords > PHP_CLOVER_COVERAGE_LIMITS.maxLineRecords ||
        !Number.isSafeInteger(line.lineNumber) ||
        line.lineNumber <= 0 ||
        !Number.isSafeInteger(line.hits) ||
        line.hits < 0
      ) {
        return null;
      }
      hitsByLine.set(line.lineNumber, Math.max(hitsByLine.get(line.lineNumber) ?? 0, line.hits));
    }
  }
  if (!foundMatchingFile) return null;

  const lines = Object.freeze(
    [...hitsByLine.entries()]
      .sort(([left], [right]) => left - right)
      .map(([lineNumber, hits]) =>
        Object.freeze({
          lineNumber,
          hits,
          status: hits > 0 ? ("covered" as const) : ("uncovered" as const),
        }),
      ),
  );
  const covered = lines.filter(({ status }) => status === "covered").length;
  return Object.freeze({
    identity: Object.freeze({ activeFilePath: canonicalActiveFilePath, relativePath, rootPath }),
    lines,
    summary: phpCoverageMetric(covered, lines.length),
  });
}

export function phpCoverageInvalidationIdentitiesEqual(
  left: PhpCoverageInvalidationIdentity | null,
  right: PhpCoverageInvalidationIdentity | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.activeFilePath === right.activeFilePath &&
      left.relativePath === right.relativePath &&
      left.rootPath === right.rootPath)
  );
}

function isPhpSourcePath(path: string): boolean {
  return path.toLowerCase().endsWith(".php");
}
