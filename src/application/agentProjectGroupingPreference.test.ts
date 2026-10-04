// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  DEFAULT_AGENT_PROJECT_GROUPING_SETTINGS,
  MAX_AGENT_PROJECT_GROUPING_OVERRIDES,
} from "../domain/agentProjectGrouping";
import {
  AGENT_PROJECT_GROUPING_STORAGE_KEY,
  clearAgentProjectGroupingOverrides,
  readAgentProjectGrouping,
  readAgentProjectGroupingStorageState,
  resetAgentProjectGrouping,
  saveAgentProjectGroupingMode,
  saveAgentProjectGroupingOverride,
  subscribeAgentProjectGrouping,
} from "./agentProjectGroupingPreference";

const KEY = AGENT_PROJECT_GROUPING_STORAGE_KEY;
const REMOTE = "remote:linux:runner:project";
const SAVED = { kind: "saved" };
const CORRUPT = { kind: "rejected", reason: "storageCorrupt" };
const UNAVAILABLE = { kind: "rejected", reason: "storageUnavailable" };
const UNTRUSTED_STORAGE = [
  "{bad",
  "[]",
  "null",
  '"separate"',
  JSON.stringify({ mode: "repository_path", overrides: [] }),
  JSON.stringify({ mode: "repository", overrides: [["/a", "repository_path"]] }),
  JSON.stringify({ mode: "separate" }),
  JSON.stringify({ mode: "separate", overrides: [], extra: 1 }),
  JSON.stringify({
    mode: "separate",
    overrides: [
      ["/a", "separate"],
      ["/a", "repository"],
    ],
  }),
  JSON.stringify({
    mode: "separate",
    overrides: Array.from({ length: MAX_AGENT_PROJECT_GROUPING_OVERRIDES + 1 }, (_, index) => [
      `/projects/p${index}`,
      "separate",
    ]),
  }),
  `{"mode":"separate","overrides":[]}${" ".repeat(2_000_000)}`,
];

function fullStorage(): string {
  return JSON.stringify({
    mode: "repository",
    overrides: Array.from({ length: MAX_AGENT_PROJECT_GROUPING_OVERRIDES }, (_, index) => [
      `/projects/p${index}`,
      "separate",
    ]),
  });
}

