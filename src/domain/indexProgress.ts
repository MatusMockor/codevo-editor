export type UnsubscribeFn = () => void;

export type IndexHealthLogSeverity = "error" | "info" | "warning";

export interface IndexHealthDetail {
  readonly path: string;
  readonly reason: string;
}

export interface IndexHealthLogEntry {
  id: string;
  message: string;
  rootPath: string;
  severity: IndexHealthLogSeverity;
  timestamp: number;
}

export interface MetadataScanReport {
  readonly changedFiles: number;
  readonly errorDetails: readonly IndexHealthDetail[];
  readonly erroredEntries: number;
  readonly indexedFiles: number;
  readonly parsedFiles: number;
  readonly removedFiles: number;
  readonly skippedDetails: readonly IndexHealthDetail[];
  readonly skippedEntries: number;
  readonly symbolsIndexed: number;
}

export interface InitialMetadataScanStart {
  databasePath: string;
  operationGeneration: number;
  rootPath: string;
  status: "started";
}

export interface WorkspaceIndexClearResult {
  databasePath: string;
  rootPath: string;
  status: "cleared";
}

export type MetadataScanCompletionStatus = "completed" | "failed";
export type WorkspaceReindexMode = "hard" | "language" | "soft";

export interface WorkspaceIndexMutationRequest {
  readonly admissionToken: number;
  readonly rootPath: string;
  readonly workspaceId: string;
}

export interface WorkspaceIndexOperationRequest extends WorkspaceIndexMutationRequest {
  readonly operationGeneration: number;
}

interface MetadataScanCompletionBase {
  readonly databasePath: string;
  readonly operationGeneration: number;
  readonly rootPath: string;
}

export type MetadataScanCompletionEvent =
  | (MetadataScanCompletionBase & {
      readonly message: null;
      readonly report: MetadataScanReport;
      readonly status: "completed";
    })
  | (MetadataScanCompletionBase & {
      readonly message: string;
      readonly report: null;
      readonly status: "failed";
    });

export type IndexProgressStatus = "idle" | "scanning" | "completed" | "failed";
export type IndexProgressPhase = "parsing" | "scanning";

/// Incremental progress emitted on batch boundaries during a reindex (mirrors the Rust
/// `IndexProgressEvent`). `totalFiles` is `null` when the total is unknown so the UI degrades to an
/// indeterminate count. Tagged with `rootPath` so cross-workspace events are dropped.
export interface IndexProgressEvent {
  readonly operationGeneration: number;
  readonly phase: IndexProgressPhase;
  readonly processedFiles: number;
  readonly rootPath: string;
  readonly totalFiles: number | null;
}

export interface IndexProgressState {
  databasePath: string | null;
  errorDetails: IndexHealthDetail[];
  erroredEntries: number;
  indexedFiles: number;
  message: string | null;
  operationGeneration: number | null;
  processedFiles: number;
  rootPath: string | null;
  skippedDetails: IndexHealthDetail[];
  skippedEntries: number;
  status: IndexProgressStatus;
  totalFiles: number | null;
}

export interface IndexProgressGateway {
  clearWorkspaceIndex(request: WorkspaceIndexMutationRequest): Promise<WorkspaceIndexClearResult>;
  startInitialMetadataScan(
    request: WorkspaceIndexOperationRequest,
  ): Promise<InitialMetadataScanStart>;
  startReindex(
    request: WorkspaceIndexOperationRequest,
    mode: WorkspaceReindexMode,
    language?: string,
  ): Promise<InitialMetadataScanStart>;
  subscribeIndexProgress(listener: (event: IndexProgressEvent) => void): Promise<UnsubscribeFn>;
  subscribeMetadataScanCompletion(
    listener: (event: MetadataScanCompletionEvent) => void,
  ): Promise<UnsubscribeFn>;
}

export function initialIndexProgress(): IndexProgressState {
  return {
    databasePath: null,
    errorDetails: [],
    erroredEntries: 0,
    indexedFiles: 0,
    message: null,
    operationGeneration: null,
    processedFiles: 0,
    rootPath: null,
    skippedDetails: [],
    skippedEntries: 0,
    status: "idle",
    totalFiles: null,
  };
}

export function startIndexProgress(start: InitialMetadataScanStart): IndexProgressState {
  return beginIndexProgress(start.rootPath, start.operationGeneration, start.databasePath);
}

export function beginIndexProgress(
  rootPath: string,
  operationGeneration: number,
  databasePath: string | null = null,
): IndexProgressState {
  return {
    databasePath,
    errorDetails: [],
    erroredEntries: 0,
    indexedFiles: 0,
    message: null,
    operationGeneration,
    processedFiles: 0,
    rootPath,
    skippedDetails: [],
    skippedEntries: 0,
    status: "scanning",
    totalFiles: null,
  };
}

/// Folds an incremental progress event into the scanning state. Processed count is clamped to be
/// monotonic so out-of-order events never make the bar jump backwards; the latest known total wins.
/// Completion / failure are owned by `applyMetadataScanCompletion`, so this only updates counts.
export function applyIndexProgress(
  current: IndexProgressState,
  event: IndexProgressEvent,
): IndexProgressState {
  if (!ownsIndexOperation(current, event)) {
    return current;
  }

  return {
    ...current,
    processedFiles: Math.max(current.processedFiles, event.processedFiles),
    status: "scanning",
    // The emitter keeps totalFiles constant for the lifetime of one run, so taking the latest value
    // is safe; if that contract ever loosens, prefer the last known non-null total here.
    totalFiles: event.totalFiles,
  };
}

