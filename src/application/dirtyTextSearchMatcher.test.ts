import { describe, expect, it } from "vitest";
import type { DirtyTextSearchComputationRequest } from "./dirtyTextSearchComputation";
import { computeDirtyTextSearch } from "./dirtyTextSearchMatcher";
import { defaultTextSearchOptions } from "../domain/workspace";

const encoder = new TextEncoder();

describe("computeDirtyTextSearch", () => {
  it("keeps the admitted single-line budget linear rather than matches times line size", () => {
    const chunk = `${"x".repeat(2 * 1024 - 6)}needle`;
    const content = chunk.repeat(128);
    expect(content.length).toBe(256 * 1024);

    const response = computeDirtyTextSearch(request(content, 100), budget());

    expect(response.results).toHaveLength(100);
    expect(response.limitations).toContain("result-limit");
    expect(response.truncated).toBe(true);
  });

  it("uses UTF-16 source columns for Monaco and code-point preview spans", () => {
    const response = computeDirtyTextSearch(request("😀needle", 10), budget());

    expect(response.results[0]).toMatchObject({
      column: 3,
      lineText: "😀needle",
      matchStart: 1,
      matchEnd: 7,
    });
  });

  it("bounds long Unicode previews and marks a clipped match truthfully", () => {
    const longMatch = "😀".repeat(5_000);
    const requestWithRegex = {
      ...request(longMatch, 10),
      query: longMatch,
    };

    const response = computeDirtyTextSearch(requestWithRegex, budget());

    expect(Array.from(response.results[0].lineText)).toHaveLength(4_096);
    expect(response.results[0]).toMatchObject({
      matchStart: 0,
      matchEnd: 4_096,
      matchTruncated: true,
      previewTruncated: true,
    });
  });

  it("fails closed instead of approximating Rust regex or Unicode whole-word semantics", () => {
    for (const options of [
      { ...defaultTextSearchOptions(), isRegex: true },
      { ...defaultTextSearchOptions(), wholeWord: true },
    ]) {
      const requested = {
        ...request("élan 变量", 10),
        options,
        query: options.isRegex ? "(é+)+$" : "élan",
      };
      const response = computeDirtyTextSearch(requested, budget());

      expect(response.results).toEqual([]);
      expect(response.limitations).toContain("unsupported-query-semantics");
      expect(response.truncated).toBe(true);
      expect(response.dirtyPaths).toEqual(requested.dirtyPaths);
    }
  });

  it("fails closed for native file-mask eligibility rather than reimplementing globs", () => {
    const requested = {
      ...request("needle", 10),
      options: {
        ...defaultTextSearchOptions(),
        fileMask: "**/*.{js,ts}",
      },
    };
    const response = computeDirtyTextSearch(requested, budget());

    expect(response.results).toEqual([]);
    expect(response.limitations).toContain("unsupported-file-mask");
    expect(response.truncated).toBe(true);
  });

  it("stops under the cooperative time budget and preserves every dirty authority path", () => {
    let checks = 0;
    const requested = {
      ...request("needle\nneedle", 10),
      dirtyPaths: ["/workspace/a.ts", "/workspace/skipped.ts"],
    };
    const response = computeDirtyTextSearch(requested, {
      hasTimeRemaining: () => checks++ < 2,
      utf8ByteLength: (value) => encoder.encode(value).byteLength,
    });

    expect(response.dirtyPaths).toEqual(requested.dirtyPaths);
    expect(response.limitations).toContain("time-limit");
    expect(response.truncated).toBe(true);
  });

  it("handles CRLF and zero-width literal searches without looping", () => {
    const crlf = computeDirtyTextSearch(request("first\r\nneedle\r\nthird", 10), budget());
    expect(crlf.results[0]).toMatchObject({ lineNumber: 2, column: 1 });

    const zeroWidth = computeDirtyTextSearch({ ...request("abc", 10), query: "" }, budget());
    expect(zeroWidth.results).toHaveLength(4);
    expect(zeroWidth.results.map((result) => result.column)).toEqual([1, 2, 3, 4]);
  });
});

function request(content: string, limit: number): DirtyTextSearchComputationRequest {
  return {
    authority: {
      dirtySnapshotGeneration: 3,
      requestGeneration: "request-3",
      root: "/workspace",
      searchGeneration: 7,
      workspaceOwnerKey: "owner-7",
    },
    dirtyPaths: ["/workspace/file.ts"],
    documents: [
      {
        content,
        documentRevision: 4,
        path: "/workspace/file.ts",
        relativePath: "file.ts",
      },
    ],
    limit,
    options: defaultTextSearchOptions(),
    preflightLimitations: [],
    query: "needle",
  };
}

function budget() {
  return {
    hasTimeRemaining: () => true,
    utf8ByteLength: (value: string) => encoder.encode(value).byteLength,
  };
}
