import { describe, expect, it } from "vitest";
import {
  applyIndexProgress,
  applyMetadataScanCompletion,
  beginIndexProgress,
  createIndexHealthCompletionLog,
  createIndexHealthLogEntry,
  indexProgressCompletionMessage,
  indexProgressLabel,
  indexProgressNoticeSeverity,
  initialIndexProgress,
  prependIndexHealthLog,
  startIndexProgress,
  type IndexProgressEvent,
  type MetadataScanCompletionEvent,
  type MetadataScanReport,
} from "./indexProgress";

describe("indexProgress", () => {
  it("tracks a started scan", () => {
    const progress = startIndexProgress({
      databasePath: "/config/index.sqlite3",
      operationGeneration: 7,
      rootPath: "/workspace",
      status: "started",
    });

    expect(progress).toEqual({
      databasePath: "/config/index.sqlite3",
      errorDetails: [],
      erroredEntries: 0,
      indexedFiles: 0,
      message: null,
      operationGeneration: 7,
      processedFiles: 0,
      rootPath: "/workspace",
      skippedDetails: [],
      skippedEntries: 0,
      status: "scanning",
      totalFiles: null,
    });
    expect(indexProgressLabel(progress)).toBe("Index: scanning");
  });

  it("activates caller-issued authority before a start response", () => {
    const progress = applyIndexProgress(
      beginIndexProgress("/workspace", 7),
      progressEvent({ processedFiles: 1 }),
    );

    expect(progress.databasePath).toBeNull();
    expect(progress.operationGeneration).toBe(7);
    expect(progress.processedFiles).toBe(1);
    expect(progress.status).toBe("scanning");
  });

  it("applies incremental progress with a known total as 'X of N'", () => {
    const progress = applyIndexProgress(
      startIndexProgress({
        databasePath: "/config/index.sqlite3",
        operationGeneration: 7,
        rootPath: "/workspace",
        status: "started",
      }),
      progressEvent({
        phase: "parsing",
        processedFiles: 500,
        rootPath: "/workspace",
        totalFiles: 1200,
      }),
    );

    expect(progress.status).toBe("scanning");
    expect(progress.processedFiles).toBe(500);
    expect(progress.totalFiles).toBe(1200);
    expect(indexProgressLabel(progress)).toBe("Index: 500 of 1200 files (42%)");
  });

  it("falls back to an indeterminate count when the total is unknown", () => {
    const progress = applyIndexProgress(
      startIndexProgress({
        databasePath: "/config/index.sqlite3",
        operationGeneration: 7,
        rootPath: "/workspace",
        status: "started",
      }),
      progressEvent({
        phase: "parsing",
        processedFiles: 240,
        rootPath: "/workspace",
        totalFiles: null,
      }),
    );

    expect(progress.processedFiles).toBe(240);
    expect(progress.totalFiles).toBeNull();
    expect(indexProgressLabel(progress)).toBe("Index: 240 files scanned");
  });

  it("does not regress to a smaller processed count on out-of-order events", () => {
    const advanced = applyIndexProgress(
      startIndexProgress({
        databasePath: "/config/index.sqlite3",
        operationGeneration: 7,
        rootPath: "/workspace",
        status: "started",
      }),
      progressEvent({ processedFiles: 1000, rootPath: "/workspace", totalFiles: 1200 }),
    );
    const stale = applyIndexProgress(
      advanced,
      progressEvent({ processedFiles: 500, rootPath: "/workspace", totalFiles: 1200 }),
    );

    expect(stale.processedFiles).toBe(1000);
  });

  it("applies completed scan counts", () => {
    const progress = applyMetadataScanCompletion(
      scanningProgress(),
      completedEvent(
        scanReport({
          erroredEntries: 0,
          errorDetails: [],
          indexedFiles: 42,
          skippedDetails: [{ path: "vendor", reason: "Ignored by workspace rules." }],
          skippedEntries: 7,
        }),
      ),
    );

    expect(progress.status).toBe("completed");
    expect(progress.indexedFiles).toBe(42);
    expect(progress.skippedEntries).toBe(7);
    expect(indexProgressLabel(progress)).toBe("Index: 42 files");
    expect(progress.message).toBe("Indexed 42 files (7 skipped, 0 errors).");
    expect(progress.skippedDetails).toEqual([
      { path: "vendor", reason: "Ignored by workspace rules." },
    ]);
  });

  it("labels completed scans with entry errors", () => {
    const event = completedEvent(
      scanReport({
        erroredEntries: 2,
        indexedFiles: 8,
        skippedEntries: 3,
      }),
    );
    const progress = applyMetadataScanCompletion(scanningProgress(), event);

    expect(indexProgressLabel(progress)).toBe("Index: 8 files · 2 errors");
    expect(indexProgressNoticeSeverity(event)).toBe("warning");
  });

  it("includes source symbol reindex counts in completion messages", () => {
    const event = completedEvent(
      scanReport({
        indexedFiles: 3,
        parsedFiles: 2,
        skippedEntries: 1,
        symbolsIndexed: 8,
      }),
    );

    expect(indexProgressCompletionMessage(event)).toBe(
      "Indexed 3 files, parsed 2 source files, 8 symbols (1 skipped, 0 errors).",
    );
  });

  it("describes zero-symbol parsed source files neutrally", () => {
    const event = completedEvent(
      scanReport({
        indexedFiles: 2,
        parsedFiles: 2,
        symbolsIndexed: 0,
      }),
    );

    expect(indexProgressCompletionMessage(event)).toBe(
      "Indexed 2 files, parsed 2 source files, 0 symbols (0 skipped, 0 errors).",
    );
  });

  it("tracks failed scans", () => {
    const event = failedEvent("database locked");
    const progress = applyMetadataScanCompletion(scanningProgress(), event);

    expect(progress.status).toBe("failed");
    expect(progress.errorDetails).toEqual([{ path: "/workspace", reason: "database locked" }]);
    expect(progress.message).toBe("database locked");
    expect(indexProgressLabel(progress)).toBe("Index: failed");
    expect(indexProgressCompletionMessage(event)).toBe("database locked");
    expect(indexProgressNoticeSeverity(event)).toBe("error");
  });

  it("ignores events that do not own the active root and generation", () => {
    const current = scanningProgress();

    expect(applyIndexProgress(current, progressEvent({ operationGeneration: 6 }))).toBe(current);
    expect(applyIndexProgress(current, progressEvent({ rootPath: "/other" }))).toBe(current);
    expect(
      applyMetadataScanCompletion(
        current,
        completedEvent(scanReport({ indexedFiles: 99 }), {
          operationGeneration: 6,
        }),
      ),
    ).toBe(current);
  });

  it("does not let a stale A event paint replacement A", () => {
    const firstA = scanningProgress(1);
    const replacementA = scanningProgress(3);
    const staleCompletion = completedEvent(scanReport({ indexedFiles: 99 }), {
      operationGeneration: firstA.operationGeneration ?? 1,
    });

    expect(applyMetadataScanCompletion(replacementA, staleCompletion)).toBe(replacementA);
  });

  it("does not let an event initialize idle state", () => {
    const idle = initialIndexProgress();

    expect(applyIndexProgress(idle, progressEvent())).toBe(idle);
    expect(applyMetadataScanCompletion(idle, completedEvent(scanReport({})))).toBe(idle);
  });

  it("creates bounded health log entries", () => {
    const failed = createIndexHealthCompletionLog(failedEvent("database locked"), 2);
    const started = createIndexHealthLogEntry("info", "/workspace", "Index scan started.", 1);

    expect(failed).toMatchObject({
      message: "database locked",
      rootPath: "/workspace",
      severity: "error",
      timestamp: 2,
    });
    expect(prependIndexHealthLog([started], failed, 1)).toEqual([failed]);
  });
});

