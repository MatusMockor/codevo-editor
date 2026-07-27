import { describe, expect, it, vi } from "vitest";
import canonicalDiagnosticsContract from "../../contracts/lsp-diagnostics-projection.json";
import {
  decodeLanguageServerDiagnosticEvent,
  LANGUAGE_SERVER_DIAGNOSTICS_CONTRACT_MANIFEST,
  languageServerDiagnosticNoticeGroup,
  languageServerDiagnosticNoticeMessage,
  languageServerDiagnosticNoticeSeverity,
  shouldApplyLanguageServerDiagnostics,
  type BoundedLanguageServerDiagnosticEvent,
  type LanguageServerDiagnostic,
  type LanguageServerDiagnosticWireEvent,
} from "./languageServerDiagnostics";

describe("languageServerDiagnostics", () => {
  it("matches the canonical Rust and TypeScript diagnostics contract manifest", () => {
    expect(LANGUAGE_SERVER_DIAGNOSTICS_CONTRACT_MANIFEST).toEqual(canonicalDiagnosticsContract);
  });

  it("maps diagnostic severities to problem severities", () => {
    expect(languageServerDiagnosticNoticeSeverity("error")).toBe("error");
    expect(languageServerDiagnosticNoticeSeverity("warning")).toBe("warning");
    expect(languageServerDiagnosticNoticeSeverity("information")).toBe("info");
    expect(languageServerDiagnosticNoticeSeverity("hint")).toBe("info");
  });

  it("formats one-based diagnostic locations", () => {
    expect(languageServerDiagnosticNoticeMessage(diagnostic(), "file:///tmp/User.php")).toBe(
      "file:///tmp/User.php 3:5 Unexpected token",
    );
  });

  it("builds stable notice groups per document uri", () => {
    expect(languageServerDiagnosticNoticeGroup("file:///tmp/User.php")).toBe(
      "language-server-diagnostics:file:///tmp/User.php",
    );
  });

  it("rejects diagnostics from stale sessions or older versions", () => {
    expect(shouldApplyLanguageServerDiagnostics(event(3), 1, 4)).toBe(false);
    expect(shouldApplyLanguageServerDiagnostics(event(4), 1, 4)).toBe(true);
    expect(shouldApplyLanguageServerDiagnostics(event(null), 1, 4)).toBe(true);
    expect(shouldApplyLanguageServerDiagnostics(event(4), 2, 4)).toBe(false);
  });

  it("applies a clear (count=0) carrying the analysis version already applied", () => {
    // BUG 1: phpactor publishes diagnostics asynchronously keyed by the analysis
    // version (here v1), NOT the live document version (v2 after a didChange).
    // A clear (count=0) arriving at v1 — equal to the last APPLIED diagnostic
    // version — must still be applied so the stale "1 error" marker disappears.
    const lastAppliedDiagnosticVersion = 1;
    expect(shouldApplyLanguageServerDiagnostics(event(1), 1, lastAppliedDiagnosticVersion)).toBe(
      true,
    );
  });

  it("applies a fresh phpactor publication newer than the last applied", () => {
    // No diagnostic applied yet (undefined) accepts any version.
    expect(shouldApplyLanguageServerDiagnostics(event(1), 1, undefined)).toBe(true);
    // A strictly newer analysis version is always applied.
    expect(shouldApplyLanguageServerDiagnostics(event(2), 1, 1)).toBe(true);
  });

  it("drops a diagnostic older than the last applied diagnostic version", () => {
    // Protection: once a v2 diagnostic has been applied, a late v1 publication
    // for the same document must be dropped so it cannot resurrect stale state.
    expect(shouldApplyLanguageServerDiagnostics(event(1), 1, 2)).toBe(false);
  });

  it("rejects diagnostics from another workspace root", () => {
    expect(
      shouldApplyLanguageServerDiagnostics(event(4, "/workspace-a/"), 1, 4, "/workspace-a"),
    ).toBe(true);
    expect(
      shouldApplyLanguageServerDiagnostics(event(4, "/workspace-a"), 1, 4, "/workspace-b"),
    ).toBe(false);
  });

  it("decodes a closed complete projection receipt", () => {
    const candidate = event(3);

    expectDecoded(candidate);
    expect(decodeLanguageServerDiagnosticEvent({ ...candidate, unexpected: true })).toBeNull();
    expect(
      decodeLanguageServerDiagnosticEvent({
        ...candidate,
        diagnostics: [{ ...diagnostic(), unexpected: true }],
      }),
    ).toBeNull();
  });

  it("decodes the native golden complete projection shape", () => {
    const diagnostics: LanguageServerDiagnostic[] = [
      {
        code: null,
        codeDescriptionHref: null,
        message: "x",
        severity: "error",
        source: null,
        tags: [],
        relatedInformation: [],
        line: 2,
        character: 3,
        endLine: 2,
        endCharacter: 4,
      },
    ];
    const golden: LanguageServerDiagnosticWireEvent = {
      rootPath: "/tmp",
      sessionId: 42,
      uri: "file:///tmp/golden.ts",
      version: 7,
      diagnostics,
      projection: {
        kind: "complete",
        publishedCount: 1,
        retainedCount: 1,
        severityCounts: { error: 1, warning: 0, information: 0, hint: 0 },
        retainedUtf8Bytes: utf8Bytes(diagnostics),
      },
    };

    expectDecoded(golden);
  });

  it("rejects malformed root, session, and version authority", () => {
    const valid = event(3);

    for (const candidate of [
      { ...valid, rootPath: "" },
      { ...valid, sessionId: 0 },
      { ...valid, sessionId: 1.5 },
      { ...valid, version: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(decodeLanguageServerDiagnosticEvent(candidate)).toBeNull();
    }
    expectDecoded({ ...valid, version: -1 });
  });

  it("accepts a truthful bounded truncated receipt", () => {
    const diagnostics = [diagnostic()];
    const candidate: LanguageServerDiagnosticWireEvent = {
      diagnostics,
      rootPath: "/tmp",
      sessionId: 1,
      uri: "file:///tmp/User.php",
      version: 3,
      projection: {
        kind: "truncated",
        publishedCount: 3,
        retainedCount: 1,
        severityCounts: {
          error: 1,
          warning: 2,
          information: 0,
          hint: 0,
        },
        retainedUtf8Bytes: utf8Bytes(diagnostics),
        omittedCount: 2,
        reasons: ["itemLimit", "fieldLimit"],
        sanitizedFieldCount: 1,
      },
    };

    expectDecoded(candidate);
  });

  it("rejects inconsistent receipts so malformed empty events cannot clear diagnostics", () => {
    const empty = eventWithDiagnostics([], 3);

    expect(
      decodeLanguageServerDiagnosticEvent({
        ...empty,
        projection: { ...empty.projection, publishedCount: 1 },
      }),
    ).toBeNull();
    expect(
      decodeLanguageServerDiagnosticEvent({
        ...empty,
        projection: { ...empty.projection, retainedUtf8Bytes: 0 },
      }),
    ).toBeNull();
    expect(
      decodeLanguageServerDiagnosticEvent({
        ...empty,
        projection: {
          kind: "truncated",
          publishedCount: 0,
          retainedCount: 0,
          severityCounts: { error: 0, warning: 0, information: 0, hint: 0 },
          retainedUtf8Bytes: utf8Bytes([]),
          omittedCount: 0,
          reasons: ["fieldLimit"],
          sanitizedFieldCount: 1,
        },
      }),
    ).toBeNull();
  });

  it("rejects oversized and deeply nested diagnostic fields", () => {
    const oversized = eventWithDiagnostics(
      [{ ...diagnostic(), message: "x".repeat(8 * 1_024 + 1) }],
      3,
    );
    const deep = nestedData(17);
    const deeplyNested = eventWithDiagnostics([{ ...diagnostic(), data: deep }], 3);

    expect(decodeLanguageServerDiagnosticEvent(oversized)).toBeNull();
    expect(decodeLanguageServerDiagnosticEvent(deeplyNested)).toBeNull();
  });

  it("accepts JSON numbers but rejects data containers outside native projection bounds", () => {
    const rustNumericData: unknown = JSON.parse('{"ratio":1.0,"magnitude":1e+20,"confidence":0.5}');
    const decimalData = eventWithDiagnostics([{ ...diagnostic(), data: rustNumericData }], 3);
    const tooManyItems = eventWithDiagnostics(
      [
        {
          ...diagnostic(),
          data: Array.from({ length: 257 }, (_, index) => index),
        },
      ],
      3,
    );
    const oversizedDataField = eventWithDiagnostics(
      [{ ...diagnostic(), data: "x".repeat(513) }],
      3,
    );
    // serde_json retains spellings such as `1.0` and exponent notation while
    // JSON.stringify canonicalizes them differently after Tauri deserializes
    // the payload. Both independently measured byte counts remain bounded.
    decimalData.projection.retainedUtf8Bytes -= 10;

    const decodedNumericData = expectDecoded(decimalData);
    expect(decodedNumericData.projection.retainedUtf8Bytes).toBeLessThan(
      decodedNumericData.projection.decodedUtf8Bytes,
    );
    expect(decodeLanguageServerDiagnosticEvent(tooManyItems)).toBeNull();
    expect(decodeLanguageServerDiagnosticEvent(oversizedDataField)).toBeNull();
  });

  it("matches the native UTF-8 field and depth boundaries", () => {
    const belowMessage = eventWithDiagnostics(
      [{ ...diagnostic(), message: "m".repeat(8 * 1_024 - 1) }],
      3,
    );
    const exactMessage = eventWithDiagnostics(
      [{ ...diagnostic(), message: "é".repeat((8 * 1_024) / 2) }],
      3,
    );
    const overMessage = eventWithDiagnostics(
      [{ ...diagnostic(), message: "m".repeat(8 * 1_024 + 1) }],
      3,
    );
    const belowShortField = eventWithDiagnostics([{ ...diagnostic(), source: "s".repeat(511) }], 3);
    const exactShortField = eventWithDiagnostics([{ ...diagnostic(), source: "s".repeat(512) }], 3);
    const overShortField = eventWithDiagnostics([{ ...diagnostic(), source: "s".repeat(513) }], 3);
    const belowDepth = eventWithDiagnostics([{ ...diagnostic(), data: nestedData(15) }], 3);
    const exactDepth = eventWithDiagnostics([{ ...diagnostic(), data: nestedData(16) }], 3);
    const overDepth = eventWithDiagnostics([{ ...diagnostic(), data: nestedData(17) }], 3);
    const uriPrefix = "file:///";
    const exactUri = event(3);
    exactUri.uri = `${uriPrefix}${"u".repeat(16 * 1_024 - uriPrefix.length)}`;
    const overUri = event(3);
    overUri.uri = `${exactUri.uri}u`;

    expectDecoded(belowMessage);
    expectDecoded(exactMessage);
    expect(decodeLanguageServerDiagnosticEvent(overMessage)).toBeNull();
    expectDecoded(belowShortField);
    expectDecoded(exactShortField);
    expect(decodeLanguageServerDiagnosticEvent(overShortField)).toBeNull();
    expectDecoded(belowDepth);
    expectDecoded(exactDepth);
    expect(decodeLanguageServerDiagnosticEvent(overDepth)).toBeNull();
    expectDecoded(exactUri);
    expect(decodeLanguageServerDiagnosticEvent(overUri)).toBeNull();
  });

  it("rejects impossible severity receipts and loss reasons", () => {
    const base = event(3);

    expect(
      decodeLanguageServerDiagnosticEvent({
        ...base,
        projection: {
          kind: "truncated",
          publishedCount: 2,
          retainedCount: 1,
          severityCounts: { error: 0, warning: 2, information: 0, hint: 0 },
          retainedUtf8Bytes: base.projection.retainedUtf8Bytes,
          omittedCount: 1,
          reasons: ["itemLimit"],
          sanitizedFieldCount: 0,
        },
      }),
    ).toBeNull();
    expect(
      decodeLanguageServerDiagnosticEvent({
        ...base,
        projection: {
          kind: "truncated",
          publishedCount: 2,
          retainedCount: 1,
          severityCounts: { error: 2, warning: 0, information: 0, hint: 0 },
          retainedUtf8Bytes: base.projection.retainedUtf8Bytes,
          omittedCount: 1,
          reasons: ["fieldLimit"],
          sanitizedFieldCount: 1,
        },
      }),
    ).toBeNull();
  });

  it("rejects reversed or unsafe ranges and malformed diagnostic URIs", () => {
    expect(
      decodeLanguageServerDiagnosticEvent(
        eventWithDiagnostics([{ ...diagnostic(), endLine: 1, endCharacter: 4 }], 3),
      ),
    ).toBeNull();
    expect(
      decodeLanguageServerDiagnosticEvent(
        eventWithDiagnostics([{ ...diagnostic(), line: 2_147_483_648 }], 3),
      ),
    ).toBeNull();
    expect(
      decodeLanguageServerDiagnosticEvent(
        eventWithDiagnostics([{ ...diagnostic(), codeDescriptionHref: "not a URI" }], 3),
      ),
    ).toBeNull();
    expect(
      decodeLanguageServerDiagnosticEvent(
        eventWithDiagnostics([{ ...diagnostic(), codeDescriptionHref: "http://[bad]" }], 3),
      ),
    ).toBeNull();
    expect(
      decodeLanguageServerDiagnosticEvent({
        ...event(3),
        uri: "not a URI",
      }),
    ).toBeNull();
  });

  it("matches the native related-information item boundary", () => {
    const related = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        uri: `file:///tmp/related-${index}.ts`,
        message: "Related",
        line: index,
        character: 0,
        endLine: index,
        endCharacter: 1,
      }));
    const below = eventWithDiagnostics([{ ...diagnostic(), relatedInformation: related(15) }], 3);
    const exact = eventWithDiagnostics([{ ...diagnostic(), relatedInformation: related(16) }], 3);
    const over = eventWithDiagnostics([{ ...diagnostic(), relatedInformation: related(17) }], 3);

    expectDecoded(below);
    expectDecoded(exact);
    expect(decodeLanguageServerDiagnosticEvent(over)).toBeNull();
  });

  it("rejects diagnostic item and aggregate byte exhaustion before projection", () => {
    const tooMany = event(3);
    tooMany.diagnostics = Array.from({ length: 2_001 }, () => diagnostic());
    const tooManyBytes = event(3);
    tooManyBytes.diagnostics = Array.from({ length: 257 }, () => ({
      ...diagnostic(),
      message: "m".repeat(8 * 1_024),
    }));

    expect(decodeLanguageServerDiagnosticEvent(tooMany)).toBeNull();
    expect(decodeLanguageServerDiagnosticEvent(tooManyBytes)).toBeNull();
  });

  it("serializes a near-2MiB 2k diagnostic array only once", () => {
    const dataLeaf = "perf-data";
    const diagnostics = Array.from({ length: 2_000 }, () => ({
      ...diagnostic(),
      data: { nested: { label: dataLeaf, values: [1, 2, 3] } },
      message: "m".repeat(800),
    }));
    const candidate = eventWithDiagnostics(diagnostics, 3);
    const expectedDecodedUtf8Bytes = candidate.projection.retainedUtf8Bytes;
    expect(expectedDecodedUtf8Bytes).toBeGreaterThan(2_000_000);
    expect(expectedDecodedUtf8Bytes).toBeLessThanOrEqual(2 * 1_024 * 1_024);
    const stringify = vi.spyOn(JSON, "stringify");
    const encode = vi.spyOn(TextEncoder.prototype, "encode");

    try {
      const decoded = decodeLanguageServerDiagnosticEvent(candidate);
      expect(decoded?.projection.decodedUtf8Bytes).toBe(expectedDecodedUtf8Bytes);

      const wholeArrayStringifications = stringify.mock.calls.filter(
        ([value]) => value === diagnostics,
      );
      const wholeArrayEncodes = encode.mock.calls.filter(
        ([value]) => typeof value === "string" && value.length > 2_000_000,
      );
      expect(wholeArrayStringifications).toHaveLength(1);
      expect(wholeArrayEncodes).toHaveLength(1);
      expect(encode.mock.calls.filter(([value]) => value === dataLeaf)).toHaveLength(0);
    } finally {
      stringify.mockRestore();
      encode.mockRestore();
    }
  });

  it("owns a bounded clone of nested diagnostic data", () => {
    const originalData = {
      nested: {
        label: "original",
        values: [1, 2, 3],
      },
    };
    const candidate = eventWithDiagnostics([{ ...diagnostic(), data: originalData }], 3);
    const decoded = expectDecoded(candidate);
    const decodedData = decoded.diagnostics[0]?.data as {
      nested: { label: string; values: number[] };
    };

    expect(decodedData).not.toBe(originalData);
    expect(decodedData.nested).not.toBe(originalData.nested);
    originalData.nested.label = "mutated";
    originalData.nested.values.push(4);

    expect(decodedData).toEqual({
      nested: {
        label: "original",
        values: [1, 2, 3],
      },
    });
  });

  it("rejects unsorted, duplicate, or unknown truncation reasons", () => {
    const base = event(3);
    const truncated = {
      kind: "truncated",
      publishedCount: 2,
      retainedCount: 1,
      severityCounts: { error: 2, warning: 0, information: 0, hint: 0 },
      retainedUtf8Bytes: base.projection.retainedUtf8Bytes,
      omittedCount: 1,
      sanitizedFieldCount: 0,
    };

    for (const reasons of [["fieldLimit", "itemLimit"], ["itemLimit", "itemLimit"], ["unknown"]]) {
      expect(
        decodeLanguageServerDiagnosticEvent({
          ...base,
          projection: { ...truncated, reasons },
        }),
      ).toBeNull();
    }
  });

  it("accepts truthful authority-budget exhaustion reasons", () => {
    const base = event(3);

    for (const reason of ["authorityNodeLimit", "pathProbeLimit"] as const) {
      expectDecoded({
        ...base,
        projection: {
          kind: "truncated",
          publishedCount: 1,
          retainedCount: 1,
          omittedCount: 0,
          severityCounts: { error: 1, warning: 0, information: 0, hint: 0 },
          retainedUtf8Bytes: base.projection.retainedUtf8Bytes,
          reasons: [reason],
          sanitizedFieldCount: 1,
        },
      });
    }
  });
});

