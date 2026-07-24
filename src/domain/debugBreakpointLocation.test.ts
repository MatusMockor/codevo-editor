import { describe, expect, it } from "vitest";
import {
  compareDebugBreakpoints,
  compareDebugBreakpointLocations,
  debugBreakpointLocationKey,
  debugBreakpointLocationsEqual,
  type DebugBreakpointLocation,
} from "./debugBreakpointLocation";

const line: DebugBreakpointLocation = { filePath: "/workspace/a.ts", lineNumber: 4 };
const columnOne: DebugBreakpointLocation = { ...line, columnNumber: 1 };
const inline: DebugBreakpointLocation = { ...line, columnNumber: 7 };

describe("debug breakpoint location", () => {
  it("uses presence as part of exact tuple identity", () => {
    expect(debugBreakpointLocationsEqual(line, { ...line })).toBe(true);
    expect(debugBreakpointLocationsEqual(line, columnOne)).toBe(false);
    expect(debugBreakpointLocationsEqual(columnOne, inline)).toBe(false);
    expect(new Set([line, columnOne, inline].map(debugBreakpointLocationKey))).toHaveLength(3);
  });

  it("sorts path, line, line-only presence, then numeric columns", () => {
    const values = [
      inline,
      { filePath: "/workspace/b.ts", lineNumber: 1 },
      columnOne,
      line,
      { filePath: "/workspace/a.ts", lineNumber: 3, columnNumber: 99 },
    ];
    expect([...values].sort(compareDebugBreakpointLocations)).toEqual([
      { filePath: "/workspace/a.ts", lineNumber: 3, columnNumber: 99 },
      line,
      columnOne,
      inline,
      { filePath: "/workspace/b.ts", lineNumber: 1 },
    ]);
  });

  it("keeps same-column siblings distinct and deterministically ordered by ID", () => {
    const siblingB = {
      ...inline,
      enabled: true,
      id: "inline-b",
    };
    const siblingA = {
      ...inline,
      enabled: true,
      id: "inline-a",
    };

    expect(debugBreakpointLocationsEqual(siblingA, siblingB)).toBe(true);
    expect(debugBreakpointLocationKey(siblingA)).toBe(debugBreakpointLocationKey(siblingB));
    expect(compareDebugBreakpointLocations(siblingA, siblingB)).toBe(0);
    expect([siblingB, siblingA].sort(compareDebugBreakpoints).map(({ id }) => id)).toEqual([
      "inline-a",
      "inline-b",
    ]);
  });
});
