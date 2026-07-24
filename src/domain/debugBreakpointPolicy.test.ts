import { describe, expect, it } from "vitest";
import type { Breakpoint } from "./debug";
import {
  breakpointsForDebugSession,
  isDebugBreakpointModel,
  MAX_DEBUG_BREAKPOINTS_PER_FILE,
} from "./debugBreakpointPolicy";

function breakpoint(id: string, filePath: string, lineNumber = 1): Breakpoint {
  return { id, filePath, lineNumber, enabled: true };
}

describe("debug breakpoint policy", () => {
  it("filters mixed and outside paths for each adapter", () => {
    const list = [
      breakpoint("js", "/workspace/src/app.ts"),
      breakpoint("php", "/workspace/src/App.PHP"),
      breakpoint("outside", "/other/app.ts"),
      breakpoint("unsupported", "/workspace/src/app.css"),
    ];

    expect(breakpointsForDebugSession("/workspace", "node", list).map(({ id }) => id)).toEqual([
      "js",
    ]);
    expect(breakpointsForDebugSession("/workspace", "php", list).map(({ id }) => id)).toEqual([
      "php",
    ]);
  });

  it("rejects zero lines, oversized UTF-8 fields and duplicate ids", () => {
    expect(isDebugBreakpointModel(breakpoint("zero", "/workspace/app.ts", 0))).toBe(false);
    expect(isDebugBreakpointModel(breakpoint("é".repeat(65), "/workspace/app.ts"))).toBe(false);
    expect(
      isDebugBreakpointModel({
        ...breakpoint("condition", "/workspace/app.ts"),
        condition: "é".repeat(2_049),
      }),
    ).toBe(false);
    expect(
      breakpointsForDebugSession("/workspace", "node", [
        breakpoint("same", "/workspace/a.ts"),
        breakpoint("same", "/workspace/b.ts"),
      ]),
    ).toHaveLength(1);
    expect(isDebugBreakpointModel(breakpoint("nul\0id", "/workspace/app.ts"))).toBe(false);
    expect(isDebugBreakpointModel(breakpoint("path", "/workspace/../other/app.ts"))).toBe(false);
    expect(isDebugBreakpointModel(breakpoint("nul-path", "/workspace/app\0.ts"))).toBe(false);
    expect(
      isDebugBreakpointModel(breakpoint("long-path", `/workspace/${"a".repeat(4_100)}.ts`)),
    ).toBe(false);
  });

  it("caps one file without dropping the valid prefix", () => {
    const list = Array.from({ length: MAX_DEBUG_BREAKPOINTS_PER_FILE + 1 }, (_, index) =>
      breakpoint(`bp-${index}`, "/workspace/app.ts", index + 1),
    );
    expect(breakpointsForDebugSession("/workspace", "node", list)).toHaveLength(
      MAX_DEBUG_BREAKPOINTS_PER_FILE,
    );
  });

  it("keeps composed Node logpoints but omits unsupported PHP hit and log fields", () => {
    const node = {
      ...breakpoint("node", "/workspace/app.ts"),
      hitCondition: { kind: "multiple", count: 3 } as const,
      condition: "ready",
      logMessage: "count={count}",
    };
    const php = {
      ...breakpoint("php", "/workspace/app.php"),
      hitCondition: { kind: "greaterOrEqual", count: 5 } as const,
      condition: "ready",
      logMessage: "never={value}",
    };

    expect(breakpointsForDebugSession("/workspace", "node", [node])).toEqual([node]);
    expect(breakpointsForDebugSession("/workspace", "php", [php])).toEqual([
      { ...breakpoint("php", "/workspace/app.php"), condition: "ready" },
    ]);
    expect(php.hitCondition).toEqual({ kind: "greaterOrEqual", count: 5 });
    expect(php.logMessage).toBe("never={value}");

    const nullablePhp = {
      ...breakpoint("php-null", "/workspace/null.php"),
      hitCondition: null,
      logMessage: null,
    };
    expect(breakpointsForDebugSession("/workspace", "php", [nullablePhp])).toEqual([
      breakpoint("php-null", "/workspace/null.php"),
    ]);
  });

  it("rejects invalid hit-condition objects from the model", () => {
    expect(
      isDebugBreakpointModel({
        ...breakpoint("bad", "/workspace/app.ts"),
        hitCondition: { kind: "equals", count: 0 },
      } as Breakpoint),
    ).toBe(false);
  });

  it("rejects malformed and oversized log messages from the model", () => {
    expect(
      isDebugBreakpointModel({
        ...breakpoint("bad-log", "/workspace/app.ts"),
        logMessage: "value={",
      }),
    ).toBe(false);
    expect(
      isDebugBreakpointModel({
        ...breakpoint("long-log", "/workspace/app.ts"),
        logMessage: "é".repeat(2_049),
      }),
    ).toBe(false);
  });

  it("accepts exact Node column siblings, rejects invalid columns, and omits them for PHP", () => {
    const line = breakpoint("line", "/workspace/app.ts", 4);
    const columnOne = { ...breakpoint("one", "/workspace/app.ts", 4), columnNumber: 1 };
    const inline = { ...breakpoint("inline", "/workspace/app.ts", 4), columnNumber: 7 };

    expect(breakpointsForDebugSession("/workspace", "node", [line, columnOne, inline])).toEqual([
      line,
      columnOne,
      inline,
    ]);
    expect(isDebugBreakpointModel({ ...line, columnNumber: 0 })).toBe(false);
    expect(isDebugBreakpointModel({ ...line, columnNumber: 1.5 })).toBe(false);
    expect(
      breakpointsForDebugSession("/workspace", "php", [
        breakpoint("php-line", "/workspace/app.php", 4),
        { ...breakpoint("php-inline", "/workspace/app.php", 4), columnNumber: 7 },
      ]),
    ).toEqual([breakpoint("php-line", "/workspace/app.php", 4)]);
  });
});
