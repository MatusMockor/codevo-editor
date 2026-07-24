import type { Breakpoint, DebugLaunchTarget } from "./debug";
import { isBreakpointHitCondition } from "./debugBreakpointHitCondition";
import { isBreakpointLogMessage } from "./debugBreakpointLogMessage";
import { createWorkspaceRootFromPath, parseWorkspacePath } from "./workspacePath";
import { debugBreakpointLocationKey } from "./debugBreakpointLocation";

export const MAX_DEBUG_BREAKPOINTS_PER_SESSION = 2_000;
export const MAX_DEBUG_BREAKPOINTS_PER_FILE = 512;
export const MAX_DEBUG_BREAKPOINT_ID_BYTES = 128;
export const MAX_DEBUG_BREAKPOINT_CONDITION_BYTES = 4_096;
export const MAX_DEBUG_BREAKPOINT_FILE_PATH_BYTES = 4_096;
export const MAX_DEBUG_BREAKPOINT_LINE = 4_294_967_295;
export const MAX_DEBUG_BREAKPOINT_COLUMN = 4_294_967_295;

export type DebugBreakpointAdapterKind = "node" | "php";

const NODE_BREAKPOINT_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

export function debugBreakpointAdapterForLaunch(
  launch: DebugLaunchTarget,
): DebugBreakpointAdapterKind {
  return launch.kind.startsWith("php-") ? "php" : "node";
}

export function isDebugBreakpointModel(value: Breakpoint): boolean {
  const canonicalFilePath = createWorkspaceRootFromPath(value.filePath);
  return (
    utf8ByteLength(value.id) >= 1 &&
    utf8ByteLength(value.id) <= MAX_DEBUG_BREAKPOINT_ID_BYTES &&
    !value.id.includes("\0") &&
    canonicalFilePath.ok &&
    canonicalFilePath.value.nativePath === value.filePath &&
    utf8ByteLength(value.filePath) <= MAX_DEBUG_BREAKPOINT_FILE_PATH_BYTES &&
    !value.filePath.includes("\0") &&
    Number.isInteger(value.lineNumber) &&
    value.lineNumber >= 1 &&
    value.lineNumber <= MAX_DEBUG_BREAKPOINT_LINE &&
    (value.columnNumber === undefined ||
      (Number.isInteger(value.columnNumber) &&
        value.columnNumber >= 1 &&
        value.columnNumber <= MAX_DEBUG_BREAKPOINT_COLUMN)) &&
    (value.condition === undefined ||
      value.condition === null ||
      (utf8ByteLength(value.condition) <= MAX_DEBUG_BREAKPOINT_CONDITION_BYTES &&
        !value.condition.includes("\0"))) &&
    (value.hitCondition === undefined ||
      value.hitCondition === null ||
      isBreakpointHitCondition(value.hitCondition)) &&
    (value.logMessage === undefined ||
      value.logMessage === null ||
      isBreakpointLogMessage(value.logMessage))
  );
}

export function isBreakpointPathSupported(
  rootPath: string,
  adapterKind: DebugBreakpointAdapterKind,
  filePath: string,
): boolean {
  const root = createWorkspaceRootFromPath(rootPath);
  if (!root.ok || !parseWorkspacePath(root.value, filePath).ok) return false;

  const lowerPath = filePath.toLowerCase();
  if (adapterKind === "php") return lowerPath.endsWith(".php");

  const dot = lowerPath.lastIndexOf(".");
  return dot >= 0 && NODE_BREAKPOINT_EXTENSIONS.has(lowerPath.slice(dot));
}

/** Keeps persisted UI state broad while exposing only adapter-safe breakpoints to a session. */
export function breakpointsForDebugSession(
  rootPath: string,
  adapterKind: DebugBreakpointAdapterKind,
  breakpoints: readonly Breakpoint[],
): Breakpoint[] {
  const result: Breakpoint[] = [];
  const ids = new Set<string>();
  const locations = new Set<string>();
  const fileCounts = new Map<string, number>();

  for (const breakpoint of breakpoints) {
    if (result.length >= MAX_DEBUG_BREAKPOINTS_PER_SESSION) break;
    const locationKey = debugBreakpointLocationKey(breakpoint);
    if (!isDebugBreakpointModel(breakpoint) || ids.has(breakpoint.id) || locations.has(locationKey))
      continue;
    if (!isBreakpointPathSupported(rootPath, adapterKind, breakpoint.filePath)) continue;
    if (adapterKind === "php" && breakpoint.columnNumber !== undefined) continue;

    const fileCount = fileCounts.get(breakpoint.filePath) ?? 0;
    if (fileCount >= MAX_DEBUG_BREAKPOINTS_PER_FILE) continue;

    ids.add(breakpoint.id);
    locations.add(locationKey);
    fileCounts.set(breakpoint.filePath, fileCount + 1);
    if (adapterKind === "php") {
      const { hitCondition: _omittedHit, logMessage: _omittedLog, ...phpBreakpoint } = breakpoint;
      result.push(phpBreakpoint);
    } else {
      result.push(breakpoint);
    }
  }

  return result;
}

/** Repairs legacy persistence without applying an adapter/language capability filter. */
export function sanitizeDebugBreakpoints(breakpoints: readonly Breakpoint[]): Breakpoint[] {
  const result: Breakpoint[] = [];
  const ids = new Set<string>();
  const locations = new Set<string>();
  const fileCounts = new Map<string, number>();
  for (const breakpoint of breakpoints) {
    if (result.length >= MAX_DEBUG_BREAKPOINTS_PER_SESSION) break;
    const locationKey = debugBreakpointLocationKey(breakpoint);
    if (!isDebugBreakpointModel(breakpoint) || ids.has(breakpoint.id) || locations.has(locationKey))
      continue;
    const count = fileCounts.get(breakpoint.filePath) ?? 0;
    if (count >= MAX_DEBUG_BREAKPOINTS_PER_FILE) continue;
    ids.add(breakpoint.id);
    locations.add(locationKey);
    fileCounts.set(breakpoint.filePath, count + 1);
    result.push(breakpoint);
  }
  return result;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
