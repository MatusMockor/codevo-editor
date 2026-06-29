export type UnsubscribeFn = () => void;

export type IndexHealthLogSeverity = "error" | "info" | "warning";

export interface IndexHealthDetail {
  path: string;
  reason: string;
}

export interface IndexHealthLogEntry {
  id: string;
  message: string;
  rootPath: string;
  severity: IndexHealthLogSeverity;
  timestamp: number;
}

export interface MetadataScanReport {
  changedFiles: number;
  errorDetails: IndexHealthDetail[];
  erroredEntries: number;
  indexedFiles: number;
  parsedFiles: number;
  removedFiles: number;
  skippedDetails: IndexHealthDetail[];
  skippedEntries: number;
  symbolsIndexed: number;
}

export interface InitialMetadataScanStart {
  databasePath: string;
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

export interface MetadataScanCompletionEvent {
  databasePath: string;
  message: string | null;
  report: MetadataScanReport | null;
  rootPath: string;
  status: MetadataScanCompletionStatus;
}

export type IndexProgressStatus = "idle" | "scanning" | "completed" | "failed";

export interface IndexProgressState {
  databasePath: string | null;
  errorDetails: IndexHealthDetail[];
  erroredEntries: number;
  indexedFiles: number;
  message: string | null;
  rootPath: string | null;
  skippedDetails: IndexHealthDetail[];
  skippedEntries: number;
  status: IndexProgressStatus;
}

export interface IndexProgressGateway {
  clearWorkspaceIndex(rootPath: string): Promise<WorkspaceIndexClearResult>;
  startInitialMetadataScan(
    rootPath: string,
  ): Promise<InitialMetadataScanStart>;
  startReindex(
    rootPath: string,
    mode: WorkspaceReindexMode,
    language?: string,
  ): Promise<InitialMetadataScanStart>;
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
    rootPath: null,
    skippedDetails: [],
    skippedEntries: 0,
    status: "idle",
  };
}

export function startIndexProgress(
  start: InitialMetadataScanStart,
): IndexProgressState {
  return {
    databasePath: start.databasePath,
    errorDetails: [],
    erroredEntries: 0,
    indexedFiles: 0,
    message: null,
    rootPath: start.rootPath,
    skippedDetails: [],
    skippedEntries: 0,
    status: "scanning",
  };
}

export function applyMetadataScanCompletion(
  current: IndexProgressState,
  event: MetadataScanCompletionEvent,
): IndexProgressState {
  const report = event.report;

  if (event.status === "failed") {
    return {
      ...current,
      databasePath: event.databasePath,
      errorDetails: event.message
        ? [{ path: event.rootPath, reason: event.message }]
        : [],
      erroredEntries: event.message ? 1 : 0,
      message: event.message || "Index scan failed.",
      rootPath: event.rootPath,
      skippedDetails: [],
      skippedEntries: 0,
      status: "failed",
    };
  }

  return {
    databasePath: event.databasePath,
    errorDetails: report?.errorDetails ?? [],
    erroredEntries: report?.erroredEntries ?? 0,
    indexedFiles: report?.indexedFiles ?? 0,
    message: indexProgressCompletionMessage(event),
    rootPath: event.rootPath,
    skippedDetails: report?.skippedDetails ?? [],
    skippedEntries: report?.skippedEntries ?? 0,
    status: "completed",
  };
}

export function indexProgressLabel(
  progress: IndexProgressState,
): string | null {
  if (progress.status === "idle") {
    return null;
  }

  if (progress.status === "scanning") {
    return "Index: scanning";
  }

  if (progress.status === "failed") {
    return "Index: failed";
  }

  if (progress.erroredEntries > 0) {
    return `Index: ${progress.indexedFiles} files · ${progress.erroredEntries} errors`;
  }

  return `Index: ${progress.indexedFiles} files`;
}

export function indexProgressCompletionMessage(
  event: MetadataScanCompletionEvent,
): string {
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
