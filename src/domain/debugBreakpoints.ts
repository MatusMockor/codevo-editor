import type { Breakpoint } from "./debug";

export type BreakpointIdFactory = () => string;

export function sequentialBreakpointIdFactory(start = 1): BreakpointIdFactory {
  let next = start;

  return () => {
    const id = `bp-${next}`;
    next += 1;

    return id;
  };
}

function isAtLocation(
  breakpoint: Breakpoint,
  filePath: string,
  lineNumber: number,
): boolean {
  return breakpoint.filePath === filePath && breakpoint.lineNumber === lineNumber;
}

export function toggleBreakpoint(
  list: readonly Breakpoint[],
  filePath: string,
  lineNumber: number,
  createId: BreakpointIdFactory,
): Breakpoint[] {
  if (list.some((entry) => isAtLocation(entry, filePath, lineNumber))) {
    return list.filter((entry) => !isAtLocation(entry, filePath, lineNumber));
  }

  return [...list, { id: createId(), filePath, lineNumber, enabled: true }];
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

    return { ...entry, condition };
  });
}

export function removeBreakpoint(
  list: readonly Breakpoint[],
  id: string,
): Breakpoint[] {
  return list.filter((entry) => entry.id !== id);
}

export function breakpointsForFile(
  list: readonly Breakpoint[],
  filePath: string,
): Breakpoint[] {
  return list
    .filter((entry) => entry.filePath === filePath)
    .sort((left, right) => left.lineNumber - right.lineNumber);
}

export function applyVerification(
  list: readonly Breakpoint[],
  filePath: string,
  verified: readonly Breakpoint[],
): Breakpoint[] {
  const adjusted = list.map((entry) => {
    if (entry.filePath !== filePath) {
      return entry;
    }

    const match = verified.find((candidate) => candidate.id === entry.id);

    if (!match) {
      return { ...entry, verified: false };
    }

    return {
      ...entry,
      lineNumber: match.lineNumber,
      verified: match.verified ?? true,
    };
  });

  const occupiedLines = new Set<number>();
  const result: Breakpoint[] = [];

  for (const entry of adjusted) {
    if (entry.filePath !== filePath) {
      result.push(entry);
      continue;
    }

    if (occupiedLines.has(entry.lineNumber)) {
      continue;
    }

    occupiedLines.add(entry.lineNumber);
    result.push(entry);
  }

  return result;
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

  for (const entry of list) {
    if (entry.filePath !== filePath || entry.lineNumber < startLine) {
      result.push(entry);
      continue;
    }

    if (lineDelta < 0 && entry.lineNumber < startLine - lineDelta) {
      continue;
    }

    result.push({
      ...entry,
      lineNumber: Math.max(1, entry.lineNumber + lineDelta),
    });
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

  const breakpoint: Breakpoint = {
    id: record.id,
    filePath: record.filePath,
    lineNumber: record.lineNumber,
    enabled: record.enabled,
  };

  if (typeof record.condition === "string" && record.condition.trim() !== "") {
    breakpoint.condition = record.condition;
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

  return result;
}
