import { describe, expect, it } from "vitest";
import { EMPTY_MODEL_FIRST_SEEN_LEDGER, observeModelCatalogs } from "../domain/modelNewness";
import {
  BrowserModelFirstSeenRepository,
  MODEL_FIRST_SEEN_STORAGE_KEY,
} from "./browserModelFirstSeenRepository";
import type { KeyValueStorage } from "./browserSettingsGateway";

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();
  failWrites = false;
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException("full", "QuotaExceededError");
    this.values.set(key, value);
  }
}

describe("BrowserModelFirstSeenRepository", () => {
  it("round-trips the bounded first-seen ledger", () => {
    const storage = new MemoryStorage();
    const repository = new BrowserModelFirstSeenRepository(storage);
    const ledger = observeModelCatalogs(
      EMPTY_MODEL_FIRST_SEEN_LEDGER,
      [{ provider: "codex", modelIds: ["a"], live: true }],
      1,
    );
    repository.write(ledger);
    expect(storage.values.has(MODEL_FIRST_SEEN_STORAGE_KEY)).toBe(true);
    expect(repository.read()).toEqual(ledger);
  });

  it("fails closed to an empty ledger on missing or corrupt storage", () => {
    const storage = new MemoryStorage();
    const repository = new BrowserModelFirstSeenRepository(storage);
    expect(repository.read()).toBe(EMPTY_MODEL_FIRST_SEEN_LEDGER);
    for (const raw of ["{", "null", JSON.stringify({ version: 9, entries: [] })]) {
      storage.values.set(MODEL_FIRST_SEEN_STORAGE_KEY, raw);
      expect(repository.read()).toBe(EMPTY_MODEL_FIRST_SEEN_LEDGER);
    }
  });

  it("does not throw when storage rejects the write", () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const repository = new BrowserModelFirstSeenRepository(storage);
    expect(() => repository.write(EMPTY_MODEL_FIRST_SEEN_LEDGER)).not.toThrow();
  });
});
