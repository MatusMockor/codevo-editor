import { describe, expect, it } from "vitest";
import {
  isLargeSmartDocument,
  isLargeSmartDocumentContent,
  largeSmartDocumentStatus,
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
    expect(
      isLargeSmartDocumentContent(
        "x".repeat(LARGE_SMART_DOCUMENT_CHARACTER_LIMIT + 1),
      ),
    ).toBe(true);
  });

  it("degrades documents that exceed the line limit without splitting", () => {
    expect(
      isLargeSmartDocumentContent("\n".repeat(LARGE_SMART_DOCUMENT_LINE_LIMIT)),
    ).toBe(true);
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