export function applyMetadataScanCompletion(
  current: IndexProgressState,
  event: MetadataScanCompletionEvent,
): IndexProgressState {
  if (!ownsIndexOperation(current, event)) {
    return current;
  }

  const report = event.report;

  if (event.status === "failed") {
    return {
      ...current,
      databasePath: event.databasePath,
      errorDetails: event.message ? [{ path: event.rootPath, reason: event.message }] : [],
      erroredEntries: event.message ? 1 : 0,
      message: event.message || "Index scan failed.",
      processedFiles: 0,
      rootPath: event.rootPath,
      skippedDetails: [],
      skippedEntries: 0,
      status: "failed",
      totalFiles: null,
    };
  }

  return {
    databasePath: event.databasePath,
    errorDetails: report ? [...report.errorDetails] : [],
    erroredEntries: report?.erroredEntries ?? 0,
    indexedFiles: report?.indexedFiles ?? 0,
    message: indexProgressCompletionMessage(event),
    operationGeneration: event.operationGeneration,
    processedFiles: 0,
    rootPath: event.rootPath,
    skippedDetails: report ? [...report.skippedDetails] : [],
    skippedEntries: report?.skippedEntries ?? 0,
    status: "completed",
    totalFiles: null,
  };
}

function ownsIndexOperation(
  current: IndexProgressState,
  event: { operationGeneration: number; rootPath: string },
): boolean {
  if (current.status !== "scanning") {
    return false;
  }

  return (
    current.rootPath === event.rootPath && current.operationGeneration === event.operationGeneration
  );
}

export function indexProgressLabel(progress: IndexProgressState): string | null {
  if (progress.status === "idle") {
    return null;
  }

  if (progress.status === "scanning") {
    return indexScanningLabel(progress);
  }

  if (progress.status === "failed") {
    return "Index: failed";
  }

  if (progress.erroredEntries > 0) {
    return `Index: ${progress.indexedFiles} files · ${progress.erroredEntries} errors`;
  }

  return `Index: ${progress.indexedFiles} files`;
}

/// Status-bar text for an in-flight scan. Three graceful tiers: a known total renders a determinate
/// "X of N files (P%)"; a positive processed count with no total renders an indeterminate
/// "X files scanned"; before any batch lands it stays the plain "scanning" spinner label.
function indexScanningLabel(progress: IndexProgressState): string {
  if (progress.totalFiles !== null && progress.totalFiles > 0) {
    const percent = indexProgressPercent(progress);
    return `Index: ${progress.processedFiles} of ${progress.totalFiles} files (${percent}%)`;
  }

  if (progress.processedFiles > 0) {
    return `Index: ${progress.processedFiles} files scanned`;
  }

  return "Index: scanning";
}

/// Clamped 0..100 completion percentage for a scan with a known total; `0` when the total is
/// unknown or empty so callers never divide by zero.
export function indexProgressPercent(progress: IndexProgressState): number {
  if (progress.totalFiles === null || progress.totalFiles <= 0) {
    return 0;
  }

  const ratio = progress.processedFiles / progress.totalFiles;
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}

export function indexProgressCompletionMessage(event: MetadataScanCompletionEvent): string {
  if (event.status === "failed") {
    return event.message || "Index scan failed.";
  }

  const report = event.report;

  if (!report) {
    return "Index scan completed.";
  }

  if (report.parsedFiles > 0 || report.symbolsIndexed > 0) {
    return `Indexed ${report.indexedFiles} files, parsed ${report.parsedFiles} source files, ${report.symbolsIndexed} symbols (${report.skippedEntries} skipped, ${report.erroredEntries} errors).`;
  }

  if (report.removedFiles > 0) {
    return `Indexed ${report.indexedFiles} files, removed ${report.removedFiles} missing files (${report.skippedEntries} skipped, ${report.erroredEntries} errors).`;
  }

  return `Indexed ${report.indexedFiles} files (${report.skippedEntries} skipped, ${report.erroredEntries} errors).`;
}

export function indexProgressNoticeSeverity(
  event: MetadataScanCompletionEvent,
): "warning" | "error" | null {
  if (event.status === "failed") {
    return "error";
  }

  if ((event.report?.erroredEntries ?? 0) > 0) {
    return "warning";
  }

  return null;
}

export function createIndexHealthLogEntry(
  severity: IndexHealthLogSeverity,
  rootPath: string,
  message: string,
  timestamp = Date.now(),
): IndexHealthLogEntry {
  return {
    id: `${timestamp}:${severity}:${rootPath}:${message}`,
    message,
    rootPath,
    severity,
    timestamp,
  };
}

export function createIndexHealthCompletionLog(
  event: MetadataScanCompletionEvent,
  timestamp = Date.now(),
): IndexHealthLogEntry {
  const severity = indexProgressNoticeSeverity(event) || "info";
  return createIndexHealthLogEntry(
    severity,
    event.rootPath,
    indexProgressCompletionMessage(event),
    timestamp,
  );
}

export function prependIndexHealthLog(
  current: IndexHealthLogEntry[],
  entry: IndexHealthLogEntry,
  limit = 20,
): IndexHealthLogEntry[] {
  return [entry, ...current].slice(0, limit);
}
