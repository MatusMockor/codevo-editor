import { describe, expect, it } from "vitest";
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
});

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
