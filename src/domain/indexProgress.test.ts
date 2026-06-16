import { describe, expect, it } from "vitest";
import {
  applyMetadataScanCompletion,
  indexProgressCompletionMessage,
  indexProgressLabel,
  indexProgressNoticeSeverity,
  initialIndexProgress,
  startIndexProgress,
  type MetadataScanCompletionEvent,
} from "./indexProgress";

describe("indexProgress", () => {
  it("tracks a started scan", () => {
    const progress = startIndexProgress({
      databasePath: "/config/index.sqlite3",
      rootPath: "/workspace",
      status: "started",
    });

    expect(progress).toEqual({
      databasePath: "/config/index.sqlite3",
      erroredEntries: 0,
      indexedFiles: 0,
      message: null,
      rootPath: "/workspace",
      skippedEntries: 0,
      status: "scanning",
    });
    expect(indexProgressLabel(progress)).toBe("Index: scanning");
  });

  it("applies completed scan counts", () => {
    const progress = applyMetadataScanCompletion(
      initialIndexProgress(),
      completedEvent(scanReport({
        erroredEntries: 0,
        indexedFiles: 42,
        skippedEntries: 7,
      })),
    );

    expect(progress.status).toBe("completed");
    expect(progress.indexedFiles).toBe(42);
    expect(progress.skippedEntries).toBe(7);
    expect(indexProgressLabel(progress)).toBe("Index: 42 files");
    expect(progress.message).toBe("Indexed 42 files (7 skipped, 0 errors).");
  });

  it("labels completed scans with entry errors", () => {
    const event = completedEvent(scanReport({
      erroredEntries: 2,
      indexedFiles: 8,
      skippedEntries: 3,
    }));
    const progress = applyMetadataScanCompletion(initialIndexProgress(), event);

    expect(indexProgressLabel(progress)).toBe("Index: 8 files · 2 errors");
    expect(indexProgressNoticeSeverity(event)).toBe("warning");
  });

  it("includes PHP symbol reindex counts in completion messages", () => {
    const event = completedEvent(scanReport({
      indexedFiles: 3,
      parsedFiles: 2,
      skippedEntries: 1,
      symbolsIndexed: 8,
    }));

    expect(indexProgressCompletionMessage(event)).toBe(
      "Indexed 3 files, parsed 2 PHP files, 8 symbols (1 skipped, 0 errors).",
    );
  });

  it("tracks failed scans", () => {
    const event = failedEvent("database locked");
    const progress = applyMetadataScanCompletion(initialIndexProgress(), event);

    expect(progress.status).toBe("failed");
    expect(progress.message).toBe("database locked");
    expect(indexProgressLabel(progress)).toBe("Index: failed");
    expect(indexProgressCompletionMessage(event)).toBe("database locked");
    expect(indexProgressNoticeSeverity(event)).toBe("error");
  });
});

function completedEvent(
  report: MetadataScanCompletionEvent["report"],
): MetadataScanCompletionEvent {
  return {
    databasePath: "/config/index.sqlite3",
    message: null,
    report,
    rootPath: "/workspace",
    status: "completed",
  };
}

function scanReport(
  overrides: Partial<NonNullable<MetadataScanCompletionEvent["report"]>>,
): NonNullable<MetadataScanCompletionEvent["report"]> {
  return {
    changedFiles: 0,
    erroredEntries: 0,
    indexedFiles: 0,
    parsedFiles: 0,
    removedFiles: 0,
    skippedEntries: 0,
    symbolsIndexed: 0,
    ...overrides,
  };
}

function failedEvent(message: string): MetadataScanCompletionEvent {
  return {
    databasePath: "/config/index.sqlite3",
    message,
    report: null,
    rootPath: "/workspace",
    status: "failed",
  };
}
