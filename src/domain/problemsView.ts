import { pathFromLanguageServerUri } from "./languageServerFeatures";
import { workspaceRelativePath } from "./workspace";

export interface ProblemsSeverityVisibility {
  errors: boolean;
  warnings: boolean;
}

export interface ProblemsViewNotice {
  groupKey?: string;
  id: string;
  kind?: "overflow";
  message: string;
  navigationTarget?: {
    path: string;
    range: {
      end: { column: number; lineNumber: number };
      start: { column: number; lineNumber: number };
    };
  };
  severity: "info" | "warning" | "error";
  source: string;
}

export interface ProblemsFileView {
  path: string;
  relativePath: string;
  errorCount: number;
  warningCount: number;
  entries: ProblemsViewNotice[];
}

export interface ProblemsView {
  files: ProblemsFileView[];
  general: ProblemsViewNotice[];
  totals: {
    errors: number;
    warnings: number;
  };
}

const diagnosticGroupPrefixes = [
  "language-server-diagnostics:",
  "javascript-typescript-diagnostics:",
  "php-local-diagnostics:",
];
const globalNoticeOverflowGroupKey = "workbench-notice-overflow";

export function buildProblemsView(
  notices: ProblemsViewNotice[],
  workspaceRoot: string | null,
  visibility: ProblemsSeverityVisibility,
  filterText: string,
): ProblemsView {
  const totals = countSeverities(notices);
  const normalizedFilter = filterText.trim().toLocaleLowerCase();
  const grouped = new Map<string, ProblemsViewNotice[]>();
  const general: ProblemsViewNotice[] = [];

  for (const notice of notices) {
    if (!severityVisible(notice, visibility)) {
      continue;
    }

    const path = noticeFilePath(notice);

    if (!path) {
      if (matchesGeneralFilter(notice, normalizedFilter)) {
        general.push(notice);
      }

      continue;
    }

    const relativePath = problemRelativePath(workspaceRoot, path);

    if (!matchesFileFilter(notice, path, relativePath, normalizedFilter)) {
      continue;
    }

    const entries = grouped.get(path) ?? [];
    entries.push(notice);
    grouped.set(path, entries);
  }

  const files = Array.from(grouped, ([path, entries]) => {
    entries.sort(compareProblemEntries);
    const counts = countSeverities(entries);

    return {
      path,
      relativePath: problemRelativePath(workspaceRoot, path),
      errorCount: counts.errors,
      warningCount: counts.warnings,
      entries,
    };
  });

  files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );

  return { files, general, totals };
}

function countSeverities(notices: ProblemsViewNotice[]) {
  let errors = 0;
  let warnings = 0;

  for (const notice of notices) {
    if (notice.groupKey === globalNoticeOverflowGroupKey) {
      continue;
    }

    if (notice.severity === "error") {
      errors += 1;
      continue;
    }

    if (notice.severity === "warning") {
      warnings += 1;
    }
  }

  return { errors, warnings };
}

function severityVisible(
  notice: ProblemsViewNotice,
  visibility: ProblemsSeverityVisibility,
): boolean {
  if (notice.severity === "error") {
    return visibility.errors;
  }

  if (notice.severity === "warning") {
    return visibility.warnings;
  }

  return true;
}

function matchesFileFilter(
  notice: ProblemsViewNotice,
  path: string,
  relativePath: string,
  normalizedFilter: string,
): boolean {
  if (!normalizedFilter) {
    return true;
  }

  return [notice.message, path, relativePath].some((value) =>
    value.toLocaleLowerCase().includes(normalizedFilter),
  );
}

function matchesGeneralFilter(
  notice: ProblemsViewNotice,
  normalizedFilter: string,
): boolean {
  if (!normalizedFilter) {
    return true;
  }

  return [notice.message, notice.source].some((value) =>
    value.toLocaleLowerCase().includes(normalizedFilter),
  );
}

function noticeFilePath(notice: ProblemsViewNotice): string | null {
  if (notice.navigationTarget) {
    return notice.navigationTarget.path;
  }

  const groupPath = pathFromDiagnosticGroup(notice.groupKey);

  if (groupPath) {
    return groupPath;
  }

  return null;
}

function pathFromDiagnosticGroup(groupKey: string | undefined): string | null {
  if (!groupKey) {
    return null;
  }

  const prefix = diagnosticGroupPrefixes.find((candidate) =>
    groupKey.startsWith(candidate),
  );

  if (!prefix) {
    return null;
  }

  return pathFromLanguageServerUri(groupKey.slice(prefix.length));
}

function problemRelativePath(
  workspaceRoot: string | null,
  path: string,
): string {
  if (!workspaceRoot) {
    return path;
  }

  return workspaceRelativePath(workspaceRoot, path) ?? path;
}

function compareProblemEntries(
  left: ProblemsViewNotice,
  right: ProblemsViewNotice,
): number {
  const leftLine = left.navigationTarget?.range.start.lineNumber ?? Infinity;
  const rightLine = right.navigationTarget?.range.start.lineNumber ?? Infinity;

  if (leftLine !== rightLine) {
    return leftLine - rightLine;
  }

  return left.id.localeCompare(right.id);
}
