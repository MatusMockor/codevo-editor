import { describe, expect, it } from "vitest";
import {
  AGENT_RAIL_PROJECT_FOCUS_STORAGE_KEY,
  BrowserAgentRailProjectFocusPreference,
} from "./browserAgentRailProjectFocusPreference";
import { RETIRED_AGENT_RAIL_FILTER_STORAGE_KEY } from "./browserAgentRailProjectCollapsePreference";
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

describe("BrowserAgentRailProjectFocusPreference", () => {
  it("uses a new versioned key, separate from the retired project filter", () => {
    expect(AGENT_RAIL_PROJECT_FOCUS_STORAGE_KEY).toBe("editor.agentSidebar.projectFocus.v1");
    expect(AGENT_RAIL_PROJECT_FOCUS_STORAGE_KEY).not.toBe(RETIRED_AGENT_RAIL_FILTER_STORAGE_KEY);
  });

  it("starts on all projects and round-trips the active project focus", () => {
    const storage = memoryStorage();
    const preference = new BrowserAgentRailProjectFocusPreference(storage);
    expect(preference.load()).toBe("all");

    preference.save("active");
    expect(new BrowserAgentRailProjectFocusPreference(storage).load()).toBe("active");

    preference.save("all");
    expect(storage.values.has(AGENT_RAIL_PROJECT_FOCUS_STORAGE_KEY)).toBe(false);
    expect(new BrowserAgentRailProjectFocusPreference(storage).load()).toBe("all");
  });

  it("ignores an unknown stored value", () => {
    const storage = memoryStorage({ [AGENT_RAIL_PROJECT_FOCUS_STORAGE_KEY]: "project:/x" });
    expect(new BrowserAgentRailProjectFocusPreference(storage).load()).toBe("all");
  });

  it("survives unavailable storage", () => {
    const preference = new BrowserAgentRailProjectFocusPreference(throwingStorage());
    expect(preference.load()).toBe("all");
    expect(() => preference.save("active")).not.toThrow();
    expect(new BrowserAgentRailProjectFocusPreference(null).load()).toBe("all");
  });
});
