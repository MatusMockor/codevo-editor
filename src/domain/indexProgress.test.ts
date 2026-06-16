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
      completedEvent({
        erroredEntries: 0,
        indexedFiles: 42,
        skippedEntries: 7,
      }),
    );

    expect(progress.status).toBe("completed");
    expect(progress.indexedFiles).toBe(42);
    expect(progress.skippedEntries).toBe(7);
    expect(indexProgressLabel(progress)).toBe("Index: 42 files");
    expect(progress.message).toBe("Indexed 42 files (7 skipped, 0 errors).");
  });

  it("labels completed scans with entry errors", () => {
    const event = completedEvent({
      erroredEntries: 2,
      indexedFiles: 8,
      skippedEntries: 3,
    });
    const progress = applyMetadataScanCompletion(initialIndexProgress(), event);

    expect(indexProgressLabel(progress)).toBe("Index: 8 files · 2 errors");
    expect(indexProgressNoticeSeverity(event)).toBe("warning");
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

function failedEvent(message: string): MetadataScanCompletionEvent {
  return {
    databasePath: "/config/index.sqlite3",
    message,
    report: null,
    rootPath: "/workspace",
    status: "failed",
  };
}
