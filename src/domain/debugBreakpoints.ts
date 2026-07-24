import type { Breakpoint } from "./debug";
import {
  type BreakpointHitCondition,
  isBreakpointHitCondition,
} from "./debugBreakpointHitCondition";
import { isBreakpointLogMessage } from "./debugBreakpointLogMessage";
import {
  isDebugBreakpointModel,
  MAX_DEBUG_BREAKPOINTS_PER_FILE,
  MAX_DEBUG_BREAKPOINTS_PER_SESSION,
  sanitizeDebugBreakpoints,
} from "./debugBreakpointPolicy";
import {
  compareDebugBreakpoints,
  debugBreakpointLocationKey,
  debugBreakpointLocationsEqual,
  type DebugBreakpointLocation,
} from "./debugBreakpointLocation";

export type BreakpointIdFactory = () => string;

export interface BreakpointCounts {
  readonly disabled: number;
  readonly enabled: number;
}

export function countBreakpoints(list: readonly Breakpoint[]): BreakpointCounts {
  let enabled = 0;
  let disabled = 0;

  for (const breakpoint of list) {
    if (breakpoint.enabled) enabled += 1;
    else disabled += 1;
  }

  return { disabled, enabled };
}

export function setAllBreakpointsEnabled(
  list: readonly Breakpoint[],
  enabled: boolean,
): Breakpoint[] {
  if (list.every((breakpoint) => breakpoint.enabled === enabled)) return list as Breakpoint[];
  return list.map((breakpoint) =>
    breakpoint.enabled === enabled ? breakpoint : { ...breakpoint, enabled },
  );
}

export function clearBreakpoints(list: readonly Breakpoint[]): Breakpoint[] {
  return list.length === 0 ? (list as Breakpoint[]) : [];
}

export function sequentialBreakpointIdFactory(start = 1): BreakpointIdFactory {
  let next = start;

  return () => {
    const id = `bp-${next}`;
    next += 1;

    return id;
  };
}

export function toggleBreakpoint(
  list: readonly Breakpoint[],
  filePath: string,
  lineNumber: number,
  createId: BreakpointIdFactory,
): Breakpoint[] {
  const location = { filePath, lineNumber };
  if (list.some((entry) => debugBreakpointLocationsEqual(entry, location))) {
    return list.filter((entry) => !debugBreakpointLocationsEqual(entry, location));
  }

  if (
    list.length >= MAX_DEBUG_BREAKPOINTS_PER_SESSION ||
    list.filter((entry) => entry.filePath === filePath).length >= MAX_DEBUG_BREAKPOINTS_PER_FILE
  ) {
    return [...list];
  }

  const breakpoint = { id: createId(), filePath, lineNumber, enabled: true };
  return isDebugBreakpointModel(breakpoint) ? [...list, breakpoint] : [...list];
}

export function addBreakpoint(
  list: readonly Breakpoint[],
  location: DebugBreakpointLocation,
  createId: BreakpointIdFactory,
): Breakpoint[] {
  if (list.some((entry) => debugBreakpointLocationsEqual(entry, location)))
    return list as Breakpoint[];
  if (
    list.length >= MAX_DEBUG_BREAKPOINTS_PER_SESSION ||
    list.filter((entry) => entry.filePath === location.filePath).length >=
      MAX_DEBUG_BREAKPOINTS_PER_FILE
  ) {
    return list as Breakpoint[];
  }
  const breakpoint: Breakpoint = { id: createId(), ...location, enabled: true };
  return isDebugBreakpointModel(breakpoint) ? [...list, breakpoint] : (list as Breakpoint[]);
}

/** Relocates one entity without changing its semantic line/inline kind or metadata. */
export function relocateBreakpoint(
  list: readonly Breakpoint[],
  id: string,
  location: DebugBreakpointLocation,
): Breakpoint[] {
  const current = list.find((entry) => entry.id === id);
  if (!current) return list as Breakpoint[];
  if ((current.columnNumber === undefined) !== (location.columnNumber === undefined)) {
    return list as Breakpoint[];
  }
  if (debugBreakpointLocationsEqual(current, location)) return list as Breakpoint[];
  if (list.some((entry) => entry.id !== id && debugBreakpointLocationsEqual(entry, location))) {
    return list as Breakpoint[];
  }
  const relocated: Breakpoint = { ...current, ...location };
  if (!isDebugBreakpointModel(relocated)) return list as Breakpoint[];
  return list.map((entry) => (entry.id === id ? relocated : entry));
}

export function setBreakpointEnabled(
  list: readonly Breakpoint[],
  id: string,
  enabled: boolean,
): Breakpoint[] {
  return list.map((entry) => (entry.id === id ? { ...entry, enabled } : entry));
}

export function setBreakpointCondition(
  list: readonly Breakpoint[],
  id: string,
  condition: string | null,
): Breakpoint[] {
  return list.map((entry) => {
    if (entry.id !== id) {
      return entry;
    }

    if (condition === null || condition.trim() === "") {
      const { condition: _cleared, ...rest } = entry;

      return rest;
    }

    const updated = { ...entry, condition };
    return isDebugBreakpointModel(updated) ? updated : entry;
  });
}

