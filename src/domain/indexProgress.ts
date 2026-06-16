export type UnsubscribeFn = () => void;

export interface MetadataScanReport {
  changedFiles: number;
  erroredEntries: number;
  indexedFiles: number;
  parsedFiles: number;
  removedFiles: number;
  skippedEntries: number;
  symbolsIndexed: number;
}

export interface InitialMetadataScanStart {
  databasePath: string;
  rootPath: string;
  status: "started";
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
  erroredEntries: number;
  indexedFiles: number;
  message: string | null;
  rootPath: string | null;
  skippedEntries: number;
  status: IndexProgressStatus;
}

export interface IndexProgressGateway {
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
    erroredEntries: 0,
    indexedFiles: 0,
    message: null,
    rootPath: null,
    skippedEntries: 0,
    status: "idle",
  };
}

export function startIndexProgress(
  start: InitialMetadataScanStart,
): IndexProgressState {
  return {
    databasePath: start.databasePath,
    erroredEntries: 0,
    indexedFiles: 0,
    message: null,
    rootPath: start.rootPath,
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
      message: event.message || "Index scan failed.",
      rootPath: event.rootPath,
      status: "failed",
    };
  }

  return {
    databasePath: event.databasePath,
    erroredEntries: report?.erroredEntries ?? 0,
    indexedFiles: report?.indexedFiles ?? 0,
    message: indexProgressCompletionMessage(event),
    rootPath: event.rootPath,
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
    return `Indexed ${report.indexedFiles} files, parsed ${report.parsedFiles} PHP files, ${report.symbolsIndexed} symbols (${report.skippedEntries} skipped, ${report.erroredEntries} errors).`;
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
