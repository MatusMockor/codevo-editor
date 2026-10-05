// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { KeyValueStorage } from "./browserSettingsGateway";
import { BrowserAgentAccountUsageStoreGateway } from "./browserAgentAccountUsageStoreGateway";

describe("BrowserAgentAccountUsageStoreGateway", () => {
  it("persists the latest bounded snapshot for each provider", () => {
    const storage = memoryStorage();
    const gateway = new BrowserAgentAccountUsageStoreGateway(storage);
    gateway.saveAgentAccountUsage(snapshot("claudeCode", 10, 20));
    gateway.saveAgentAccountUsage(snapshot("codex", 20, 30));
    gateway.saveAgentAccountUsage(snapshot("claudeCode", 30, 40));

    expect(gateway.loadAgentAccountUsage()).toMatchObject([
      { provider: "claudeCode", fetchedAtEpochMs: 30, windows: [{ usedPercent: 40 }] },
      { provider: "codex", fetchedAtEpochMs: 20, windows: [{ usedPercent: 30 }] },
    ]);
  });

  it("fails closed for malformed or oversized storage", () => {
    const storage = memoryStorage();
    const gateway = new BrowserAgentAccountUsageStoreGateway(storage);
    storage.setItem("editor.agentAccountUsage.v1", "not-json");
    expect(gateway.loadAgentAccountUsage()).toEqual([]);
    storage.setItem("editor.agentAccountUsage.v1", "x".repeat(32 * 1_024 + 1));
    expect(gateway.loadAgentAccountUsage()).toEqual([]);
  });

  it("shares newer observations only with the same storage authority and removes subscriptions", () => {
    const storage = memoryStorage();
    const a = new BrowserAgentAccountUsageStoreGateway(storage);
    const b = new BrowserAgentAccountUsageStoreGateway(storage);
    const unrelated = new BrowserAgentAccountUsageStoreGateway(memoryStorage());
    const notify = vi.fn();
    const foreign = vi.fn();
    const stop = b.subscribeAgentAccountUsage(notify);
    const stopForeign = unrelated.subscribeAgentAccountUsage(foreign);
    notify.mockClear();
    foreign.mockClear();
    a.saveAgentAccountUsage(snapshot("codex", 30, 40));
    a.saveAgentAccountUsage(snapshot("codex", 20, 10));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(foreign).not.toHaveBeenCalled();
    expect(b.loadAgentAccountUsage()).toMatchObject([{ fetchedAtEpochMs: 30 }]);
    stop();
    stopForeign();
    a.saveAgentAccountUsage(snapshot("codex", 40, 50));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("retains and replays newer live readings when persistence reads and writes fail", () => {
    const persisted = memoryStorage();
    const storage = {
      ...persisted,
      getItem: vi.fn(persisted.getItem),
      setItem: vi.fn(persisted.setItem),
    };
    const a = new BrowserAgentAccountUsageStoreGateway(storage);
    a.saveAgentAccountUsage(snapshot("codex", 1, 1));
    storage.getItem.mockImplementation(() => {
      throw new Error("read denied");
    });
    storage.setItem.mockImplementation(() => {
      throw new Error("write denied");
    });
    const notify = vi.fn();
    const stop = a.subscribeAgentAccountUsage(notify);
    notify.mockClear();
    expect(() => a.saveAgentAccountUsage(snapshot("codex", 100, 40))).toThrow("write denied");
    expect(notify).toHaveBeenCalledWith({ kind: "snapshot", snapshot: snapshot("codex", 100, 40) });
    const b = new BrowserAgentAccountUsageStoreGateway(storage);
    expect(b.loadAgentAccountUsage()).toEqual([snapshot("codex", 100, 40)]);
    storage.getItem.mockImplementation(persisted.getItem);
    storage.setItem.mockImplementation(persisted.setItem);
    b.saveAgentAccountUsage(snapshot("codex", 50, 20));
    expect(b.loadAgentAccountUsage()).toEqual([snapshot("codex", 100, 40)]);
    expect(notify).toHaveBeenCalledTimes(1);
    stop();
  });

  it("reads current cross-window storage instead of replaying delayed event payloads", () => {
    const storage = memoryStorage();
    const gateway = new BrowserAgentAccountUsageStoreGateway(storage);
    const notify = vi.fn();
    const stop = gateway.subscribeAgentAccountUsage(notify);
    storage.setItem("editor.agentAccountUsage.v1", JSON.stringify([snapshot("codex", 30, 40)]));
    window.dispatchEvent(storageEvent(storage, "editor.agentAccountUsage.v1", "[]"));
    expect(notify).toHaveBeenCalledWith({ kind: "snapshot", snapshot: snapshot("codex", 30, 40) });
    notify.mockClear();
    window.dispatchEvent(storageEvent(memoryStorage(), "editor.agentAccountUsage.v1", "[]"));
    window.dispatchEvent(storageEvent(storage, "unrelated", "[]"));
    expect(notify).not.toHaveBeenCalled();
    stop();
    window.dispatchEvent(storageEvent(storage, "editor.agentAccountUsage.v1", "[]"));
    expect(notify).not.toHaveBeenCalled();
  });

  it("propagates explicit account invalidation but ignores corrupt cross-window storage", () => {
    const storage = memoryStorage();
    const gateway = new BrowserAgentAccountUsageStoreGateway(storage);
    const notify = vi.fn();
    const stop = gateway.subscribeAgentAccountUsage(notify);
    gateway.saveAgentAccountUsage(snapshot("codex", 30, 40));
    notify.mockClear();
    storage.setItem("editor.agentAccountUsage.v1", "not-json");
    window.dispatchEvent(storageEvent(storage, "editor.agentAccountUsage.v1", "not-json"));
    expect(notify).not.toHaveBeenCalled();
    expect(gateway.loadAgentAccountUsage()).toEqual([snapshot("codex", 30, 40)]);
    gateway.invalidateAgentAccountUsage("codex");
    expect(notify).toHaveBeenCalledWith({ kind: "invalidated", provider: "codex" });
    expect(gateway.loadAgentAccountUsage()).toEqual([]);
    stop();
  });

  it("does not resurrect a previous account from a delayed storage event after failed invalidation", () => {
    const persisted = memoryStorage();
    const storage = { ...persisted, setItem: vi.fn(persisted.setItem) };
    const gateway = new BrowserAgentAccountUsageStoreGateway(storage);
    gateway.saveAgentAccountUsage(snapshot("codex", 100, 80));
    const notify = vi.fn();
    const stop = gateway.subscribeAgentAccountUsage(notify);
    storage.setItem.mockImplementation(() => {
      throw new Error("write denied");
    });
    expect(() => gateway.invalidateAgentAccountUsage("codex")).toThrow("write denied");
    notify.mockClear();
    window.dispatchEvent(storageEvent(storage, "editor.agentAccountUsage.v1", "old data"));
    expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "snapshot" }));
    expect(gateway.loadAgentAccountUsage()).toEqual([]);
    stop();
  });

  it("does not clear an unsaved live reading when a delayed event still sees empty storage", () => {
    const persisted = memoryStorage();
    const storage = {
      ...persisted,
      setItem: vi.fn(() => {
        throw new Error("write denied");
      }),
    };
    const gateway = new BrowserAgentAccountUsageStoreGateway(storage);
    const notify = vi.fn();
    const stop = gateway.subscribeAgentAccountUsage(notify);
    expect(() => gateway.saveAgentAccountUsage(snapshot("codex", 100, 80))).toThrow("write denied");
    notify.mockClear();
    window.dispatchEvent(storageEvent(storage, "editor.agentAccountUsage.v1", "[]"));
    expect(notify).not.toHaveBeenCalledWith({ kind: "invalidated", provider: "codex" });
    expect(gateway.loadAgentAccountUsage()).toEqual([snapshot("codex", 100, 80)]);
    stop();
  });
});

function storageEvent(storageArea: KeyValueStorage, key: string, newValue: string): Event {
  return Object.assign(new Event("storage"), { storageArea, key, newValue });
}

function snapshot(provider: "claudeCode" | "codex", fetchedAtEpochMs: number, usedPercent: number) {
  return {
    provider,
    fetchedAtEpochMs,
    windows: [
      {
        id: "primary",
        label: "Weekly limit",
        usedPercent,
        windowDurationMinutes: 10_080,
        resetsAtEpochMs: null,
        resetsLabel: null,
      },
    ],
  } as const;
}

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}
