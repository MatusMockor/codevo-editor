import { describe, expect, it } from "vitest";
import { AGENT_RAIL_PROJECT_FOCUS_STORAGE_KEY } from "./browserAgentRailProjectFocusPreference";
import {
  AGENT_RAIL_WORKING_SECTION_STORAGE_KEY,
  BrowserAgentRailWorkingSectionPreference,
} from "./browserAgentRailWorkingSectionPreference";
import type { KeyValueStorage } from "./browserSettingsGateway";

function memoryStorage(entries: Record<string, string> = {}): KeyValueStorage & {
  readonly values: Map<string, string>;
  readonly reads: string[];
} {
  const values = new Map(Object.entries(entries));
  const reads: string[] = [];
  return {
    values,
    reads,
    getItem: (key) => {
      reads.push(key);
      return values.get(key) ?? null;
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function revokedStorage(): KeyValueStorage {
  const access = Proxy.revocable<KeyValueStorage>(memoryStorage(), {});
  access.revoke();
  return access.proxy;
}

function readOnlyStorage(entries: Record<string, string> = {}): KeyValueStorage {
  const readable = memoryStorage(entries);
  const blocked = revokedStorage();
  return {
    getItem: readable.getItem,
    setItem: (key, value) => blocked.setItem(key, value),
    removeItem: (key) => blocked.removeItem(key),
  };
}

describe("BrowserAgentRailWorkingSectionPreference", () => {
  it("uses its own versioned key", () => {
    expect(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY).toBe("editor.agentSidebar.workingSection.v1");
    expect(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY).not.toBe(AGENT_RAIL_PROJECT_FOCUS_STORAGE_KEY);
  });

  it("starts off and round-trips the working section preference", () => {
    const storage = memoryStorage();
    const preference = new BrowserAgentRailWorkingSectionPreference(storage);
    expect(preference.load()).toBe("off");
    expect(preference.persistence()).toBe("persisted");

    expect(preference.save("on")).toBe("persisted");
    expect(preference.load()).toBe("on");
    expect(storage.values.get(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY)).toBe("on");
    expect(new BrowserAgentRailWorkingSectionPreference(storage).load()).toBe("on");

    expect(preference.save("off")).toBe("persisted");
    expect(storage.values.has(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY)).toBe(false);
    expect(new BrowserAgentRailWorkingSectionPreference(storage).load()).toBe("off");
  });

  it("leaves other sidebar preferences untouched", () => {
    const storage = memoryStorage({ [AGENT_RAIL_PROJECT_FOCUS_STORAGE_KEY]: "active" });
    const preference = new BrowserAgentRailWorkingSectionPreference(storage);

    preference.save("on");
    preference.save("off");

    expect(storage.values.get(AGENT_RAIL_PROJECT_FOCUS_STORAGE_KEY)).toBe("active");
  });

  it("fails closed to off on a corrupt stored value", () => {
    for (const corrupt of ["true", "1", "ON", " on", '{"enabled":true}', "\u0000"]) {
      const storage = memoryStorage({ [AGENT_RAIL_WORKING_SECTION_STORAGE_KEY]: corrupt });
      expect(new BrowserAgentRailWorkingSectionPreference(storage).load()).toBe("off");
    }
  });

  it("tells its own subscribers about every save until they unsubscribe", () => {
    const storage = memoryStorage();
    const preference = new BrowserAgentRailWorkingSectionPreference(storage);
    const seen: string[] = [];
    const unsubscribe = preference.subscribe(() => seen.push(preference.load()));

    preference.save("on");
    preference.save("off");
    expect(seen).toEqual(["on", "off"]);

    unsubscribe();
    preference.save("on");
    expect(seen).toEqual(["on", "off"]);
  });

  it("keeps subscribers of separate instances apart", () => {
    const storage = memoryStorage();
    const first = new BrowserAgentRailWorkingSectionPreference(storage);
    const second = new BrowserAgentRailWorkingSectionPreference(storage);
    const seen: string[] = [];
    const unsubscribe = first.subscribe(() => seen.push("first"));

    second.save("on");

    expect(seen).toEqual([]);
    unsubscribe();
  });

  it("reads storage once while it has subscribers instead of on every load", () => {
    const storage = memoryStorage({ [AGENT_RAIL_WORKING_SECTION_STORAGE_KEY]: "on" });
    const preference = new BrowserAgentRailWorkingSectionPreference(storage);
    const unsubscribe = preference.subscribe(() => undefined);
    storage.reads.length = 0;

    expect([preference.load(), preference.load(), preference.load()]).toEqual(["on", "on", "on"]);
    expect(storage.reads).toEqual([AGENT_RAIL_WORKING_SECTION_STORAGE_KEY]);

    preference.save("off");
    expect(preference.load()).toBe("off");
    expect(storage.reads).toEqual([AGENT_RAIL_WORKING_SECTION_STORAGE_KEY]);

    unsubscribe();
    storage.values.set(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY, "on");
    expect(preference.load()).toBe("on");
  });

  it("keeps an unwritable change for the session, announces it and reports the lost persistence", () => {
    const storage = readOnlyStorage();
    const preference = new BrowserAgentRailWorkingSectionPreference(storage);
    const seen: string[] = [];
    const unsubscribe = preference.subscribe(() =>
      seen.push(`${preference.load()}:${preference.persistence()}`),
    );

    expect(preference.save("on")).toBe("sessionOnly");
    expect(preference.load()).toBe("on");
    expect(preference.persistence()).toBe("sessionOnly");
    expect(seen).toEqual(["on:sessionOnly"]);

    unsubscribe();
    expect(preference.load()).toBe("on");
    expect(new BrowserAgentRailWorkingSectionPreference(storage).load()).toBe("off");
  });

  it("reports persistence again once a later save can be written", () => {
    const values = memoryStorage();
    const blocked = revokedStorage();
    let writable = false;
    const storage: KeyValueStorage = {
      getItem: values.getItem,
      setItem: (key, value) =>
        writable ? values.setItem(key, value) : blocked.setItem(key, value),
      removeItem: (key) => (writable ? values.removeItem(key) : blocked.removeItem(key)),
    };
    const preference = new BrowserAgentRailWorkingSectionPreference(storage);

    expect(preference.save("on")).toBe("sessionOnly");
    writable = true;
    expect(preference.save("on")).toBe("persisted");
    expect(preference.persistence()).toBe("persisted");
    expect(values.values.get(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY)).toBe("on");
  });

  it("survives unavailable storage", () => {
    const unavailable = revokedStorage();
    expect(() => unavailable.getItem(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY)).toThrow(TypeError);
    const preference = new BrowserAgentRailWorkingSectionPreference(unavailable);
    expect(preference.load()).toBe("off");
    expect(preference.save("on")).toBe("sessionOnly");
    expect(preference.load()).toBe("on");
    expect(preference.save("off")).toBe("sessionOnly");
    expect(preference.load()).toBe("off");

    const absent = new BrowserAgentRailWorkingSectionPreference(null);
    expect(absent.load()).toBe("off");
    expect(absent.save("on")).toBe("sessionOnly");
    expect(absent.load()).toBe("on");
    expect(new BrowserAgentRailWorkingSectionPreference(null).load()).toBe("off");
  });
});
