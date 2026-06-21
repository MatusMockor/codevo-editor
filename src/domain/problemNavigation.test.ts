import { describe, expect, it } from "vitest";
import type { WorkbenchNotice } from "../application/workbenchNotice";
import {
  nextProblemLocation,
  previousProblemLocation,
  problemLocationsFromNotices,
} from "./problemNavigation";

function diagnosticNotice(
  path: string,
  lineNumber: number,
  column: number,
  groupKey = "javascript-typescript-diagnostics:",
): WorkbenchNotice {
  return {
    groupKey: `${groupKey}${path}`,
    id: `${path}:${lineNumber}:${column}`,
    message: "problem",
    navigationTarget: {
      path,
      range: {
        end: { column: column + 1, lineNumber },
        start: { column, lineNumber },
      },
    },
    severity: "error",
    source: "tsserver",
  };
}

describe("problemNavigation", () => {
  it("collects and sorts diagnostic locations by path, line, column", () => {
    const notices = [
      diagnosticNotice("/b.ts", 1, 1),
      diagnosticNotice("/a.ts", 5, 2),
      diagnosticNotice("/a.ts", 5, 1),
      diagnosticNotice("/a.ts", 2, 9),
    ];

    expect(problemLocationsFromNotices(notices)).toEqual([
      { path: "/a.ts", position: { column: 9, lineNumber: 2 } },
      { path: "/a.ts", position: { column: 1, lineNumber: 5 } },
      { path: "/a.ts", position: { column: 2, lineNumber: 5 } },
      { path: "/b.ts", position: { column: 1, lineNumber: 1 } },
    ]);
  });

  it("ignores non-diagnostic notices and notices without navigation targets", () => {
    const notices: WorkbenchNotice[] = [
      {
        groupKey: "index:scan",
        id: "x",
        message: "scanning",
        navigationTarget: {
          path: "/ignored.ts",
          range: {
            end: { column: 1, lineNumber: 1 },
            start: { column: 1, lineNumber: 1 },
          },
        },
        severity: "info",
        source: "Index",
      },
      {
        groupKey: "javascript-typescript-diagnostics:/no-target.ts",
        id: "y",
        message: "no target",
        severity: "error",
        source: "tsserver",
      },
      diagnosticNotice("/a.ts", 1, 1),
    ];

    expect(problemLocationsFromNotices(notices)).toEqual([
      { path: "/a.ts", position: { column: 1, lineNumber: 1 } },
    ]);
  });

  it("navigates to the next problem after the cursor", () => {
    const notices = [
      diagnosticNotice("/a.ts", 1, 1),
      diagnosticNotice("/a.ts", 4, 1),
      diagnosticNotice("/b.ts", 2, 1),
    ];

    expect(
      nextProblemLocation(notices, {
        path: "/a.ts",
        position: { column: 1, lineNumber: 1 },
      }),
    ).toEqual({ path: "/a.ts", position: { column: 1, lineNumber: 4 } });
  });

  it("wraps to the first problem when moving next from the last", () => {
    const notices = [
      diagnosticNotice("/a.ts", 1, 1),
      diagnosticNotice("/b.ts", 2, 1),
    ];

    expect(
      nextProblemLocation(notices, {
        path: "/b.ts",
        position: { column: 1, lineNumber: 2 },
      }),
    ).toEqual({ path: "/a.ts", position: { column: 1, lineNumber: 1 } });
  });

  it("navigates to the previous problem before the cursor", () => {
    const notices = [
      diagnosticNotice("/a.ts", 1, 1),
      diagnosticNotice("/a.ts", 4, 1),
      diagnosticNotice("/b.ts", 2, 1),
    ];

    expect(
      previousProblemLocation(notices, {
        path: "/b.ts",
        position: { column: 1, lineNumber: 2 },
      }),
    ).toEqual({ path: "/a.ts", position: { column: 1, lineNumber: 4 } });
  });

  it("wraps to the last problem when moving previous from the first", () => {
    const notices = [
      diagnosticNotice("/a.ts", 1, 1),
      diagnosticNotice("/b.ts", 2, 1),
    ];

    expect(
      previousProblemLocation(notices, {
        path: "/a.ts",
        position: { column: 1, lineNumber: 1 },
      }),
    ).toEqual({ path: "/b.ts", position: { column: 1, lineNumber: 2 } });
  });

  it("starts at the first or last problem when there is no cursor", () => {
    const notices = [
      diagnosticNotice("/a.ts", 1, 1),
      diagnosticNotice("/b.ts", 2, 1),
    ];

    expect(nextProblemLocation(notices, null)).toEqual({
      path: "/a.ts",
      position: { column: 1, lineNumber: 1 },
    });
    expect(previousProblemLocation(notices, null)).toEqual({
      path: "/b.ts",
      position: { column: 1, lineNumber: 2 },
    });
  });

  it("returns null when there are no diagnostics", () => {
    expect(nextProblemLocation([], null)).toBeNull();
    expect(
      previousProblemLocation([], {
        path: "/a.ts",
        position: { column: 1, lineNumber: 1 },
      }),
    ).toBeNull();
  });
});