function expectDecoded(
  candidate: LanguageServerDiagnosticWireEvent,
): BoundedLanguageServerDiagnosticEvent {
  const decoded = decodeLanguageServerDiagnosticEvent(candidate);
  expect(decoded).toEqual({
    ...candidate,
    projection: {
      ...candidate.projection,
      decodedUtf8Bytes: utf8Bytes(candidate.diagnostics),
    },
  });
  return decoded as BoundedLanguageServerDiagnosticEvent;
}

function diagnostic(): LanguageServerDiagnostic {
  return {
    code: null,
    codeDescriptionHref: null,
    character: 4,
    endCharacter: 5,
    endLine: 2,
    line: 2,
    message: "Unexpected token",
    relatedInformation: [],
    severity: "error",
    source: "phpactor",
    tags: [],
  };
}

function event(version: number | null, rootPath = "/tmp"): LanguageServerDiagnosticWireEvent {
  return eventWithDiagnostics([diagnostic()], version, rootPath);
}

function eventWithDiagnostics(
  diagnostics: LanguageServerDiagnostic[],
  version: number | null,
  rootPath = "/tmp",
): LanguageServerDiagnosticWireEvent {
  return {
    diagnostics,
    rootPath,
    sessionId: 1,
    uri: "file:///tmp/User.php",
    version,
    projection: {
      kind: "complete",
      publishedCount: diagnostics.length,
      retainedCount: diagnostics.length,
      severityCounts: diagnostics.reduce(
        (counts, item) => ({ ...counts, [item.severity]: counts[item.severity] + 1 }),
        { error: 0, warning: 0, information: 0, hint: 0 },
      ),
      retainedUtf8Bytes: utf8Bytes(diagnostics),
    },
  };
}

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function nestedData(depth: number): unknown {
  return Array.from({ length: depth }).reduce<unknown>((value) => ({ value }), "leaf");
}
