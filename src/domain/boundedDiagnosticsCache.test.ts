import { describe, expect, it, vi } from "vitest";
import type { LanguageServerDiagnostic } from "./languageServerDiagnostics";
import {
  applyBoundedDiagnosticsCacheBatch,
  DIAGNOSTICS_CACHE_MAX_DIAGNOSTICS,
  DIAGNOSTICS_CACHE_MAX_LEDGER_PATHS,
  DIAGNOSTICS_CACHE_MAX_NONEMPTY_FILES,
  DIAGNOSTICS_CACHE_MAX_UTF8_BYTES,
} from "./boundedDiagnosticsCache";

function diagnostic(index: number, message = `diagnostic-${index}`): LanguageServerDiagnostic {
  return {
    character: 0,
    line: index,
    message,
    severity: "error",
    source: "test",
  };
}

describe("applyBoundedDiagnosticsCacheBatch", () => {
  it("applies 10k paths in one bounded projection without retaining empty keys", () => {
    const updates = Array.from({ length: 10_000 }, (_, index) => ({
      diagnostics: index % 2 === 0 ? [diagnostic(index)] : [],
      path: `/workspace/file-${index}.ts`,
      publishedCount: index % 2 === 0 ? 1 : 0,
    }));

    const result = applyBoundedDiagnosticsCacheBatch({}, updates);

    expect(Object.keys(result.byPath)).toHaveLength(DIAGNOSTICS_CACHE_MAX_NONEMPTY_FILES);
    expect(Object.values(result.byPath).every((items) => items.length > 0)).toBe(true);
    expect(Object.keys(result.byPath)[0]).toBe("/workspace/file-6000.ts");
    expect(result.receipt.retainedCount).toBe(DIAGNOSTICS_CACHE_MAX_NONEMPTY_FILES);
    expect(result.receipt.retainedUtf8Bytes).toBeLessThanOrEqual(DIAGNOSTICS_CACHE_MAX_UTF8_BYTES);
  });

  it("keeps a truthful aggregate after 100k paths exceed the bounded ledger", () => {
    const result = applyBoundedDiagnosticsCacheBatch(
      {},
      Array.from({ length: 100_000 }, (_, index) => ({
        diagnostics: [diagnostic(index)],
        path: `/workspace/mass-${index}.ts`,
        publishedCount: 1,
      })),
    );

    expect(result.receipt).toMatchObject({
      omittedCount: 98_000,
      publishedCount: 100_000,
      publishedCountKind: "upperBound",
      retainedCount: 2_000,
      truncated: true,
    });
    expect(Object.keys(result.publishedCountByPath)).toHaveLength(
      DIAGNOSTICS_CACHE_MAX_LEDGER_PATHS,
    );
    expect(result.untrackedPublishedCount).toBe(80_000);

    const clearedUntracked = applyBoundedDiagnosticsCacheBatch(
      result.byPath,
      Array.from({ length: 10 }, (_, index) => ({
        diagnostics: [],
        path: `/workspace/mass-${index}.ts`,
        publishedCount: 0,
      })),
      {
        publishedCount: result.receipt.publishedCount,
        publishedCountByPath: result.publishedCountByPath,
        untrackedPublishedCount: result.untrackedPublishedCount,
      },
    );
    expect(clearedUntracked.receipt.publishedCountKind).toBe("upperBound");
    expect(clearedUntracked.receipt.publishedCount).toBe(100_000);
  });

  it("trims an over-cap incoming ledger before an empty update batch returns", () => {
    const currentPath = "/workspace/ledger-0.ts";
    const publishedCountByPath = Object.fromEntries(
      Array.from({ length: DIAGNOSTICS_CACHE_MAX_LEDGER_PATHS + 1 }, (_, index) => [
        `/workspace/ledger-${index}.ts`,
        1,
      ]),
    );

    const result = applyBoundedDiagnosticsCacheBatch({ [currentPath]: [diagnostic(0)] }, [], {
      publishedCount: DIAGNOSTICS_CACHE_MAX_LEDGER_PATHS + 1,
      publishedCountByPath,
      untrackedPublishedCount: 0,
    });

    expect(Object.keys(result.publishedCountByPath).length).toBeLessThanOrEqual(
      DIAGNOSTICS_CACHE_MAX_LEDGER_PATHS,
    );
  });

  it("keeps a truthful upper bound when an update republishes a pre-trimmed path", () => {
    const currentPath = "/workspace/current.ts";
    const republishedPath = "/workspace/ledger-1.ts";
    const publishedCountByPath = Object.fromEntries(
      Array.from({ length: DIAGNOSTICS_CACHE_MAX_LEDGER_PATHS + 1 }, (_, index) => [
        index === 0 ? currentPath : `/workspace/ledger-${index}.ts`,
        index === 0 ? 16 : index === 1 ? 1 : 0,
      ]),
    );

    const result = applyBoundedDiagnosticsCacheBatch(
      { [currentPath]: [diagnostic(0)] },
      [
        {
          diagnostics: [diagnostic(1)],
          path: republishedPath,
          publishedCount: 1,
        },
      ],
      {
        publishedCount: 31,
        publishedCountByPath,
        untrackedPublishedCount: 14,
      },
    );

    expect(result.receipt).toMatchObject({
      omittedCount: 30,
      publishedCount: 32,
      publishedCountKind: "upperBound",
      retainedCount: 2,
      truncated: true,
    });
    expect(result.untrackedPublishedCount).toBe(15);
  });

  it("reports an upper bound after pre-trimming an over-cap ledger without updates", () => {
    const currentPath = "/workspace/ledger-0.ts";
    const publishedCountByPath = Object.fromEntries(
      Array.from({ length: DIAGNOSTICS_CACHE_MAX_LEDGER_PATHS + 1 }, (_, index) => [
        `/workspace/ledger-${index}.ts`,
        1,
      ]),
    );

    const result = applyBoundedDiagnosticsCacheBatch({ [currentPath]: [diagnostic(0)] }, [], {
      publishedCount: DIAGNOSTICS_CACHE_MAX_LEDGER_PATHS + 1,
      publishedCountByPath,
      untrackedPublishedCount: 0,
    });

    expect(result.receipt.publishedCountKind).toBe("upperBound");
  });

  it("bounds the ledger for 100k individually non-retainable paths", () => {
    const circularData: { self?: unknown } = {};
    circularData.self = circularData;
    const nonRetainable = diagnostic(0);
    nonRetainable.data = circularData;
    const result = applyBoundedDiagnosticsCacheBatch(
      {},
      Array.from({ length: 100_000 }, (_, index) => ({
        diagnostics: [nonRetainable],
        path: `/workspace/rejected-${index}.ts`,
        publishedCount: 1,
      })),
    );

    expect(result.receipt).toMatchObject({
      omittedCount: 100_000,
      publishedCount: 100_000,
      publishedCountKind: "upperBound",
      retainedCount: 0,
      truncated: true,
    });
    expect(Object.keys(result.publishedCountByPath)).toHaveLength(
      DIAGNOSTICS_CACHE_MAX_LEDGER_PATHS,
    );
    expect(result.untrackedPublishedCount).toBe(80_000);
  });

  it("retains only the ordered diagnostic prefix within count limits", () => {
    const diagnostics = Array.from({ length: DIAGNOSTICS_CACHE_MAX_DIAGNOSTICS + 5 }, (_, index) =>
      diagnostic(index),
    );

    const result = applyBoundedDiagnosticsCacheBatch({}, [
      {
        diagnostics,
        path: "/workspace/large.ts",
        publishedCount: diagnostics.length,
      },
    ]);

    expect(result.byPath["/workspace/large.ts"]).toHaveLength(DIAGNOSTICS_CACHE_MAX_DIAGNOSTICS);
    expect(
      result.byPath["/workspace/large.ts"]?.[DIAGNOSTICS_CACHE_MAX_DIAGNOSTICS - 1]?.line,
    ).toBe(DIAGNOSTICS_CACHE_MAX_DIAGNOSTICS - 1);
    expect(result.receipt).toMatchObject({
      omittedCount: 5,
      publishedCount: DIAGNOSTICS_CACHE_MAX_DIAGNOSTICS + 5,
      retainedCount: DIAGNOSTICS_CACHE_MAX_DIAGNOSTICS,
      truncated: true,
    });
  });

  it("evicts the oldest file deterministically when a newer path arrives", () => {
    const current = Object.fromEntries(
      Array.from({ length: DIAGNOSTICS_CACHE_MAX_NONEMPTY_FILES }, (_, index) => [
        `/workspace/file-${index}.ts`,
        [diagnostic(index)],
      ]),
    );

    const result = applyBoundedDiagnosticsCacheBatch(current, [
      {
        diagnostics: [diagnostic(9999)],
        path: "/workspace/newest.ts",
        publishedCount: 1,
      },
    ]);

    expect(result.byPath["/workspace/file-0.ts"]).toBeUndefined();
    expect(result.byPath["/workspace/file-1.ts"]).toHaveLength(1);
    expect(result.byPath["/workspace/newest.ts"]).toHaveLength(1);
  });

  it("preserves upstream omissions across later files and clears an evicted path exactly", () => {
    const initial = applyBoundedDiagnosticsCacheBatch(
      {},
      Array.from({ length: 2_001 }, (_, index) => ({
        diagnostics: [diagnostic(index)],
        path: `/workspace/file-${index}.ts`,
        publishedCount: index === 0 ? 100_000 : 1,
      })),
    );
    expect(initial.receipt).toMatchObject({
      publishedCount: 102_000,
      retainedCount: 2_000,
    });
    expect(initial.byPath["/workspace/file-0.ts"]).toBeUndefined();

    const cleared = applyBoundedDiagnosticsCacheBatch(
      initial.byPath,
      [
        {
          diagnostics: [],
          path: "/workspace/file-0.ts",
          publishedCount: 0,
        },
      ],
      {
        publishedCount: initial.receipt.publishedCount,
        publishedCountByPath: initial.publishedCountByPath,
        untrackedPublishedCount: initial.untrackedPublishedCount,
      },
    );

    expect(cleared.receipt).toMatchObject({
      omittedCount: 0,
      publishedCount: 2_000,
      retainedCount: 2_000,
      truncated: false,
    });
  });

  it("removes a cleared path instead of retaining an empty entry", () => {
    const result = applyBoundedDiagnosticsCacheBatch({ "/workspace/a.php": [diagnostic(0)] }, [
      { diagnostics: [], path: "/workspace/a.php", publishedCount: 0 },
    ]);

    expect(result.byPath).toEqual({});
    expect(result.receipt.retainedCount).toBe(0);
  });

  it("stops before an oversized item and reports a truthful byte omission", () => {
    const result = applyBoundedDiagnosticsCacheBatch({}, [
      {
        diagnostics: [diagnostic(0, "x".repeat(DIAGNOSTICS_CACHE_MAX_UTF8_BYTES))],
        path: "/workspace/huge.ts",
        publishedCount: 1,
      },
    ]);

    expect(result.byPath).toEqual({});
    expect(result.receipt).toMatchObject({
      omittedCount: 1,
      publishedCount: 1,
      retainedCount: 0,
      truncated: true,
    });
  });

  it("accounts for escaped JSON keys, delimiters, and diagnostic strings", () => {
    const path = '/workspace/"quoted"\\\\file.ts';
    const result = applyBoundedDiagnosticsCacheBatch({}, [
      {
        diagnostics: [diagnostic(0, '"quoted"\\\\message')],
        path,
        publishedCount: 1,
      },
    ]);
    const exactBytes = new TextEncoder().encode(JSON.stringify(result.byPath)).byteLength;

    expect(result.receipt.retainedUtf8Bytes).toBe(exactBytes);
    expect(exactBytes).toBeLessThanOrEqual(DIAGNOSTICS_CACHE_MAX_UTF8_BYTES);
  });

  it("never admits a diagnostic whose array comma crosses the exact byte cap", () => {
    const message = "x".repeat(Math.floor(DIAGNOSTICS_CACHE_MAX_UTF8_BYTES / 2) - 200);
    const result = applyBoundedDiagnosticsCacheBatch({}, [
      {
        diagnostics: [diagnostic(0, message), diagnostic(1, message)],
        path: "/workspace/boundary.ts",
        publishedCount: 2,
      },
    ]);
    const exactBytes = new TextEncoder().encode(JSON.stringify(result.byPath)).byteLength;

    expect(exactBytes).toBeLessThanOrEqual(DIAGNOSTICS_CACHE_MAX_UTF8_BYTES);
    expect(result.receipt.retainedUtf8Bytes).toBe(exactBytes);
    expect(result.receipt.retainedCount).toBeLessThanOrEqual(2);
  });

  it("reuses retained byte metadata instead of serializing the whole cache", () => {
    const initial = applyBoundedDiagnosticsCacheBatch(
      {},
      Array.from({ length: DIAGNOSTICS_CACHE_MAX_NONEMPTY_FILES }, (_, index) => ({
        diagnostics: [diagnostic(index)],
        path: `/workspace/file-${index}.ts`,
        publishedCount: 1,
      })),
    );
    const stringify = vi.spyOn(JSON, "stringify");

    const updated = applyBoundedDiagnosticsCacheBatch(
      initial.byPath,
      [
        {
          diagnostics: [diagnostic(20_001)],
          path: "/workspace/new.ts",
          publishedCount: 1,
        },
      ],
      {
        publishedCount: initial.receipt.publishedCount,
        publishedCountByPath: initial.publishedCountByPath,
        retainedUtf8Bytes: initial.receipt.retainedUtf8Bytes,
        retainedUtf8BytesByPath: initial.retainedUtf8BytesByPath,
        untrackedPublishedCount: initial.untrackedPublishedCount,
      },
    );

    expect(stringify.mock.calls.length).toBeLessThanOrEqual(2);
    expect(updated.receipt.retainedUtf8Bytes).toBe(
      new TextEncoder().encode(JSON.stringify(updated.byPath)).byteLength,
    );
    stringify.mockRestore();
  });
});
