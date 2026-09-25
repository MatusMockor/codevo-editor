import type { Breakpoint } from "../../domain/debug";
import { workspaceRelativePath } from "../../domain/pathDerivation";

export function displayPath(rootPath: string | null, filePath: string): string {
  if (!rootPath) {
    return filePath;
  }

  return workspaceRelativePath(rootPath, filePath) ?? filePath;
}

export function breakpointLocationLabel(breakpoint: Breakpoint, rootPath?: string | null): string {
  const path =
    rootPath === undefined ? breakpoint.filePath : displayPath(rootPath, breakpoint.filePath);
  const column = breakpoint.columnNumber === undefined ? "" : `:${breakpoint.columnNumber}`;
  return `${path}:${breakpoint.lineNumber}${column}`;
}
