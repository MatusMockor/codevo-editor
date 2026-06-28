import { describe, expect, it } from "vitest";
import { createDocumentHighlightRequestTracker } from "./documentHighlightRequestTracker";

describe("createDocumentHighlightRequestTracker", () => {
  it("returns undefined until a request is remembered", () => {
    const tracker = createDocumentHighlightRequestTracker<number>();

    expect(tracker.cached("/a.ts", "user", 1)).toBeUndefined();
  });

  it("returns cached highlights for the same uri, word and version", () => {
    const tracker = createDocumentHighlightRequestTracker<number>();

    tracker.remember("/a.ts", "user", 1, [10, 20]);

    expect(tracker.cached("/a.ts", "user", 1)).toEqual([10, 20]);
  });

  it("misses when the word under the cursor changes", () => {
    const tracker = createDocumentHighlightRequestTracker<number>();

    tracker.remember("/a.ts", "user", 1, [10]);

    expect(tracker.cached("/a.ts", "account", 1)).toBeUndefined();
  });

  it("misses when the document version changes so stale ranges are not reused", () => {
    const tracker = createDocumentHighlightRequestTracker<number>();

    tracker.remember("/a.ts", "user", 1, [10]);

    expect(tracker.cached("/a.ts", "user", 2)).toBeUndefined();
  });

  it("keeps entries isolated per document uri", () => {
    const tracker = createDocumentHighlightRequestTracker<number>();

    tracker.remember("/a.ts", "user", 1, [10]);
    tracker.remember("/b.ts", "user", 1, [20]);

    expect(tracker.cached("/a.ts", "user", 1)).toEqual([10]);
    expect(tracker.cached("/b.ts", "user", 1)).toEqual([20]);
  });

  it("forgets a cached entry on demand", () => {
    const tracker = createDocumentHighlightRequestTracker<number>();

    tracker.remember("/a.ts", "user", 1, [10]);
    tracker.forget("/a.ts");

    expect(tracker.cached("/a.ts", "user", 1)).toBeUndefined();
  });
});