function completedEvent(
  report: MetadataScanReport,
  overrides: Partial<Extract<MetadataScanCompletionEvent, { status: "completed" }>> = {},
): MetadataScanCompletionEvent {
  return {
    databasePath: "/config/index.sqlite3",
    message: null,
    operationGeneration: 7,
    report,
    rootPath: "/workspace",
    status: "completed",
    ...overrides,
  };
}

function scanReport(
  overrides: Partial<NonNullable<MetadataScanCompletionEvent["report"]>>,
): NonNullable<MetadataScanCompletionEvent["report"]> {
  return {
    changedFiles: 0,
    errorDetails: [],
    erroredEntries: 0,
    indexedFiles: 0,
    parsedFiles: 0,
    removedFiles: 0,
    skippedDetails: [],
    skippedEntries: 0,
    symbolsIndexed: 0,
    ...overrides,
  };
}

function progressEvent(overrides: Partial<IndexProgressEvent> = {}): IndexProgressEvent {
  return {
    operationGeneration: 7,
    phase: "parsing",
    processedFiles: 0,
    rootPath: "/workspace",
    totalFiles: null,
    ...overrides,
  };
}

function failedEvent(message: string): MetadataScanCompletionEvent {
  return {
    databasePath: "/config/index.sqlite3",
    message,
    operationGeneration: 7,
    report: null,
    rootPath: "/workspace",
    status: "failed",
  };
}

function scanningProgress(operationGeneration = 7) {
  return startIndexProgress({
    databasePath: "/config/index.sqlite3",
    operationGeneration,
    rootPath: "/workspace",
    status: "started",
  });
}
