import { describe, expect, it } from "vitest";
import {
  EMPTY_AGENT_THREAD_BRANCH_MEMORY,
  agentThreadBranchOf,
  rememberAgentThreadBranch,
} from "../domain/agentThreadBranchMemory";
import {
  AGENT_THREAD_BRANCH_MEMORY_STORAGE_KEY,
  BrowserAgentThreadBranchMemory,
} from "./browserAgentThreadBranchMemory";
import type { KeyValueStorage } from "./browserSettingsGateway";

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const THREAD = { threadId: "t-1", rootKey: "/repo", ownerId: "w1" };

describe("BrowserAgentThreadBranchMemory", () => {
  it("persists and reloads the remembered branches", () => {
    const storage = new MemoryStorage();
    const adapter = new BrowserAgentThreadBranchMemory(storage);
    adapter.save(rememberAgentThreadBranch(EMPTY_AGENT_THREAD_BRANCH_MEMORY, THREAD, "main"));
    expect(agentThreadBranchOf(new BrowserAgentThreadBranchMemory(storage).load(), THREAD)).toBe(
      "main",
    );
  });

  it("loads an empty memory from a corrupt payload", () => {
    const storage = new MemoryStorage();
    storage.setItem(AGENT_THREAD_BRANCH_MEMORY_STORAGE_KEY, "{broken");
    expect(new BrowserAgentThreadBranchMemory(storage).load().size).toBe(0);
  });

  it("survives a storage that throws", () => {
    const failing: KeyValueStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      removeItem: () => undefined,
      setItem: () => {
        throw new Error("quota");
      },
    };
    const adapter = new BrowserAgentThreadBranchMemory(failing);
    expect(adapter.load().size).toBe(0);
    expect(() => adapter.save(EMPTY_AGENT_THREAD_BRANCH_MEMORY)).not.toThrow();
  });
});
