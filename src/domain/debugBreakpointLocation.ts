import type { Breakpoint } from "./debug";

export interface DebugBreakpointLocation {
  readonly columnNumber?: number;
  readonly filePath: string;
  readonly lineNumber: number;
}

export function debugBreakpointLocationsEqual(
  left: DebugBreakpointLocation,
  right: DebugBreakpointLocation,
): boolean {
  return (
    left.filePath === right.filePath &&
    left.lineNumber === right.lineNumber &&
    left.columnNumber === right.columnNumber
  );
}

export function debugBreakpointLocationKey(location: DebugBreakpointLocation): string {
  return `${location.filePath}\0${location.lineNumber}\0${location.columnNumber ?? "line"}`;
}

export function compareDebugBreakpointLocations(
  left: DebugBreakpointLocation,
  right: DebugBreakpointLocation,
): number {
  return (
    left.filePath.localeCompare(right.filePath) ||
    left.lineNumber - right.lineNumber ||
    compareColumns(left.columnNumber, right.columnNumber)
  );
}

export function compareDebugBreakpoints(left: Breakpoint, right: Breakpoint): number {
  return compareDebugBreakpointLocations(left, right) || left.id.localeCompare(right.id);
}

function compareColumns(left: number | undefined, right: number | undefined): number {
  if (left === right) return 0;
  if (left === undefined) return -1;
  if (right === undefined) return 1;
  return left - right;
}
