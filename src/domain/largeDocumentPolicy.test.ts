import { describe, expect, it } from "vitest";
import {
  isLargeSmartDocument,
  isLargeSmartDocumentContent,
  LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
  LARGE_SMART_DOCUMENT_LINE_LIMIT,
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
});
