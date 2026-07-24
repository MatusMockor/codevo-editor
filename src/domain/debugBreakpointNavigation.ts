import type { Breakpoint } from "./debug";
import { compareDebugBreakpointLocations } from "./debugBreakpointLocation";

export type DebugBreakpointNavigationDirection = "next" | "previous";

export interface DebugBreakpointNavigationLocation {
  readonly documentPath: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
}

export interface DebugBreakpointNavigationTarget {
  readonly id: string;
  readonly filePath: string;
  readonly lineNumber: number;
  readonly columnNumber?: number;
}

/** Matches VS Code's enabled-only same-file, following-file, then wrap ordering. */
export function selectDebugBreakpointNavigationTarget(
  breakpoints: readonly Breakpoint[],
  current: DebugBreakpointNavigationLocation,
  direction: DebugBreakpointNavigationDirection,
): DebugBreakpointNavigationTarget | null {
  const enabled = breakpoints
    .filter((breakpoint) => breakpoint.enabled)
    .map(({ id, filePath, lineNumber, columnNumber }) => ({
      id,
      filePath,
      lineNumber,
      ...(columnNumber === undefined ? {} : { columnNumber }),
    }))
    .sort(
      (left, right) =>
        compareDebugBreakpointLocations(left, right) || left.id.localeCompare(right.id),
    );
  if (enabled.length === 0) return null;

  if (direction === "next") {
    return (
      enabled.find(
        (breakpoint) =>
          breakpoint.filePath === current.documentPath && locationAfter(breakpoint, current),
      ) ??
      enabled.find((breakpoint) => breakpoint.filePath > current.documentPath) ??
      enabled[0]!
    );
  }

  return (
    findLast(
      enabled,
      (breakpoint) =>
        breakpoint.filePath === current.documentPath && locationBefore(breakpoint, current),
    ) ??
    findLast(enabled, (breakpoint) => breakpoint.filePath < current.documentPath) ??
    enabled[enabled.length - 1]!
  );
}

function locationAfter(
  breakpoint: DebugBreakpointNavigationTarget,
  current: DebugBreakpointNavigationLocation,
): boolean {
  return (
    breakpoint.lineNumber > current.lineNumber ||
    (breakpoint.lineNumber === current.lineNumber &&
      (breakpoint.columnNumber ?? 1) > current.columnNumber)
  );
}

function locationBefore(
  breakpoint: DebugBreakpointNavigationTarget,
  current: DebugBreakpointNavigationLocation,
): boolean {
  return (
    breakpoint.lineNumber < current.lineNumber ||
    (breakpoint.lineNumber === current.lineNumber &&
      (breakpoint.columnNumber ?? 1) < current.columnNumber)
  );
}

function findLast<T>(values: readonly T[], predicate: (value: T) => boolean): T | null {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index]!;
    if (predicate(value)) return value;
  }
  return null;
}
