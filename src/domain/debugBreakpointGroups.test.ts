import { describe, expect, it } from "vitest";
import type { Breakpoint } from "./debug";
import { createBreakpointGroupRows, groupBreakpointsByFile } from "./debugBreakpointGroups";

function breakpoint(
  id: string,
  filePath: string,
  lineNumber: number,
  columnNumber?: number,
): Breakpoint {
  return {
    columnNumber,
    enabled: true,
    filePath,
    id,
    lineNumber,
  };
}

describe("debugBreakpointGroups", () => {
  it("produces one stably sorted section per file with sorted breakpoints and exact counts", () => {
    const groups = groupBreakpointsByFile(
      [
        breakpoint("z-20", "/workspace/z.ts", 20),
        breakpoint("a-8-4", "/workspace/a.ts", 8, 4),
        breakpoint("z-2", "/workspace/z.ts", 2),
        breakpoint("a-8-2", "/workspace/a.ts", 8, 2),
      ],
      "/workspace",
    );

    expect(
      groups.map(({ breakpoints, count, filePath }) => ({
        ids: breakpoints.map(({ id }) => id),
        count,
        filePath,
      })),
    ).toEqual([
      { count: 2, filePath: "/workspace/a.ts", ids: ["a-8-2", "a-8-4"] },
      { count: 2, filePath: "/workspace/z.ts", ids: ["z-2", "z-20"] },
    ]);
  });

  it("disambiguates duplicate basenames with workspace-relative paths", () => {
    const groups = groupBreakpointsByFile(
      [
        breakpoint("web", "/workspace/packages/web/src/index.ts", 1),
        breakpoint("api", "/workspace/packages/api/src/index.ts", 1),
        breakpoint("worker", "/workspace/packages/worker/src/worker.ts", 1),
      ],
      "/workspace",
    );

    expect(groups.map(({ fileName, relativePath }) => ({ fileName, relativePath }))).toEqual([
      { fileName: "index.ts", relativePath: "packages/api/src/index.ts" },
      { fileName: "index.ts", relativePath: "packages/web/src/index.ts" },
      { fileName: "worker.ts", relativePath: null },
    ]);
  });

  it("omits every breakpoint row from a collapsed file group", () => {
    const groups = groupBreakpointsByFile(
      [
        breakpoint("a-1", "/workspace/a.ts", 1),
        breakpoint("a-2", "/workspace/a.ts", 2),
        breakpoint("b-1", "/workspace/b.ts", 1),
      ],
      "/workspace",
    );

    const rows = createBreakpointGroupRows(groups, new Set(["/workspace/a.ts"]));

    expect(rows.map(({ key, kind }) => ({ key, kind }))).toEqual([
      { key: "group:/workspace/a.ts", kind: "group" },
      { key: "group:/workspace/b.ts", kind: "group" },
      { key: "breakpoint:b-1", kind: "breakpoint" },
    ]);
  });

  it("does not reorder unrelated file groups when a breakpoint is added", () => {
    const before = groupBreakpointsByFile(
      [breakpoint("a", "/workspace/a.ts", 1), breakpoint("c", "/workspace/c.ts", 1)],
      "/workspace",
    );
    const after = groupBreakpointsByFile(
      [
        breakpoint("a", "/workspace/a.ts", 1),
        breakpoint("c", "/workspace/c.ts", 1),
        breakpoint("b", "/workspace/b.ts", 1),
      ],
      "/workspace",
    );

    expect(before.map(({ filePath }) => filePath)).toEqual(["/workspace/a.ts", "/workspace/c.ts"]);
    expect(after.map(({ filePath }) => filePath)).toEqual([
      "/workspace/a.ts",
      "/workspace/b.ts",
      "/workspace/c.ts",
    ]);
    expect(after.filter(({ filePath }) => filePath !== "/workspace/b.ts")).toEqual(before);
  });
});