function failingStorage(method: "getItem" | "setItem" | "removeItem") {
  return vi.spyOn(Storage.prototype, method).mockImplementation(() => {
    throw new DOMException("The storage operation failed.", "QuotaExceededError");
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it("uses the versioned per-device storage key", () => {
  expect(KEY).toBe("codevo.project-grouping.v1");
});

it("defaults to repository grouping when nothing is stored", () => {
  expect(readAgentProjectGrouping()).toBe(DEFAULT_AGENT_PROJECT_GROUPING_SETTINGS);
  expect(readAgentProjectGroupingStorageState()).toBe("readable");
});

it("round-trips the mode and overrides and notifies subscribers", () => {
  const notify = vi.fn();
  const unsubscribe = subscribeAgentProjectGrouping(notify);
  expect(saveAgentProjectGroupingMode("separate")).toEqual(SAVED);
  expect(saveAgentProjectGroupingOverride(REMOTE, "repository")).toEqual(SAVED);
  expect(saveAgentProjectGroupingOverride("/workspace/app", "separate")).toEqual(SAVED);
  const settings = readAgentProjectGrouping();
  expect(settings.mode).toBe("separate");
  expect([...settings.overrides]).toEqual([
    [REMOTE, "repository"],
    ["/workspace/app", "separate"],
  ]);
  expect(readAgentProjectGrouping()).toBe(settings);
  expect(readAgentProjectGroupingStorageState()).toBe("readable");
  expect(JSON.parse(localStorage.getItem(KEY) ?? "null")).toEqual({
    mode: "separate",
    overrides: [
      [REMOTE, "repository"],
      ["/workspace/app", "separate"],
    ],
  });
  expect(saveAgentProjectGroupingOverride(REMOTE, null)).toEqual(SAVED);
  expect([...readAgentProjectGrouping().overrides]).toEqual([["/workspace/app", "separate"]]);
  expect(notify).toHaveBeenCalledTimes(4);
  unsubscribe();
  expect(saveAgentProjectGroupingMode("repository")).toEqual(SAVED);
  expect(notify).toHaveBeenCalledTimes(4);
});

it("skips the write and the notification when a save changes nothing", () => {
  expect(saveAgentProjectGroupingOverride(REMOTE, "separate")).toEqual(SAVED);
  const settings = readAgentProjectGrouping();
  const notify = vi.fn();
  const unsubscribe = subscribeAgentProjectGrouping(notify);
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  expect(saveAgentProjectGroupingMode("repository")).toEqual(SAVED);
  expect(saveAgentProjectGroupingOverride(REMOTE, "separate")).toEqual(SAVED);
  expect(saveAgentProjectGroupingOverride("/workspace/app", null)).toEqual(SAVED);
  expect(clearAgentProjectGroupingOverrides(["/workspace/app"])).toEqual(SAVED);
  expect(clearAgentProjectGroupingOverrides([])).toEqual(SAVED);
  expect(setItem).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
  expect(readAgentProjectGrouping()).toBe(settings);
  unsubscribe();
});

it("does not create storage for a no-op save on an empty store", () => {
  expect(saveAgentProjectGroupingMode("repository")).toEqual(SAVED);
  expect(saveAgentProjectGroupingOverride(REMOTE, null)).toEqual(SAVED);
  expect(localStorage.getItem(KEY)).toBeNull();
});

it("clears several overrides in a single write", () => {
  saveAgentProjectGroupingOverride("/a", "separate");
  saveAgentProjectGroupingOverride("/b", "separate");
  saveAgentProjectGroupingOverride(REMOTE, "separate");
  const notify = vi.fn();
  const unsubscribe = subscribeAgentProjectGrouping(notify);
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  expect(clearAgentProjectGroupingOverrides(["/a", REMOTE, "/never-saved"])).toEqual(SAVED);
  expect(setItem).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledTimes(1);
  expect([...readAgentProjectGrouping().overrides]).toEqual([["/b", "separate"]]);
  expect(clearAgentProjectGroupingOverrides(["/b", ""])).toEqual({
    kind: "rejected",
    reason: "invalidProject",
  });
  expect([...readAgentProjectGrouping().overrides]).toEqual([["/b", "separate"]]);
  unsubscribe();
});

it.each(UNTRUSTED_STORAGE)("fails closed to the default for untrusted storage %#", (raw) => {
  localStorage.setItem(KEY, raw);
  expect(readAgentProjectGrouping()).toBe(DEFAULT_AGENT_PROJECT_GROUPING_SETTINGS);
  expect(readAgentProjectGroupingStorageState()).toBe("corrupt");
});

it.each(UNTRUSTED_STORAGE)("never overwrites untrusted storage %# on a save", (raw) => {
  localStorage.setItem(KEY, raw);
  const notify = vi.fn();
  const unsubscribe = subscribeAgentProjectGrouping(notify);
  expect(saveAgentProjectGroupingMode("separate")).toEqual(CORRUPT);
  expect(saveAgentProjectGroupingOverride(REMOTE, "separate")).toEqual(CORRUPT);
  expect(saveAgentProjectGroupingOverride(REMOTE, null)).toEqual(CORRUPT);
  expect(clearAgentProjectGroupingOverrides([REMOTE])).toEqual(CORRUPT);
  expect(localStorage.getItem(KEY)).toBe(raw);
  expect(notify).not.toHaveBeenCalled();
  unsubscribe();
});

it("does not parse oversized storage", () => {
  expect(readAgentProjectGrouping()).toBe(DEFAULT_AGENT_PROJECT_GROUPING_SETTINGS);
  localStorage.setItem(KEY, `{"mode":"separate","overrides":[]}${" ".repeat(2_000_000)}`);
  const parse = vi.spyOn(JSON, "parse");
  expect(readAgentProjectGrouping()).toBe(DEFAULT_AGENT_PROJECT_GROUPING_SETTINGS);
  expect(parse).not.toHaveBeenCalled();
});

it("discards unreadable storage only through an explicit reset", () => {
  localStorage.setItem(KEY, JSON.stringify({ mode: "repository_path", overrides: [] }));
  expect(saveAgentProjectGroupingOverride(REMOTE, "separate")).toEqual(CORRUPT);
  expect(localStorage.getItem(KEY)).toContain("repository_path");
  const notify = vi.fn();
  const unsubscribe = subscribeAgentProjectGrouping(notify);
  expect(resetAgentProjectGrouping()).toEqual(SAVED);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(KEY)).toBeNull();
  expect(readAgentProjectGroupingStorageState()).toBe("readable");
  expect(saveAgentProjectGroupingOverride(REMOTE, "separate")).toEqual(SAVED);
  expect([...readAgentProjectGrouping().overrides]).toEqual([[REMOTE, "separate"]]);
  unsubscribe();
});

it("rejects invalid projects and a new override at capacity without changing storage", () => {
  const raw = fullStorage();
  localStorage.setItem(KEY, raw);
  const notify = vi.fn();
  const unsubscribe = subscribeAgentProjectGrouping(notify);
  expect(saveAgentProjectGroupingOverride("/projects/extra", "separate")).toEqual({
    kind: "rejected",
    reason: "tooManyOverrides",
  });
  expect(saveAgentProjectGroupingOverride("", "separate")).toEqual({
    kind: "rejected",
    reason: "invalidProject",
  });
  expect(localStorage.getItem(KEY)).toBe(raw);
  expect(notify).not.toHaveBeenCalled();
  expect(saveAgentProjectGroupingOverride("/projects/p0", "repository")).toEqual(SAVED);
  expect(readAgentProjectGrouping().overrides.get("/projects/p0")).toBe("repository");
  expect(readAgentProjectGrouping().overrides.size).toBe(MAX_AGENT_PROJECT_GROUPING_OVERRIDES);
  unsubscribe();
});

it("reports a failed write and keeps the previous preference", () => {
  expect(saveAgentProjectGroupingMode("separate")).toEqual(SAVED);
  const stored = localStorage.getItem(KEY);
  const notify = vi.fn();
  const unsubscribe = subscribeAgentProjectGrouping(notify);
  const setItem = failingStorage("setItem");
  expect(saveAgentProjectGroupingMode("repository")).toEqual(UNAVAILABLE);
  expect(saveAgentProjectGroupingOverride(REMOTE, "separate")).toEqual(UNAVAILABLE);
  expect(setItem).toHaveBeenCalledTimes(2);
  setItem.mockRestore();
  expect(localStorage.getItem(KEY)).toBe(stored);
  expect(readAgentProjectGrouping().mode).toBe("separate");
  expect(notify).not.toHaveBeenCalled();
  unsubscribe();
});

it("fails closed when storage cannot be read or reset", () => {
  expect(saveAgentProjectGroupingMode("separate")).toEqual(SAVED);
  const getItem = failingStorage("getItem");
  expect(readAgentProjectGrouping()).toBe(DEFAULT_AGENT_PROJECT_GROUPING_SETTINGS);
  expect(readAgentProjectGroupingStorageState()).toBe("readable");
  expect(saveAgentProjectGroupingMode("repository")).toEqual(UNAVAILABLE);
  getItem.mockRestore();
  expect(readAgentProjectGrouping().mode).toBe("separate");
  const removeItem = failingStorage("removeItem");
  expect(resetAgentProjectGrouping()).toEqual(UNAVAILABLE);
  removeItem.mockRestore();
  expect(readAgentProjectGrouping().mode).toBe("separate");
});

it("publishes external storage changes for this key only", () => {
  const notify = vi.fn();
  const unsubscribe = subscribeAgentProjectGrouping(notify);
  window.dispatchEvent(new StorageEvent("storage", { key: "codevo.other" }));
  expect(notify).not.toHaveBeenCalled();
  localStorage.setItem(KEY, JSON.stringify({ mode: "separate", overrides: [] }));
  window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
  expect(notify).toHaveBeenCalledOnce();
  expect(readAgentProjectGrouping().mode).toBe("separate");
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  expect(notify).toHaveBeenCalledTimes(2);
  unsubscribe();
});
