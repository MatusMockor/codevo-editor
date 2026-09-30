import { describe, expect, it } from "vitest";
import {
  AGENT_RAIL_FILTER_STORAGE_KEY,
  BrowserAgentRailFilterPreference,
} from "./browserAgentRailFilterPreference";
import type { KeyValueStorage } from "./browserSettingsGateway";

function memoryStorage(initial: string | null = null): KeyValueStorage & {
  readonly values: Map<string, string>;
} {
  const values = new Map<string, string>();
  if (initial !== null) values.set(AGENT_RAIL_FILTER_STORAGE_KEY, initial);
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

function loaded(raw: string | null) {
  return new BrowserAgentRailFilterPreference(memoryStorage(raw)).load();
}

describe("BrowserAgentRailFilterPreference", () => {
  it("uses the versioned app-wide key", () => {
    expect(AGENT_RAIL_FILTER_STORAGE_KEY).toBe("editor.agentSidebar.projectFilter.v1");
  });

  it("starts on All projects when nothing is stored", () => {
    expect(loaded(null)).toEqual({ kind: "all" });
  });

  it("round-trips All projects and a single project", () => {
    const storage = memoryStorage();
    const preference = new BrowserAgentRailFilterPreference(storage);
    preference.save({ kind: "project", projectRootKey: "/workspace/orders" });
    expect(JSON.parse(storage.values.get(AGENT_RAIL_FILTER_STORAGE_KEY) ?? "null")).toEqual({
      kind: "project",
      projectRootKey: "/workspace/orders",
    });
    expect(preference.load()).toEqual({ kind: "project", projectRootKey: "/workspace/orders" });
    preference.save({ kind: "all" });
    expect(preference.load()).toEqual({ kind: "all" });
  });

  it("parses the two valid shapes exactly", () => {
    expect(loaded('{"kind":"all"}')).toEqual({ kind: "all" });
    expect(loaded('{"kind":"project","projectRootKey":"remote:linux:runner:p"}')).toEqual({
      kind: "project",
      projectRootKey: "remote:linux:runner:p",
    });
  });

  it.each([
    ["not JSON", "{kind:all"],
    ["an empty string", ""],
    ["a JSON string", '"all"'],
    ["null", "null"],
    ["an array", '[{"kind":"all"}]'],
    ["an unknown kind", '{"kind":"recent"}'],
    ["a project without a key", '{"kind":"project"}'],
    ["an empty project key", '{"kind":"project","projectRootKey":""}'],
    ["a numeric project key", '{"kind":"project","projectRootKey":7}'],
  ])("fails closed to All projects for %s", (_label, raw) => {
    expect(loaded(raw)).toEqual({ kind: "all" });
  });

  it("rejects unknown fields on either shape", () => {
    expect(loaded('{"kind":"all","projectRootKey":"/a"}')).toEqual({ kind: "all" });
    expect(loaded('{"kind":"project","projectRootKey":"/a","label":"a"}')).toEqual({
      kind: "all",
    });
  });

  it("rejects an oversize project key and an oversize payload", () => {
    const atLimit = "/".padEnd(4_096, "a");
    expect(loaded(JSON.stringify({ kind: "project", projectRootKey: atLimit }))).toEqual({
      kind: "project",
      projectRootKey: atLimit,
    });
    const overLimit = "/".padEnd(4_097, "a");
    expect(loaded(JSON.stringify({ kind: "project", projectRootKey: overLimit }))).toEqual({
      kind: "all",
    });
    expect(loaded(`{"kind":"all"}${" ".repeat(10_000)}`)).toEqual({ kind: "all" });
  });

  it("swallows storage failures on load and save", () => {
    const preference = new BrowserAgentRailFilterPreference(throwingStorage());
    expect(preference.load()).toEqual({ kind: "all" });
    expect(() => preference.save({ kind: "project", projectRootKey: "/a" })).not.toThrow();
  });

  it("works without storage", () => {
    const preference = new BrowserAgentRailFilterPreference(null);
    expect(preference.load()).toEqual({ kind: "all" });
    expect(() => preference.save({ kind: "all" })).not.toThrow();
  });
});
