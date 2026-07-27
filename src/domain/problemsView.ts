import { pathFromLanguageServerUri } from "./languageServerFeatures";
import { workspaceRelativePath } from "./workspace";

export interface ProblemsSeverityVisibility {
  errors: boolean;
  warnings: boolean;
}

export interface ProblemsViewNotice {
  code?: string | number | null;
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

/**
 * Hard UI projection ceiling. The application cache has a larger retention
 * budget so switching files does not discard useful state, but the Problems
 * presenter must never construct an unbounded React tree from that cache.
 */
export const MAX_PROBLEMS_VIEW_ROWS = 2_000;
export const DIAGNOSTICS_RETENTION_RECEIPT_GROUP_KEY = "diagnostics-retention-receipt";

type DiagnosticSource =
  "languageServer" | "javaScriptTypeScript" | "phpLocal" | "jsTest" | "nodePackageTask";

const diagnosticSources: ReadonlyArray<{
  prefix: string;
  source: DiagnosticSource;
}> = [
  { prefix: "language-server-diagnostics:", source: "languageServer" },
  {
    prefix: "javascript-typescript-diagnostics:",
    source: "javaScriptTypeScript",
  },
  { prefix: "php-local-diagnostics:", source: "phpLocal" },
  { prefix: "js-test-problems:", source: "jsTest" },
  { prefix: "node-package-task-problems:", source: "nodePackageTask" },
];
const maxDeduplicationKeys = 2_000;
const globalNoticeOverflowGroupKey = "workbench-notice-overflow";

export function buildProblemsView(
  notices: ProblemsViewNotice[],
  workspaceRoot: string | null,
  visibility: ProblemsSeverityVisibility,
  filterText: string,
): ProblemsView {
  const normalizedFilter = filterText.trim().toLocaleLowerCase();
  const projectedNotices = projectProblemsNotices(
    notices,
    (notice) =>
      severityVisible(notice, visibility) &&
      noticeMatchesFilter(notice, workspaceRoot, normalizedFilter),
  );
  const deduplicatedNotices = deduplicateDiagnostics(projectedNotices);
  const totals = countSeverities(
    deduplicateDiagnostics(projectProblemsNotices(notices, () => true)),
  );
  const grouped = new Map<string, ProblemsViewNotice[]>();
  const general: ProblemsViewNotice[] = [];

  for (const notice of deduplicatedNotices) {
    if (!severityVisible(notice, visibility)) {
      continue;
    }

    const path = noticeFilePath(notice);

    if (!path) {
      if (isDiagnosticsRetentionReceipt(notice) || matchesGeneralFilter(notice, normalizedFilter)) {
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

  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return { files, general, totals };
}

function noticeMatchesFilter(
  notice: ProblemsViewNotice,
  workspaceRoot: string | null,
  normalizedFilter: string,
): boolean {
  if (isDiagnosticsRetentionReceipt(notice)) {
    return true;
  }

  const path = noticeFilePath(notice);
  if (!path) {
    return matchesGeneralFilter(notice, normalizedFilter);
  }

  return matchesFileFilter(
    notice,
    path,
    problemRelativePath(workspaceRoot, path),
    normalizedFilter,
  );
}

function isDiagnosticsRetentionReceipt(notice: ProblemsViewNotice): boolean {
  return (
    notice.groupKey === DIAGNOSTICS_RETENTION_RECEIPT_GROUP_KEY ||
    notice.groupKey?.startsWith(`${DIAGNOSTICS_RETENTION_RECEIPT_GROUP_KEY}:`) === true
  );
}

function projectProblemsNotices(
  notices: readonly ProblemsViewNotice[],
  include: (notice: ProblemsViewNotice) => boolean,
): ProblemsViewNotice[] {
  if (notices.length <= MAX_PROBLEMS_VIEW_ROWS) {
    return [...notices];
  }

  const upstreamReceipt = notices.find(
    (notice) => isDiagnosticsRetentionReceipt(notice) && notice.kind === "overflow",
  );
  const retainedRows: ProblemsViewNotice[] = [];
  const retainedDuplicateIndexes = new Map<string, Map<DiagnosticSource, number>>();
  let eligibleCount = 0;

  for (let index = 0; index < notices.length; index += 1) {
    const notice = notices[index]!;
    if (isDiagnosticsRetentionReceipt(notice)) {
      continue;
    }

    if (!include(notice)) {
      continue;
    }

    eligibleCount += 1;
    if (retainedRows.length < MAX_PROBLEMS_VIEW_ROWS - 1) {
      retainedRows.push(notice);
      indexRetainedDiagnostic(retainedDuplicateIndexes, notice, retainedRows.length - 1);
      continue;
    }

    replaceLowerPriorityRetainedDuplicate(retainedRows, retainedDuplicateIndexes, notice);
  }
  const deduplicatedRows = deduplicateDiagnostics(retainedRows);
  const projectionMessage = `Problems view retained ${deduplicatedRows.length} of ${eligibleCount} input rows.`;
  const projectionTruncated = eligibleCount > deduplicatedRows.length;
  const receipt: ProblemsViewNotice | null = upstreamReceipt
    ? {
        ...upstreamReceipt,
        message: projectionTruncated
          ? `${upstreamReceipt.message} ${projectionMessage}`
          : upstreamReceipt.message,
      }
    : projectionTruncated
      ? {
          groupKey: DIAGNOSTICS_RETENTION_RECEIPT_GROUP_KEY,
          id: DIAGNOSTICS_RETENTION_RECEIPT_GROUP_KEY,
          kind: "overflow",
          message: projectionMessage,
          severity: "info",
          source: "Diagnostics",
        }
      : null;

  return receipt ? [...deduplicatedRows, receipt] : deduplicatedRows;
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

function matchesGeneralFilter(notice: ProblemsViewNotice, normalizedFilter: string): boolean {
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
  const diagnosticSource = diagnosticSourceFromGroup(groupKey);

  if (!diagnosticSource || !groupKey) return null;

  return pathFromLanguageServerUri(groupKey.slice(diagnosticSource.prefix.length));
}

function problemRelativePath(workspaceRoot: string | null, path: string): string {
  if (!workspaceRoot) {
    return path;
  }

  return workspaceRelativePath(workspaceRoot, path) ?? path;
}

function compareProblemEntries(left: ProblemsViewNotice, right: ProblemsViewNotice): number {
  const leftLine = left.navigationTarget?.range.start.lineNumber ?? Infinity;
  const rightLine = right.navigationTarget?.range.start.lineNumber ?? Infinity;

  if (leftLine !== rightLine) {
    return leftLine - rightLine;
  }

  return left.id.localeCompare(right.id);
}

interface DeduplicationRecord {
  code: string | null;
  index: number;
  notice: ProblemsViewNotice;
  source: DiagnosticSource;
}

function deduplicateDiagnostics(notices: ProblemsViewNotice[]): ProblemsViewNotice[] {
  const buckets = new Map<string, DeduplicationRecord[]>();
  let trackedRecords = 0;

  notices.forEach((notice, index) => {
    if (trackedRecords >= maxDeduplicationKeys) return;

    const record = deduplicationRecord(notice, index);

    if (!record) return;

    trackedRecords += 1;
    const key = diagnosticDeduplicationKey(record);
    const bucket = buckets.get(key);

    if (bucket) {
      bucket.push(record);
      return;
    }

    buckets.set(key, [record]);
  });

  const discarded = new Set<number>();

  for (const records of buckets.values()) {
    discardLowerPriorityDuplicates(records, discarded);
  }

  return notices.filter((_, index) => !discarded.has(index));
}

function deduplicationRecord(
  notice: ProblemsViewNotice,
  index: number,
): DeduplicationRecord | null {
  if (notice.kind === "overflow") return null;

  const diagnosticSource = diagnosticSourceFromGroup(notice.groupKey);
  const target = notice.navigationTarget;

  if (!diagnosticSource || !target) return null;

  const parsed = normalizedDiagnosticMessage(notice, diagnosticSource.prefix);

  return {
    code: notice.code == null ? parsed.code : String(notice.code),
    index,
    notice: { ...notice, message: parsed.message },
    source: diagnosticSource.source,
  };
}

function replaceLowerPriorityRetainedDuplicate(
  retained: ProblemsViewNotice[],
  retainedIndexes: Map<string, Map<DiagnosticSource, number>>,
  incoming: ProblemsViewNotice,
): void {
  const incomingRecord = deduplicationRecord(incoming, -1);
  if (!incomingRecord) return;
  const sourceIndexes = retainedIndexes.get(retainedDiagnosticIndexKey(incomingRecord));
  if (!sourceIndexes || sourceIndexes.has(incomingRecord.source)) return;

  for (const [source, index] of sourceIndexes) {
    const retainedRecord = deduplicationRecord(retained[index]!, index);
    if (
      source === incomingRecord.source ||
      !retainedRecord ||
      compareDeduplicationRecords(incomingRecord, retainedRecord) >= 0
    ) {
      continue;
    }

    retained[index] = incoming;
    sourceIndexes.set(incomingRecord.source, index);
    return;
  }
}

function indexRetainedDiagnostic(
  retainedIndexes: Map<string, Map<DiagnosticSource, number>>,
  notice: ProblemsViewNotice,
  index: number,
): void {
  const record = deduplicationRecord(notice, index);
  if (!record) return;
  const key = retainedDiagnosticIndexKey(record);
  const sourceIndexes = retainedIndexes.get(key) ?? new Map();
  if (!sourceIndexes.has(record.source)) {
    sourceIndexes.set(record.source, index);
  }
  retainedIndexes.set(key, sourceIndexes);
}

function retainedDiagnosticIndexKey(record: DeduplicationRecord): string {
  return diagnosticDeduplicationKey(record);
}

function diagnosticDeduplicationKey(record: DeduplicationRecord): string {
  const position = record.notice.navigationTarget?.range.start;

  return JSON.stringify([
    normalizedDiagnosticPath(record.notice.navigationTarget?.path ?? ""),
    position?.lineNumber,
    position?.column,
    record.notice.message,
  ]);
}

function discardLowerPriorityDuplicates(
  records: DeduplicationRecord[],
  discarded: Set<number>,
): void {
  const coded = new Map<string, DeduplicationRecord[]>();
  const uncoded: DeduplicationRecord[] = [];

  for (const record of records) {
    if (record.code === null) {
      uncoded.push(record);
      continue;
    }

    const matchingCode = coded.get(record.code) ?? [];
    matchingCode.push(record);
    coded.set(record.code, matchingCode);
  }

  if (coded.size <= 1) {
    discardDuplicateGroup([...records], discarded);
    return;
  }

  for (const matchingCode of coded.values()) {
    discardDuplicateGroup(matchingCode, discarded);
  }
}

function discardDuplicateGroup(records: DeduplicationRecord[], discarded: Set<number>): void {
  if (new Set(records.map((record) => record.source)).size < 2) return;

  const winner = records.reduce((left, right) =>
    compareDeduplicationRecords(left, right) <= 0 ? left : right,
  );

  for (const record of records) {
    if (record.index !== winner.index) discarded.add(record.index);
  }
}

function compareDeduplicationRecords(
  left: DeduplicationRecord,
  right: DeduplicationRecord,
): number {
  const priorityDifference =
    diagnosticSourcePriority(right.source) - diagnosticSourcePriority(left.source);

  if (priorityDifference !== 0) return priorityDifference;

  return left.notice.id.localeCompare(right.notice.id);
}

function normalizedDiagnosticMessage(
  notice: ProblemsViewNotice,
  groupPrefix: string,
): { code: string | null; message: string } {
  const position = notice.navigationTarget?.range.start;
  const uri = notice.groupKey?.slice(groupPrefix.length);
  const locationPrefix = `${uri} ${position?.lineNumber}:${position?.column} `;
  const message = notice.message.startsWith(locationPrefix)
    ? notice.message.slice(locationPrefix.length)
    : notice.message;
  const codeMatch = message.match(/\s+\(([A-Za-z][A-Za-z0-9_-]*\d[A-Za-z0-9_-]*)\)$/);

  return {
    code: codeMatch?.[1] ?? null,
    message: codeMatch ? message.slice(0, codeMatch.index) : message,
  };
}

function normalizedDiagnosticPath(path: string): string {
  const slashes = path.trim().split("\\").join("/");
  const root = slashes.startsWith("//") ? "//" : slashes.startsWith("/") ? "/" : "";

  return `${root}${slashes.slice(root.length).replace(/\/+/g, "/")}`;
}

function diagnosticSourceFromGroup(
  groupKey: string | undefined,
): (typeof diagnosticSources)[number] | null {
  if (!groupKey) return null;

  return diagnosticSources.find(({ prefix }) => groupKey.startsWith(prefix)) ?? null;
}

function diagnosticSourcePriority(source: DiagnosticSource): number {
  switch (source) {
    case "javaScriptTypeScript":
      return 5;
    case "languageServer":
      return 4;
    case "phpLocal":
      return 3;
    case "jsTest":
      return 2;
    case "nodePackageTask":
      return 1;
    default: {
      const exhaustiveSource: never = source;
      return exhaustiveSource;
    }
  }
}
