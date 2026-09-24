import { describe, expect, it } from "vitest";
import {
  AGENT_SIDEBAR_RAIL_STORAGE_KEY,
  BrowserAgentSidebarRailPreference,
} from "./browserAgentSidebarRailPreference";
import type { KeyValueStorage } from "./browserSettingsGateway";

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
  readonly values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("BrowserAgentSidebarRailPreference", () => {
  it("round-trips the global sidebar state", () => {
    const storage = memoryStorage();
    const preference = new BrowserAgentSidebarRailPreference(storage);

    expect(preference.read()).toBeNull();

    preference.write("collapsed");

    expect(storage.values.get(AGENT_SIDEBAR_RAIL_STORAGE_KEY)).toBe("collapsed");
    expect(preference.read()).toBe("collapsed");

    preference.write("expanded");

    expect(new BrowserAgentSidebarRailPreference(storage).read()).toBe("expanded");
  });

  it.each(["", "hidden", "Collapsed", '"collapsed"', "x".repeat(4_096)])(
    "fails closed for the unknown stored value %#",
    (stored) => {
      const preference = new BrowserAgentSidebarRailPreference(
        memoryStorage({ [AGENT_SIDEBAR_RAIL_STORAGE_KEY]: stored }),
      );

      expect(preference.read()).toBeNull();
    },
  );
});
