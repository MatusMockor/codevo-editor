import { describe, expect, it } from "vitest";
import {
  AGENT_COMPOSER_DRAFTS_STORAGE_KEY,
  BrowserAgentComposerDraftPreference,
} from "./browserAgentComposerDraftPreference";
import type { KeyValueStorage } from "./browserSettingsGateway";

function memoryStorage(initial: string | null = null): KeyValueStorage & {
  readonly values: Map<string, string>;
} {
  const values = new Map<string, string>();
  if (initial !== null) values.set(AGENT_COMPOSER_DRAFTS_STORAGE_KEY, initial);
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

function throwingStorage(error: Error): KeyValueStorage {
  const fail = (): never => {
    throw error;
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

describe("BrowserAgentComposerDraftPreference", () => {
  it("uses the versioned app-wide key", () => {
    expect(AGENT_COMPOSER_DRAFTS_STORAGE_KEY).toBe("editor.agentComposer.drafts.v1");
  });

  it("loads no drafts when nothing is stored", () => {
    expect(new BrowserAgentComposerDraftPreference(memoryStorage()).load()).toEqual([]);
  });

  it("round-trips thread drafts in recency order and never stores new-thread drafts", () => {
    const storage = memoryStorage();
    const preference = new BrowserAgentComposerDraftPreference(storage);

    preference.save([
      ["agt-mue1wenj-7ede", "reply"],
      ["new:/workspace/app", "new thread"],
      ["agt-mue1wenj-9c1f", "follow up"],
      ["clone:local:p-1", "ephemeral"],
    ]);

    expect(JSON.parse(storage.values.get(AGENT_COMPOSER_DRAFTS_STORAGE_KEY) ?? "null")).toEqual({
      version: 1,
      drafts: [
        ["agt-mue1wenj-7ede", "reply"],
        ["agt-mue1wenj-9c1f", "follow up"],
      ],
    });
    expect(new BrowserAgentComposerDraftPreference(storage).load()).toEqual([
      ["agt-mue1wenj-7ede", "reply"],
      ["agt-mue1wenj-9c1f", "follow up"],
    ]);
  });

  it("ignores a new-thread draft left in storage by an earlier version", () => {
    const stored = JSON.stringify({
      version: 1,
      drafts: [
        ["agt-mue1wenj-7ede", "reply"],
        ["new:/workspace/app", "typed before quitting"],
      ],
    });

    expect(new BrowserAgentComposerDraftPreference(memoryStorage(stored)).load()).toEqual([
      ["agt-mue1wenj-7ede", "reply"],
    ]);
  });

  it("removes the key when there is nothing left to persist", () => {
    const storage = memoryStorage();
    const preference = new BrowserAgentComposerDraftPreference(storage);
    preference.save([["agt-1", "draft"]]);

    preference.save([]);
    expect(storage.values.has(AGENT_COMPOSER_DRAFTS_STORAGE_KEY)).toBe(false);

    preference.save([["agt-1", "draft"]]);
    preference.save([["clone:local:p-1", "only an ephemeral draft"]]);
    expect(storage.values.has(AGENT_COMPOSER_DRAFTS_STORAGE_KEY)).toBe(false);

    preference.save([["agt-1", "draft"]]);
    preference.save([["new:/workspace/app", "only a new-thread draft"]]);
    expect(storage.values.has(AGENT_COMPOSER_DRAFTS_STORAGE_KEY)).toBe(false);
  });

  it("fails closed on a corrupt stored value", () => {
    expect(new BrowserAgentComposerDraftPreference(memoryStorage("{not json")).load()).toEqual([]);
    expect(
      new BrowserAgentComposerDraftPreference(
        memoryStorage('{"version":2,"drafts":[["agt-1","draft"]]}'),
      ).load(),
    ).toEqual([]);
  });

  it("swallows storage failures including an exceeded quota", () => {
    const denied = new BrowserAgentComposerDraftPreference(
      throwingStorage(new DOMException("denied", "SecurityError")),
    );
    const full = new BrowserAgentComposerDraftPreference(
      throwingStorage(new DOMException("full", "QuotaExceededError")),
    );

    expect(denied.load()).toEqual([]);
    expect(() => denied.save([["agt-1", "draft"]])).not.toThrow();
    expect(() => denied.save([])).not.toThrow();
    expect(() => full.save([["agt-1", "draft"]])).not.toThrow();
  });

  it("works without storage", () => {
    const preference = new BrowserAgentComposerDraftPreference(null);

    expect(preference.load()).toEqual([]);
    expect(() => preference.save([["agt-1", "draft"]])).not.toThrow();
  });
});
