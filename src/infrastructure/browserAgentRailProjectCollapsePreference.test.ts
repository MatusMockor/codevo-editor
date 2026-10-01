import { describe, expect, it } from "vitest";
import {
  AGENT_RAIL_COLLAPSED_PROJECTS_STORAGE_KEY,
  BrowserAgentRailProjectCollapsePreference,
  RETIRED_AGENT_RAIL_FILTER_STORAGE_KEY,
} from "./browserAgentRailProjectCollapsePreference";
import type { KeyValueStorage } from "./browserSettingsGateway";

function memoryStorage(entries: Record<string, string> = {}): KeyValueStorage & {
  readonly values: Map<string, string>;
} {
  const values = new Map(Object.entries(entries));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function throwingStorage(): KeyValueStorage {
  const fail = (): never => {
    throw new DOMException("denied", "SecurityError");
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

describe("BrowserAgentRailProjectCollapsePreference", () => {
  it("uses a versioned app-wide key", () => {
    expect(AGENT_RAIL_COLLAPSED_PROJECTS_STORAGE_KEY).toBe(
      "editor.agentSidebar.collapsedProjects.v1",
    );
  });

  it("starts with every project expanded", () => {
    expect(new BrowserAgentRailProjectCollapsePreference(memoryStorage()).load()).toEqual([]);
  });

  it("round-trips the collapsed projects and clears the key once nothing is collapsed", () => {
    const storage = memoryStorage();
    const preference = new BrowserAgentRailProjectCollapsePreference(storage);
    preference.save(["/workspace/app"]);
    expect(new BrowserAgentRailProjectCollapsePreference(storage).load()).toEqual([
      "/workspace/app",
    ]);
    preference.save([]);
    expect(storage.values.has(AGENT_RAIL_COLLAPSED_PROJECTS_STORAGE_KEY)).toBe(false);
  });

  it("forgets the retired project filter without reading it", () => {
    const storage = memoryStorage({
      [RETIRED_AGENT_RAIL_FILTER_STORAGE_KEY]:
        '{"kind":"project","projectRootKey":"/workspace/app"}',
    });
    expect(new BrowserAgentRailProjectCollapsePreference(storage).load()).toEqual([]);
    expect(storage.values.has(RETIRED_AGENT_RAIL_FILTER_STORAGE_KEY)).toBe(false);
  });

  it("ignores a corrupt stored value", () => {
    const storage = memoryStorage({ [AGENT_RAIL_COLLAPSED_PROJECTS_STORAGE_KEY]: "{oops" });
    expect(new BrowserAgentRailProjectCollapsePreference(storage).load()).toEqual([]);
  });

  it("degrades to expanded and drops writes when storage is unavailable", () => {
    const preference = new BrowserAgentRailProjectCollapsePreference(throwingStorage());
    expect(preference.load()).toEqual([]);
    expect(() => preference.save(["/workspace/app"])).not.toThrow();
    const missing = new BrowserAgentRailProjectCollapsePreference(null);
    expect(missing.load()).toEqual([]);
    expect(() => missing.save(["/workspace/app"])).not.toThrow();
  });
});
