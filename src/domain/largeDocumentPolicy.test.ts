import { describe, expect, it } from "vitest";
import {
  isLargeSmartDocument,
  isLargeSmartDocumentContent,
  largeSmartDocumentStatus,
  largeSmartDocumentStatusFromMetrics,
  LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
  MAX_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
  LARGE_SMART_DOCUMENT_STATUS_LABEL,
  LARGE_SMART_DOCUMENT_STATUS_TITLE,
  LARGE_SMART_DOCUMENT_LINE_LIMIT,
  MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
  MIN_LARGE_SMART_DOCUMENT_LINE_LIMIT,
  normalizeLargeSmartDocumentPolicy,
} from "./largeDocumentPolicy";

describe("largeDocumentPolicy", () => {
  it("keeps normal documents eligible for smart features", () => {
    expect(isLargeSmartDocumentContent("<?php\nclass User {}\n")).toBe(false);
  });

  it("degrades documents that exceed the character limit", () => {
    expect(isLargeSmartDocumentContent("x".repeat(LARGE_SMART_DOCUMENT_CHARACTER_LIMIT + 1))).toBe(
      true,
    );
  });

  it("degrades documents that exceed the line limit without splitting", () => {
    expect(isLargeSmartDocumentContent("\n".repeat(LARGE_SMART_DOCUMENT_LINE_LIMIT))).toBe(true);
  });

  it("accepts document-like objects", () => {
    expect(isLargeSmartDocument({ content: "x" })).toBe(false);
  });

  it("uses custom limits when classifying documents", () => {
    const policy = {
      characterLimit: MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
      lineLimit: LARGE_SMART_DOCUMENT_LINE_LIMIT,
    };
    const content = "x".repeat(MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT + 1);

    expect(isLargeSmartDocumentContent(content)).toBe(false);
    expect(isLargeSmartDocumentContent(content, policy)).toBe(true);
  });

  it("does not show a large file status for normal or missing documents", () => {
    expect(largeSmartDocumentStatus({ content: "x" })).toBeNull();
    expect(largeSmartDocumentStatus(null)).toBeNull();
  });

  it("returns a stable large file status for documents over policy", () => {
    expect(
      largeSmartDocumentStatus({
        content: "x".repeat(LARGE_SMART_DOCUMENT_CHARACTER_LIMIT + 1),
      }),
    ).toEqual({
      label: LARGE_SMART_DOCUMENT_STATUS_LABEL,
      title: LARGE_SMART_DOCUMENT_STATUS_TITLE,
    });
  });

  it("describes custom policy thresholds in the status title", () => {
    expect(
      largeSmartDocumentStatus(
        {
          content: "x".repeat(MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT + 1),
        },
        {
          characterLimit: MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
          lineLimit: MIN_LARGE_SMART_DOCUMENT_LINE_LIMIT,
        },
      ),
    ).toEqual({
      label: LARGE_SMART_DOCUMENT_STATUS_LABEL,
      title:
        "Large file mode: smart analysis is limited for the active file over 16 KB or 500 lines.",
    });
  });

  it.each([
    {
      content: "",
      expectedKind: "eligible",
      name: "empty content",
    },
    {
      content: "😀".repeat(LARGE_SMART_DOCUMENT_CHARACTER_LIMIT / 2),
      expectedKind: "eligible",
      name: "astral unicode exactly at the UTF-16 limit",
    },
    {
      content: `${"😀".repeat(LARGE_SMART_DOCUMENT_CHARACTER_LIMIT / 2)}x`,
      expectedKind: "large",
      name: "astral unicode over the UTF-16 limit",
    },
    {
      content: "\n".repeat(LARGE_SMART_DOCUMENT_LINE_LIMIT - 1),
      expectedKind: "eligible",
      name: "exactly the line limit",
    },
    {
      content: "\n".repeat(LARGE_SMART_DOCUMENT_LINE_LIMIT),
      expectedKind: "large",
      name: "over the line limit",
    },
    {
      content: "\r".repeat(LARGE_SMART_DOCUMENT_LINE_LIMIT),
      expectedKind: "eligible",
      name: "bare carriage returns",
    },
    {
      content: "\r\n".repeat(LARGE_SMART_DOCUMENT_LINE_LIMIT),
      expectedKind: "large",
      name: "CRLF line endings",
    },
    {
      content: "\u2028".repeat(LARGE_SMART_DOCUMENT_LINE_LIMIT),
      expectedKind: "eligible",
      name: "unicode line separators",
    },
  ])("matches content classification for $name", ({ content, expectedKind }) => {
    const result = largeSmartDocumentStatusFromMetrics({
      lineCount: content.split("\n").length,
      utf16Length: content.length,
    });

    expect(result.kind).toBe(expectedKind);
    expect(result.kind === "large").toBe(isLargeSmartDocumentContent(content));
  });

  it("uses the same strict custom-policy boundaries as the content scanner", () => {
    const policy = {
      characterLimit: MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
      lineLimit: MIN_LARGE_SMART_DOCUMENT_LINE_LIMIT,
    };

    expect(
      largeSmartDocumentStatusFromMetrics(
        {
          lineCount: MIN_LARGE_SMART_DOCUMENT_LINE_LIMIT,
          utf16Length: MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
        },
        policy,
      ),
    ).toEqual({
      kind: "eligible",
      status: null,
    });
    expect(
      largeSmartDocumentStatusFromMetrics(
        {
          lineCount: MIN_LARGE_SMART_DOCUMENT_LINE_LIMIT,
          utf16Length: MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT + 1,
        },
        policy,
      ),
    ).toEqual({
      kind: "large",
      reason: "character-limit",
      status: {
        label: LARGE_SMART_DOCUMENT_STATUS_LABEL,
        title:
          "Large file mode: smart analysis is limited for the active file over 16 KB or 500 lines.",
      },
    });
    expect(
      largeSmartDocumentStatusFromMetrics(
        {
          lineCount: MIN_LARGE_SMART_DOCUMENT_LINE_LIMIT + 1,
          utf16Length: MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
        },
        policy,
      ).kind,
    ).toBe("large");
  });

  it.each([
    null,
    undefined,
    { lineCount: 0, utf16Length: 0 },
    { lineCount: -1, utf16Length: 0 },
    { lineCount: 1.5, utf16Length: 0 },
    { lineCount: Number.POSITIVE_INFINITY, utf16Length: 0 },
    { lineCount: LARGE_SMART_DOCUMENT_LINE_LIMIT, utf16Length: 0 },
    { lineCount: 2, utf16Length: 0 },
    { lineCount: 1, utf16Length: -1 },
    { lineCount: 1, utf16Length: 0.5 },
    { lineCount: 1, utf16Length: Number.MAX_SAFE_INTEGER + 1 },
  ])("fails closed for unavailable or invalid metrics: %j", (metrics) => {
    expect(largeSmartDocumentStatusFromMetrics(metrics)).toEqual({
      kind: "degraded",
      reason: "invalid-metrics",
      status: {
        label: LARGE_SMART_DOCUMENT_STATUS_LABEL,
        title:
          "Large file mode: smart analysis is limited because exact file metrics are unavailable.",
      },
    });
  });

  it("does constant work from supplied metrics without reading content", () => {
    let lineCountReads = 0;
    let utf16LengthReads = 0;
    let contentReads = 0;
    const metrics = {
      get content() {
        contentReads += 1;
        throw new Error("Metric classification must not inspect content.");
      },
      get lineCount() {
        lineCountReads += 1;
        return 42;
      },
      get utf16Length() {
        utf16LengthReads += 1;
        return 1_000_000;
      },
    };

    for (let index = 0; index < 100; index += 1) {
      expect(largeSmartDocumentStatusFromMetrics(metrics).kind).toBe("large");
    }

    expect(lineCountReads).toBe(100);
    expect(utf16LengthReads).toBe(100);
    expect(contentReads).toBe(0);
  });

  it("keeps shared default-policy status immutable across calls", () => {
    const metrics = {
      lineCount: 1,
      utf16Length: LARGE_SMART_DOCUMENT_CHARACTER_LIMIT + 1,
    };
    const first = largeSmartDocumentStatusFromMetrics(metrics);

    expect(first.kind).toBe("large");
    if (first.kind !== "large") {
      throw new Error("Expected large metrics.");
    }
    expect(Object.isFrozen(first.status)).toBe(true);
    expect(() => {
      (first.status as { title: string }).title = "poisoned";
    }).toThrow(TypeError);

    const second = largeSmartDocumentStatusFromMetrics(metrics);
    expect(second.kind).toBe("large");
    if (second.kind !== "large") {
      throw new Error("Expected large metrics.");
    }
    expect(second.status).toBe(first.status);
    expect(second.status.title).toBe(LARGE_SMART_DOCUMENT_STATUS_TITLE);
  });

  it("normalizes configured limits into a safe range", () => {
    expect(
      normalizeLargeSmartDocumentPolicy({
        characterLimit: 1,
        lineLimit: 1,
      }),
    ).toEqual({
      characterLimit: MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
      lineLimit: MIN_LARGE_SMART_DOCUMENT_LINE_LIMIT,
    });

    expect(
      normalizeLargeSmartDocumentPolicy({
        characterLimit: MAX_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT + 1,
        lineLimit: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({
      characterLimit: MAX_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
      lineLimit: LARGE_SMART_DOCUMENT_LINE_LIMIT,
    });
  });
});
