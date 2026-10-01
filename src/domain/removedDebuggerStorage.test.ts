import { describe, expect, it } from "vitest";
import {
  MAX_REMOVED_DEBUGGER_STORAGE_SCAN,
  purgeRemovedDebuggerStorage,
  type RemovedDebuggerStoragePort,
} from "./removedDebuggerStorage";

function memoryStorage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  const storage: RemovedDebuggerStoragePort = {
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
  };
  return { map, storage };
}

describe("purgeRemovedDebuggerStorage", () => {
  it("removes every legacy debugger key and keeps unrelated keys", () => {
    const { map, storage } = memoryStorage({
      "mockor.debug.breakpoints./workspace": "[]",
      "mockor.debug.breakpointGroups.collapsed./workspace": "[]",
      "mockor.debug.consoleHistory./workspace": "[]",
      "mockor.debug.functionBreakpoints./workspace": "[]",
      "mockor.debug.functionBreakpointsMigrationOwner./workspace": "owner",
      "mockor.debug.watch./workspace": "[]",
      "mockor.settings": "{}",
      "mockor.debugger": "unrelated",
      "other.mockor.debug.x": "unrelated",
    });

    expect(purgeRemovedDebuggerStorage(storage)).toBe(6);
    expect([...map.keys()].sort()).toEqual([
      "mockor.debugger",
      "mockor.settings",
      "other.mockor.debug.x",
    ]);
  });

  it("is a no-op without storage or matching keys", () => {
    const { map, storage } = memoryStorage({ "mockor.settings": "{}" });

    expect(purgeRemovedDebuggerStorage(null)).toBe(0);
    expect(purgeRemovedDebuggerStorage(undefined)).toBe(0);
    expect(purgeRemovedDebuggerStorage(storage)).toBe(0);
    expect(map.size).toBe(1);
  });

  it("never throws when storage access fails", () => {
    const throwingLength: RemovedDebuggerStoragePort = {
      get length(): number {
        throw new Error("denied");
      },
      key: () => "mockor.debug.watch./workspace",
      removeItem: () => undefined,
    };
    const throwingKeyAndRemove: RemovedDebuggerStoragePort = {
      length: 2,
      key: (index) => {
        if (index === 0) throw new Error("denied");
        return "mockor.debug.watch./workspace";
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };

    expect(purgeRemovedDebuggerStorage(throwingLength)).toBe(0);
    expect(purgeRemovedDebuggerStorage(throwingKeyAndRemove)).toBe(0);
  });

  it("bounds the scan by the storage length cap", () => {
    let reads = 0;
    const storage: RemovedDebuggerStoragePort = {
      length: Number.MAX_SAFE_INTEGER,
      key: () => {
        reads += 1;
        return "mockor.settings";
      },
      removeItem: () => undefined,
    };

    expect(purgeRemovedDebuggerStorage(storage)).toBe(0);
    expect(reads).toBe(MAX_REMOVED_DEBUGGER_STORAGE_SCAN);
  });
});
