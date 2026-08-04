import { describe, expect, it } from "vitest";
import {
  classifyJavaScriptTypeScriptLargeDocumentCapability,
  classifyJavaScriptTypeScriptLargeDocumentCapabilityFromMetrics,
  MAX_JAVA_SCRIPT_TYPE_SCRIPT_FULL_SYNC_UTF16_UNITS,
  MAX_JAVA_SCRIPT_TYPE_SCRIPT_FULL_SYNC_UTF8_BYTES,
} from "./javaScriptTypeScriptLargeDocumentCapability";
import {
  LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
  LARGE_SMART_DOCUMENT_LINE_LIMIT,
  MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
  MIN_LARGE_SMART_DOCUMENT_LINE_LIMIT,
} from "./largeDocumentPolicy";

describe("javaScriptTypeScriptLargeDocumentCapability", () => {
  it("keeps an ordinary document on the full capability tier", () => {
    expect(
      classifyJavaScriptTypeScriptLargeDocumentCapability("export const answer = 42;\n"),
    ).toEqual({
      kind: "full",
    });
  });

  it("keeps policy-large content interactive while it fits bounded full sync", () => {
    expect(
      classifyJavaScriptTypeScriptLargeDocumentCapability(
        "x".repeat(LARGE_SMART_DOCUMENT_CHARACTER_LIMIT + 1),
      ),
    ).toEqual({
      kind: "editing-degraded-interactive-lsp",
      reason: "character-limit",
    });
    expect(
      classifyJavaScriptTypeScriptLargeDocumentCapability(
        "\n".repeat(LARGE_SMART_DOCUMENT_LINE_LIMIT),
      ),
    ).toEqual({
      kind: "editing-degraded-interactive-lsp",
      reason: "line-limit",
    });
  });

  it("uses the normalized workspace policy without weakening hard sync admission", () => {
    const content = "x".repeat(MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT + 1);

    expect(
      classifyJavaScriptTypeScriptLargeDocumentCapability(content, {
        characterLimit: MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
        lineLimit: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({
      kind: "editing-degraded-interactive-lsp",
      reason: "character-limit",
    });
  });

  it("admits the exact UTF-16 boundary and rejects one unit beyond it", () => {
    const exactBoundary = "x".repeat(MAX_JAVA_SCRIPT_TYPE_SCRIPT_FULL_SYNC_UTF16_UNITS);

    expect(classifyJavaScriptTypeScriptLargeDocumentCapability(exactBoundary)).toEqual({
      kind: "editing-degraded-interactive-lsp",
      reason: "character-limit",
    });
    expect(classifyJavaScriptTypeScriptLargeDocumentCapability(`${exactBoundary}x`)).toEqual({
      kind: "editing-only",
      reason: "full-sync-utf16-limit",
    });
  });

  it("rejects over-limit content before malformed Unicode inspection", () => {
    expect(
      classifyJavaScriptTypeScriptLargeDocumentCapability(
        `${"x".repeat(MAX_JAVA_SCRIPT_TYPE_SCRIPT_FULL_SYNC_UTF16_UNITS)}\ud800`,
      ),
    ).toEqual({
      kind: "editing-only",
      reason: "full-sync-utf16-limit",
    });
  });

  it("measures non-ASCII UTF-8 bytes and admits the exact wire boundary", () => {
    const exactUtf8Boundary = "€".repeat(MAX_JAVA_SCRIPT_TYPE_SCRIPT_FULL_SYNC_UTF16_UNITS);

    expect(exactUtf8Boundary.length).toBe(MAX_JAVA_SCRIPT_TYPE_SCRIPT_FULL_SYNC_UTF16_UNITS);
    expect(new TextEncoder().encode(exactUtf8Boundary)).toHaveLength(
      MAX_JAVA_SCRIPT_TYPE_SCRIPT_FULL_SYNC_UTF8_BYTES,
    );
    expect(classifyJavaScriptTypeScriptLargeDocumentCapability(exactUtf8Boundary)).toEqual({
      kind: "editing-degraded-interactive-lsp",
      reason: "character-limit",
    });
  });

  it.each([null, undefined, 42, {}, ["text"]])(
    "fails closed for invalid content: %j",
    (content) => {
      expect(classifyJavaScriptTypeScriptLargeDocumentCapability(content)).toEqual({
        kind: "editing-only",
        reason: "invalid-content",
      });
    },
  );

  it.each(["\ud800", "\udc00", "valid\ud800text", "valid\udc00text"])(
    "fails closed for malformed Unicode: %j",
    (content) => {
      expect(classifyJavaScriptTypeScriptLargeDocumentCapability(content)).toEqual({
        kind: "editing-only",
        reason: "invalid-content",
      });
    },
  );

  it("classifies supplied metrics without reading document content", () => {
    let lineCountReads = 0;
    let utf16LengthReads = 0;
    let contentReads = 0;
    const metrics = {
      get content() {
        contentReads += 1;
        throw new Error("Metrics classification must not read content.");
      },
      get lineCount() {
        lineCountReads += 1;
        return LARGE_SMART_DOCUMENT_LINE_LIMIT + 1;
      },
      get utf16Length() {
        utf16LengthReads += 1;
        return LARGE_SMART_DOCUMENT_LINE_LIMIT;
      },
    };

    expect(classifyJavaScriptTypeScriptLargeDocumentCapabilityFromMetrics(metrics)).toEqual({
      kind: "editing-degraded-interactive-lsp",
      reason: "line-limit",
    });
    expect(lineCountReads).toBe(1);
    expect(utf16LengthReads).toBe(1);
    expect(contentReads).toBe(0);
  });

  it("pins exact smart-policy boundaries and character-reason precedence", () => {
    const policy = {
      characterLimit: MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
      lineLimit: MIN_LARGE_SMART_DOCUMENT_LINE_LIMIT,
    };

    expect(
      classifyJavaScriptTypeScriptLargeDocumentCapability(
        "x".repeat(MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT),
        policy,
      ),
    ).toEqual({ kind: "full" });
    expect(
      classifyJavaScriptTypeScriptLargeDocumentCapability(
        "x".repeat(MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT + 1),
        policy,
      ),
    ).toEqual({
      kind: "editing-degraded-interactive-lsp",
      reason: "character-limit",
    });
    expect(
      classifyJavaScriptTypeScriptLargeDocumentCapability(
        "\n".repeat(MIN_LARGE_SMART_DOCUMENT_LINE_LIMIT - 1),
        policy,
      ),
    ).toEqual({ kind: "full" });
    expect(
      classifyJavaScriptTypeScriptLargeDocumentCapability(
        "\n".repeat(MIN_LARGE_SMART_DOCUMENT_LINE_LIMIT),
        policy,
      ),
    ).toEqual({
      kind: "editing-degraded-interactive-lsp",
      reason: "line-limit",
    });
    expect(
      classifyJavaScriptTypeScriptLargeDocumentCapability(
        `${"\n".repeat(MIN_LARGE_SMART_DOCUMENT_LINE_LIMIT)}${"x".repeat(
          MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
        )}`,
        policy,
      ),
    ).toEqual({
      kind: "editing-degraded-interactive-lsp",
      reason: "character-limit",
    });
  });

  it("admits exact hard-sync metrics and rejects one UTF-16 unit beyond them", () => {
    expect(
      classifyJavaScriptTypeScriptLargeDocumentCapabilityFromMetrics({
        lineCount: 1,
        utf16Length: MAX_JAVA_SCRIPT_TYPE_SCRIPT_FULL_SYNC_UTF16_UNITS,
      }),
    ).toEqual({
      kind: "editing-degraded-interactive-lsp",
      reason: "character-limit",
    });
    expect(
      classifyJavaScriptTypeScriptLargeDocumentCapabilityFromMetrics({
        lineCount: 1,
        utf16Length: MAX_JAVA_SCRIPT_TYPE_SCRIPT_FULL_SYNC_UTF16_UNITS + 1,
      }),
    ).toEqual({
      kind: "editing-only",
      reason: "full-sync-utf16-limit",
    });
  });

  it.each([
    null,
    undefined,
    { lineCount: 0, utf16Length: 0 },
    { lineCount: 2, utf16Length: 0 },
    { lineCount: 1, utf16Length: -1 },
    { lineCount: 1.5, utf16Length: 1 },
    { lineCount: Number.MAX_SAFE_INTEGER + 1, utf16Length: 1 },
    { lineCount: 1, utf16Length: 0.5 },
    { lineCount: 1, utf16Length: Number.MAX_SAFE_INTEGER + 1 },
    { lineCount: 1, utf16Length: Number.POSITIVE_INFINITY },
  ])("fails closed for invalid metrics: %j", (metrics) => {
    expect(classifyJavaScriptTypeScriptLargeDocumentCapabilityFromMetrics(metrics)).toEqual({
      kind: "editing-only",
      reason: "invalid-metrics",
    });
  });

  it.each(["lineCount", "utf16Length"] as const)(
    "fails closed when the %s metric accessor throws",
    (throwingField) => {
      const metrics = {
        get lineCount() {
          if (throwingField === "lineCount") throw new Error("unavailable line count");
          return 1;
        },
        get utf16Length() {
          if (throwingField === "utf16Length") throw new Error("unavailable length");
          return 1;
        },
      };

      expect(classifyJavaScriptTypeScriptLargeDocumentCapabilityFromMetrics(metrics)).toEqual({
        kind: "editing-only",
        reason: "invalid-metrics",
      });
    },
  );

  it("returns immutable shared capability values", () => {
    const first = classifyJavaScriptTypeScriptLargeDocumentCapability("const value = 1;");
    const second = classifyJavaScriptTypeScriptLargeDocumentCapability("const value = 2;");

    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      (first as { kind: string }).kind = "editing-only";
    }).toThrow(TypeError);
  });
});
