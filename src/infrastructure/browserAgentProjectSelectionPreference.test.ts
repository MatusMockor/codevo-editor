import { describe, expect, it } from "vitest";
import {
  AGENT_PROJECT_SELECTION_STORAGE_KEY,
  BrowserAgentProjectSelectionPreference,
} from "./browserAgentProjectSelectionPreference";
import type { KeyValueStorage } from "./browserSettingsGateway";

const SELECTION = {
  projectRootKey: "/work/app",
  threadId: "agt-one",
  repositoryRoot: "/work/app",
};

function memoryStorage(): KeyValueStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
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
    throw new DOMException("quota", "QuotaExceededError");
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

describe("BrowserAgentProjectSelectionPreference", () => {
  it("uses a versioned app-wide key", () => {
    expect(AGENT_PROJECT_SELECTION_STORAGE_KEY).toBe("editor.agentNavigation.projectSelections.v1");
  });

  it("round-trips the remembered selections through storage", () => {
    const storage = memoryStorage();
    new BrowserAgentProjectSelectionPreference(storage).save([SELECTION]);

    expect(new BrowserAgentProjectSelectionPreference(storage).load()).toEqual([SELECTION]);
  });

  it("removes the key when nothing is remembered", () => {
    const storage = memoryStorage();
    const preference = new BrowserAgentProjectSelectionPreference(storage);
    preference.save([SELECTION]);
    preference.save([]);

    expect(storage.values.has(AGENT_PROJECT_SELECTION_STORAGE_KEY)).toBe(false);
  });

  it("fails closed when storage is corrupt, missing or throws", () => {
    const corrupt = memoryStorage();
    corrupt.values.set(AGENT_PROJECT_SELECTION_STORAGE_KEY, "{broken");

    expect(new BrowserAgentProjectSelectionPreference(corrupt).load()).toEqual([]);
    expect(new BrowserAgentProjectSelectionPreference(null).load()).toEqual([]);
    expect(new BrowserAgentProjectSelectionPreference(throwingStorage()).load()).toEqual([]);
    expect(() =>
      new BrowserAgentProjectSelectionPreference(throwingStorage()).save([SELECTION]),
    ).not.toThrow();
  });
});