export function setBreakpointHitCondition(
  list: readonly Breakpoint[],
  id: string,
  hitCondition: BreakpointHitCondition | null,
): Breakpoint[] {
  return list.map((entry) => {
    if (entry.id !== id) return entry;

    if (hitCondition === null) {
      const { hitCondition: _cleared, ...rest } = entry;
      return rest;
    }

    if (!isBreakpointHitCondition(hitCondition)) return entry;

    return { ...entry, hitCondition };
  });
}

export function setBreakpointLogMessage(
  list: readonly Breakpoint[],
  id: string,
  logMessage: string | null,
): Breakpoint[] {
  return list.map((entry) => {
    if (entry.id !== id) return entry;
    if (logMessage === null || logMessage.trim() === "") {
      const { logMessage: _cleared, ...rest } = entry;
      return rest;
    }
    if (!isBreakpointLogMessage(logMessage)) return entry;
    return { ...entry, logMessage };
  });
}

export function removeBreakpoint(list: readonly Breakpoint[], id: string): Breakpoint[] {
  return list.filter((entry) => entry.id !== id);
}

export function breakpointsForFile(list: readonly Breakpoint[], filePath: string): Breakpoint[] {
  return list.filter((entry) => entry.filePath === filePath).sort(compareDebugBreakpoints);
}

export function applyVerification(
  list: readonly Breakpoint[],
  filePath: string,
  verified: readonly Breakpoint[],
): Breakpoint[] {
  return list.map((entry) => {
    if (entry.filePath !== filePath) {
      return entry;
    }

    const match = verified.find((candidate) => candidate.id === entry.id);

    if (!match) {
      return { ...entry, verified: false };
    }

    return {
      ...entry,
      verified: match.verified ?? true,
    };
  });
}

export function shiftBreakpointsForEdit(
  list: readonly Breakpoint[],
  filePath: string,
  startLine: number,
  lineDelta: number,
): Breakpoint[] {
  if (lineDelta === 0) {
    return [...list];
  }

  const result: Breakpoint[] = [];
  const occupiedLocations = new Set<string>();

  for (const entry of list) {
    if (entry.filePath !== filePath || entry.lineNumber < startLine) {
      const key = debugBreakpointLocationKey(entry);
      if (!occupiedLocations.has(key)) {
        occupiedLocations.add(key);
        result.push(entry);
      }
      continue;
    }

    if (lineDelta < 0 && entry.lineNumber < startLine - lineDelta) {
      continue;
    }

    const shifted = {
      ...entry,
      lineNumber: Math.max(1, entry.lineNumber + lineDelta),
    };
    const key = debugBreakpointLocationKey(shifted);
    if (!occupiedLocations.has(key)) {
      occupiedLocations.add(key);
      result.push(shifted);
    }
  }

  return result;
}

export function serializeBreakpoints(list: readonly Breakpoint[]): string {
  return JSON.stringify(
    list.map((entry) => {
      const persisted: Record<string, unknown> = {
        id: entry.id,
        filePath: entry.filePath,
        lineNumber: entry.lineNumber,
        enabled: entry.enabled,
      };

      if (entry.condition !== undefined) {
        persisted.condition = entry.condition;
      }

      if (entry.columnNumber !== undefined) {
        persisted.columnNumber = entry.columnNumber;
      }

      if (entry.hitCondition !== undefined && entry.hitCondition !== null) {
        persisted.hitCondition = entry.hitCondition;
      }

      if (entry.logMessage !== undefined && entry.logMessage !== null) {
        persisted.logMessage = entry.logMessage;
      }

      return persisted;
    }),
  );
}

function parsePersistedBreakpoint(value: unknown): Breakpoint | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.id !== "string" || record.id === "") {
    return null;
  }

  if (typeof record.filePath !== "string" || record.filePath === "") {
    return null;
  }

  if (
    typeof record.lineNumber !== "number" ||
    !Number.isInteger(record.lineNumber) ||
    record.lineNumber < 1
  ) {
    return null;
  }

  if (typeof record.enabled !== "boolean") {
    return null;
  }

  if (
    record.columnNumber !== undefined &&
    (typeof record.columnNumber !== "number" ||
      !Number.isInteger(record.columnNumber) ||
      record.columnNumber < 1 ||
      record.columnNumber > 4_294_967_295)
  ) {
    return null;
  }

  const breakpoint: Breakpoint = {
    id: record.id,
    filePath: record.filePath,
    lineNumber: record.lineNumber,
    enabled: record.enabled,
  };

  if (typeof record.columnNumber === "number") {
    breakpoint.columnNumber = record.columnNumber;
  }

  if (typeof record.condition === "string" && record.condition.trim() !== "") {
    breakpoint.condition = record.condition;
  }

  if (isBreakpointHitCondition(record.hitCondition)) {
    breakpoint.hitCondition = record.hitCondition;
  }

  if (isBreakpointLogMessage(record.logMessage)) {
    breakpoint.logMessage = record.logMessage;
  }

  return breakpoint;
}

export function deserializeBreakpoints(raw: string): Breakpoint[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const result: Breakpoint[] = [];

  for (const entry of parsed) {
    const breakpoint = parsePersistedBreakpoint(entry);

    if (!breakpoint) {
      continue;
    }

    result.push(breakpoint);
  }

  return sanitizeDebugBreakpoints(result);
}
