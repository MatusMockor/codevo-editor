import type { JsTestCoverageReport } from "../domain/jsTestCoverage";
import {
  jsTestCoverageDecorationsForFile,
  type JsTestCoverageLineDecoration,
} from "../domain/jsTestCoverageDecorations";
import { workspaceRelativePath } from "../domain/pathDerivation";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export interface JsTestCoverageReportSnapshot {
  readonly report: JsTestCoverageReport;
  readonly rootPath: string;
  readonly workspaceId: string;
}

export interface ActiveJsTestCoverageDecorationSelection {
  readonly activeFileDirty: boolean;
  readonly activeFilePath: string | null;
  readonly rootPath: string | null;
  readonly snapshot: JsTestCoverageReportSnapshot | null;
  readonly workspaceId: string | null;
}

const COVERAGE_EDITOR_EXTENSIONS = [
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
] as const;

/**
 * Selects line markers only when the coverage report still belongs to the
 * exact active workspace identity and the open file is an unchanged workspace
 * descendant. This makes delayed reports and tab switches fail closed before
 * an editor adapter sees them.
 */
export function selectActiveJsTestCoverageDecorations({
  activeFileDirty,
  activeFilePath,
  rootPath,
  snapshot,
  workspaceId,
}: ActiveJsTestCoverageDecorationSelection): readonly JsTestCoverageLineDecoration[] {
  if (
    activeFileDirty ||
    !activeFilePath ||
    !isJavaScriptTypeScriptCoveragePath(activeFilePath) ||
    !rootPath ||
    !workspaceId ||
    !snapshot ||
    snapshot.workspaceId !== workspaceId ||
    !workspaceRootKeysEqual(snapshot.rootPath, rootPath)
  ) {
    return [];
  }
  const relativePath = workspaceRelativePath(rootPath, activeFilePath);
  return jsTestCoverageDecorationsForFile(snapshot.report, relativePath);
}

function isJavaScriptTypeScriptCoveragePath(path: string): boolean {
  const normalized = path.split("\\").join("/").toLowerCase();
  return COVERAGE_EDITOR_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}
