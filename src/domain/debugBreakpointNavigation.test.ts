import { describe, expect, it } from "vitest";
import type { Breakpoint } from "./debug";
import { selectDebugBreakpointNavigationTarget } from "./debugBreakpointNavigation";

const breakpoints: Breakpoint[] = [
  { id: "z", enabled: true, filePath: "/workspace/b.ts", lineNumber: 8 },
  { id: "disabled", enabled: false, filePath: "/workspace/a.ts", lineNumber: 9 },
  { id: "b", enabled: true, filePath: "/workspace/a.ts", lineNumber: 10 },
  { id: "a", enabled: true, filePath: "/workspace/a.ts", lineNumber: 10 },
  { id: "first", enabled: true, filePath: "/workspace/a.ts", lineNumber: 2 },
  { id: "last", enabled: true, filePath: "/workspace/c.ts", lineNumber: 1 },
];

describe("debug breakpoint navigation", () => {
  it("uses strict same-file lines before lexicographic following files and wraps next", () => {
    expect(
      selectDebugBreakpointNavigationTarget(
        breakpoints,
        { columnNumber: 1, documentPath: "/workspace/a.ts", lineNumber: 2 },
        "next",
      ),
    ).toMatchObject({ id: "a", filePath: "/workspace/a.ts", lineNumber: 10 });
    expect(
      selectDebugBreakpointNavigationTarget(
        breakpoints,
        { columnNumber: 1, documentPath: "/workspace/a.ts", lineNumber: 10 },
        "next",
      ),
    ).toMatchObject({ id: "z", filePath: "/workspace/b.ts", lineNumber: 8 });
    expect(
      selectDebugBreakpointNavigationTarget(
        breakpoints,
        { columnNumber: 1, documentPath: "/workspace/z.ts", lineNumber: 1 },
        "next",
      ),
    ).toMatchObject({ id: "first", filePath: "/workspace/a.ts", lineNumber: 2 });
  });

  it("uses strict same-file lines before lexicographic preceding files and wraps previous", () => {
    expect(
      selectDebugBreakpointNavigationTarget(
        breakpoints,
        { columnNumber: 1, documentPath: "/workspace/a.ts", lineNumber: 10 },
        "previous",
      ),
    ).toMatchObject({ id: "first", filePath: "/workspace/a.ts", lineNumber: 2 });
    expect(
      selectDebugBreakpointNavigationTarget(
        breakpoints,
        { columnNumber: 1, documentPath: "/workspace/c.ts", lineNumber: 1 },
        "previous",
      ),
    ).toMatchObject({ id: "z", filePath: "/workspace/b.ts", lineNumber: 8 });
    expect(
      selectDebugBreakpointNavigationTarget(
        breakpoints,
        { columnNumber: 1, documentPath: "/workspace/0.ts", lineNumber: 1 },
        "previous",
      ),
    ).toMatchObject({ id: "last", filePath: "/workspace/c.ts", lineNumber: 1 });
  });

  it("ignores disabled entries, breaks ties by id, and never mutates the source", () => {
    const source = structuredClone(breakpoints);
    expect(
      selectDebugBreakpointNavigationTarget(
        breakpoints,
        { columnNumber: 1, documentPath: "/workspace/a.ts", lineNumber: 9 },
        "next",
      )?.id,
    ).toBe("a");
    expect(breakpoints).toEqual(source);
    expect(
      selectDebugBreakpointNavigationTarget(
        breakpoints,
        { columnNumber: 1, documentPath: "/workspace/a.ts", lineNumber: 11 },
        "previous",
      )?.id,
    ).toBe("b");
    expect(
      selectDebugBreakpointNavigationTarget(
        breakpoints.filter((breakpoint) => !breakpoint.enabled),
        { columnNumber: 1, documentPath: "/workspace/a.ts", lineNumber: 1 },
        "next",
      ),
    ).toBeNull();
  });

  it("strictly skips every breakpoint on the current line in either direction", () => {
    expect(
      selectDebugBreakpointNavigationTarget(
        breakpoints,
        { columnNumber: 1, documentPath: "/workspace/a.ts", lineNumber: 10 },
        "next",
      ),
    ).toMatchObject({ id: "z", filePath: "/workspace/b.ts", lineNumber: 8 });
    expect(
      selectDebugBreakpointNavigationTarget(
        breakpoints,
        { columnNumber: 1, documentPath: "/workspace/a.ts", lineNumber: 10 },
        "previous",
      ),
    ).toMatchObject({ id: "first", filePath: "/workspace/a.ts", lineNumber: 2 });
  });

  it("orders line and inline siblings by their exact tuple", () => {
    const siblings: Breakpoint[] = [
      {
        id: "inline-9",
        enabled: true,
        filePath: "/workspace/a.ts",
        lineNumber: 4,
        columnNumber: 9,
      },
      { id: "line", enabled: true, filePath: "/workspace/a.ts", lineNumber: 4 },
      {
        id: "inline-3",
        enabled: true,
        filePath: "/workspace/a.ts",
        lineNumber: 4,
        columnNumber: 3,
      },
    ];

    expect(
      selectDebugBreakpointNavigationTarget(
        siblings,
        { columnNumber: 1, documentPath: "/workspace/a.ts", lineNumber: 4 },
        "next",
      ),
    ).toMatchObject({ id: "inline-3", columnNumber: 3 });
    expect(
      selectDebugBreakpointNavigationTarget(
        siblings,
        { columnNumber: 9, documentPath: "/workspace/a.ts", lineNumber: 4 },
        "previous",
      ),
    ).toMatchObject({ id: "inline-3", columnNumber: 3 });
  });
});
