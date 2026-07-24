import { describe, expect, it, vi } from "vitest";
import {
  MAX_DEBUG_WATCH_STORAGE_BYTES,
  debugWatchStorageKey,
  deserializeDebugWatchDefinitions,
  loadPersistedDebugWatchDefinitions,
  savePersistedDebugWatchDefinitions,
  serializeDebugWatchDefinitions,
  type DebugWatchStorage,
} from "./debugWatchPersistence";

const definitions = [
  { id: "watch-1", expression: "count", enabled: true, revision: 1 },
  { id: "watch-2", expression: "user.name", enabled: false, revision: 2 },
] as const;

describe("debug watch persistence", () => {
  it("uses normalized workspace-scoped keys", () => {
    expect(debugWatchStorageKey("/workspace/")).toBe(debugWatchStorageKey("/workspace"));
    expect(debugWatchStorageKey("/workspace-a")).not.toBe(debugWatchStorageKey("/workspace-b"));
  });

  it("round-trips only v1 definitions", () => {
    const serialized = serializeDebugWatchDefinitions(definitions);
    expect(serialized).not.toBeNull();
    expect(JSON.parse(serialized!)).toEqual({ version: 1, definitions });
    expect(deserializeDebugWatchDefinitions(serialized!)).toEqual(definitions);
    expect(serialized).not.toContain("value");
  });

  it("round-trips a near-limit escaped payload with 100 ids", () => {
    const nearLimit = Array.from({ length: 100 }, (_, index) => ({
      id: `watch-${index + 1}`,
      expression: `${index}:${'\\\\"'.repeat(98)}`,
      enabled: index % 2 === 0,
      revision: index + 1,
    }));
    const serialized = serializeDebugWatchDefinitions(nearLimit);
    expect(serialized).not.toBeNull();
    expect(new TextEncoder().encode(serialized!).byteLength).toBeGreaterThan(65_000);
    expect(deserializeDebugWatchDefinitions(serialized!)).toEqual(nearLimit);

    const values = new Map<string, string>();
    const storage: DebugWatchStorage = {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => {
        values.set(key, value);
      },
    };
    expect(savePersistedDebugWatchDefinitions(storage, "/workspace", nearLimit)).toBe(true);
    expect(loadPersistedDebugWatchDefinitions(storage, "/workspace")).toEqual(nearLimit);
  });

  it("migrates a bounded legacy string array with deterministic metadata", () => {
    expect(deserializeDebugWatchDefinitions(JSON.stringify(["count", "žluťoučký"]))).toEqual([
      { id: "watch-1", expression: "count", enabled: true, revision: 1 },
      { id: "watch-2", expression: "žluťoučký", enabled: true, revision: 2 },
    ]);
  });

  it.each([
    "not json",
    "null",
    "{}",
    JSON.stringify({ version: 2, definitions }),
    JSON.stringify({ version: 1, definitions, extra: true }),
    JSON.stringify({ version: 1, definitions: [{ ...definitions[0], extra: true }] }),
    JSON.stringify({ version: 1, definitions: [definitions[0], definitions[0]] }),
    JSON.stringify(["count", "count"]),
    JSON.stringify(["ok", 7]),
  ])("fails closed for malformed or ambiguous storage", (raw) => {
    expect(deserializeDebugWatchDefinitions(raw)).toEqual([]);
  });

  it("checks the total serialized UTF-8 size before parsing or saving", () => {
    const oversized = `${JSON.stringify({ version: 1, definitions })}${" ".repeat(
      MAX_DEBUG_WATCH_STORAGE_BYTES,
    )}`;
    expect(deserializeDebugWatchDefinitions(oversized)).toEqual([]);
    expect(
      serializeDebugWatchDefinitions([{ ...definitions[0], expression: "x".repeat(4_096) }]),
    ).not.toBeNull();
    const nearLimit = Array.from({ length: 16 }, (_, index) => ({
      id: `watch-${index + 1}`,
      expression: `${index}:${"x".repeat(4_080)}`,
      enabled: true,
      revision: index + 1,
    }));
    expect(serializeDebugWatchDefinitions(nearLimit)).toBeNull();
  });

  it("loads, saves, removes empty state and contains storage failures", () => {
    const values = new Map<string, string>();
    const storage: DebugWatchStorage = {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => {
        values.delete(key);
      },
      setItem: (key, value) => {
        values.set(key, value);
      },
    };
    expect(savePersistedDebugWatchDefinitions(storage, "/workspace", definitions)).toBe(true);
    expect(loadPersistedDebugWatchDefinitions(storage, "/workspace")).toEqual(definitions);
    expect(savePersistedDebugWatchDefinitions(storage, "/workspace", [])).toBe(true);
    expect(loadPersistedDebugWatchDefinitions(storage, "/workspace")).toEqual([]);

    const failed = {
      getItem: vi.fn(() => {
        throw new Error("denied");
      }),
      removeItem: vi.fn(() => {
        throw new Error("denied");
      }),
      setItem: vi.fn(() => {
        throw new Error("denied");
      }),
    };
    expect(loadPersistedDebugWatchDefinitions(failed, "/workspace")).toEqual([]);
    expect(savePersistedDebugWatchDefinitions(failed, "/workspace", definitions)).toBe(false);
  });
});
