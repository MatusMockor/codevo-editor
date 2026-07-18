import { describe, expect, it } from "vitest";
import type { Breakpoint } from "./debug";
import {
  debugBreakpointStorageKey,
  loadPersistedBreakpoints,
  savePersistedBreakpoints,
  type BreakpointStorage,
} from "./debugBreakpointPersistence";

function memoryStorage(): BreakpointStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();

  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

const BREAKPOINTS: Breakpoint[] = [
  {
    id: "bp-1",
    filePath: "/workspace/src/index.ts",
    lineNumber: 12,
    enabled: true,
    condition: "count > 2",
  },
  {
    id: "bp-2",
    filePath: "/workspace/src/app.ts",
    lineNumber: 3,
    enabled: false,
    verified: true,
  },
];

describe("debugBreakpointPersistence", () => {
  it("derives the storage key from the normalized workspace root", () => {
    expect(debugBreakpointStorageKey("/workspace/app/")).toBe(
      "mockor.debug.breakpoints./workspace/app",
    );
  });

  it("round-trips breakpoints per workspace root", () => {
    const storage = memoryStorage();

    savePersistedBreakpoints(storage, "/workspace/app", BREAKPOINTS);
    const restored = loadPersistedBreakpoints(storage, "/workspace/app/");

    expect(restored).toEqual([
      {
        id: "bp-1",
        filePath: "/workspace/src/index.ts",
        lineNumber: 12,
        enabled: true,
        condition: "count > 2",
      },
      {
        id: "bp-2",
        filePath: "/workspace/src/app.ts",
        lineNumber: 3,
        enabled: false,
      },
    ]);
  });

  it("returns an empty list for missing or corrupted entries", () => {
    const storage = memoryStorage();

    expect(loadPersistedBreakpoints(storage, "/workspace/app")).toEqual([]);

    storage.setItem(debugBreakpointStorageKey("/workspace/app"), "{not json");
    expect(loadPersistedBreakpoints(storage, "/workspace/app")).toEqual([]);
  });

  it("removes the entry when saving an empty list", () => {
    const storage = memoryStorage();

    savePersistedBreakpoints(storage, "/workspace/app", BREAKPOINTS);
    savePersistedBreakpoints(storage, "/workspace/app", []);

    expect(storage.entries.size).toBe(0);
  });

  it("returns an empty list when the storage read fails", () => {
    const storage: BreakpointStorage = {
      getItem: () => {
        throw new Error("storage denied");
      },
      removeItem: () => undefined,
      setItem: () => undefined,
    };

    expect(loadPersistedBreakpoints(storage, "/workspace/app")).toEqual([]);
  });

  it("silently ignores storage write failures", () => {
    const storage: BreakpointStorage = {
      getItem: () => null,
      removeItem: () => {
        throw new Error("storage denied");
      },
      setItem: () => {
        throw new Error("storage denied");
      },
    };

    expect(() =>
      savePersistedBreakpoints(storage, "/workspace/app", BREAKPOINTS),
    ).not.toThrow();
    expect(() =>
      savePersistedBreakpoints(storage, "/workspace/app", []),
    ).not.toThrow();
  });

  it("keeps breakpoints isolated between workspace roots", () => {
    const storage = memoryStorage();

    savePersistedBreakpoints(storage, "/workspace/a", [BREAKPOINTS[0]]);
    savePersistedBreakpoints(storage, "/workspace/b", [BREAKPOINTS[1]]);

    expect(loadPersistedBreakpoints(storage, "/workspace/a")).toHaveLength(1);
    expect(
      loadPersistedBreakpoints(storage, "/workspace/b")[0]?.id,
    ).toBe("bp-2");
  });
});
