import type { Breakpoint } from "./debug";
import { workspaceRelativePath } from "./pathDerivation";

export interface BreakpointFileGroup {
  readonly breakpoints: readonly Breakpoint[];
  readonly count: number;
  readonly fileName: string;
  readonly filePath: string;
  readonly relativePath: string | null;
}

export type BreakpointGroupRow =
  | {
      readonly group: BreakpointFileGroup;
      readonly key: string;
      readonly kind: "group";
    }
  | {
      readonly breakpoint: Breakpoint;
      readonly group: BreakpointFileGroup;
      readonly key: string;
      readonly kind: "breakpoint";
    };

export function groupBreakpointsByFile(
  breakpoints: readonly Breakpoint[],
  workspaceRoot: string | null,
): readonly BreakpointFileGroup[] {
  const byFilePath = new Map<string, Array<{ breakpoint: Breakpoint; inputIndex: number }>>();

  breakpoints.forEach((item, inputIndex) => {
    const entries = byFilePath.get(item.filePath);
    if (entries) {
      entries.push({ breakpoint: item, inputIndex });
      return;
    }
    byFilePath.set(item.filePath, [{ breakpoint: item, inputIndex }]);
  });

  const basenameCounts = new Map<string, number>();
  for (const filePath of byFilePath.keys()) {
    const fileName = breakpointFileName(filePath);
    basenameCounts.set(fileName, (basenameCounts.get(fileName) ?? 0) + 1);
  }

  return [...byFilePath.entries()]
    .sort(([leftPath], [rightPath]) => compareText(leftPath, rightPath))
    .map(([filePath, entries]) => {
      const fileName = breakpointFileName(filePath);
      const sortedBreakpoints = entries
        .slice()
        .sort((left, right) => compareBreakpointEntries(left, right))
        .map(({ breakpoint: item }) => item);
      const relativePath =
        (basenameCounts.get(fileName) ?? 0) > 1
          ? breakpointDisambiguationPath(workspaceRoot, filePath)
          : null;
      return {
        breakpoints: sortedBreakpoints,
        count: sortedBreakpoints.length,
        fileName,
        filePath,
        relativePath,
      };
    });
}

export function createBreakpointGroupRows(
  groups: readonly BreakpointFileGroup[],
  collapsedFilePaths: ReadonlySet<string>,
): readonly BreakpointGroupRow[] {
  const rows: BreakpointGroupRow[] = [];
  for (const group of groups) {
    rows.push({ group, key: breakpointGroupRowKey(group.filePath), kind: "group" });
    if (collapsedFilePaths.has(group.filePath)) {
      continue;
    }
    for (const breakpoint of group.breakpoints) {
      rows.push({
        breakpoint,
        group,
        key: breakpointRowKey(breakpoint.id),
        kind: "breakpoint",
      });
    }
  }
  return rows;
}

export function breakpointGroupRowKey(filePath: string): string {
  return `group:${filePath}`;
}

export function breakpointRowKey(breakpointId: string): string {
  return `breakpoint:${breakpointId}`;
}

function breakpointFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const separatorIndex = normalized.lastIndexOf("/");
  if (separatorIndex < 0) {
    return normalized || filePath;
  }
  return normalized.slice(separatorIndex + 1) || filePath;
}

function breakpointDisambiguationPath(workspaceRoot: string | null, filePath: string): string {
  if (!workspaceRoot) {
    return filePath;
  }
  return workspaceRelativePath(workspaceRoot, filePath) ?? filePath;
}

function compareBreakpointEntries(
  left: { readonly breakpoint: Breakpoint; readonly inputIndex: number },
  right: { readonly breakpoint: Breakpoint; readonly inputIndex: number },
): number {
  const lineDifference = left.breakpoint.lineNumber - right.breakpoint.lineNumber;
  if (lineDifference !== 0) {
    return lineDifference;
  }
  const columnDifference =
    (left.breakpoint.columnNumber ?? 0) - (right.breakpoint.columnNumber ?? 0);
  if (columnDifference !== 0) {
    return columnDifference;
  }
  return left.inputIndex - right.inputIndex;
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
