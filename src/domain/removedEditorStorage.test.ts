import { describe, expect, it } from "vitest";
import {
  REMOVED_EDITOR_STORAGE_KEYS,
  purgeRemovedEditorStorage,
  type RemovedEditorStoragePort,
} from "./removedEditorStorage";

function memoryStorage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  const storage: RemovedEditorStoragePort = {
    getItem: (key) => map.get(key) ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
  };
  return { map, storage };
}

describe("purgeRemovedEditorStorage", () => {
  it("removes only the two editor bridge keys", () => {
    const kept = {
      "editor.settings.app": "{}",
      "editor.settings.workspace:canonical:%2Fworkspace": "{}",
      "editor.settings.workspace:%2Flegacy": "{}",
      "editor.agentThreads": "[]",
      "editor.agentSidebarRail": "{}",
      "codevo.qaBridge.extra": "kept",
      "codevo.settings": "{}",
      "mockor.debug.watch./workspace": "[]",
    };
    const { map, storage } = memoryStorage({
      ...kept,
      "codevo.qaBridge": "1",
      "codevo.perfBridge": "1",
    });

    expect(purgeRemovedEditorStorage(storage)).toBe(2);
    expect(Object.fromEntries(map)).toEqual(kept);
  });

  it("purges exactly the documented keys", () => {
    expect(REMOVED_EDITOR_STORAGE_KEYS).toEqual(["codevo.qaBridge", "codevo.perfBridge"]);
  });

  it("is a no-op when the keys are absent or storage is unavailable", () => {
    const { map, storage } = memoryStorage({ "editor.settings.app": "{}" });

    expect(purgeRemovedEditorStorage(storage)).toBe(0);
    expect(purgeRemovedEditorStorage(null)).toBe(0);
    expect(purgeRemovedEditorStorage(undefined)).toBe(0);
    expect([...map.keys()]).toEqual(["editor.settings.app"]);
  });

  it("keeps going when one key cannot be read or removed", () => {
    const removed: string[] = [];
    const storage: RemovedEditorStoragePort = {
      getItem: (key) => {
        if (key === "codevo.qaBridge") throw new Error("denied");
        return "1";
      },
      removeItem: (key) => {
        removed.push(key);
      },
    };
    const throwingRemove: RemovedEditorStoragePort = {
      getItem: () => "1",
      removeItem: (key) => {
        if (key === "codevo.qaBridge") throw new Error("denied");
        removed.push(key);
      },
    };

    expect(purgeRemovedEditorStorage(storage)).toBe(1);
    expect(purgeRemovedEditorStorage(throwingRemove)).toBe(1);
    expect(removed).toEqual(["codevo.perfBridge", "codevo.perfBridge"]);
  });
});
