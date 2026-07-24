import { describe, expect, it } from "vitest";
import {
  emptyTerminalTabSet,
  MAX_TERMINAL_TABS,
  MAX_TERMINAL_TAB_ID_BYTES,
  MAX_TERMINAL_TAB_TITLE_BYTES,
  reduceTerminalTabSet,
  type TerminalTabSet,
  type TerminalTabSetAction,
} from "./terminalTabSet";

const OWNER_A = "workspace-a";
const OWNER_B = "workspace-b";

describe("TerminalTabSet", () => {
  it("creates stable tabs and keeps exactly one active tab", () => {
    let state = owner(OWNER_A);
    state = reduceTerminalTabSet(state, create("one", "API"));
    state = reduceTerminalTabSet(state, create("two", "Web"));

    expect(state).toEqual({
      activeTabId: "two",
      mruTabIds: ["two", "one"],
      ownerKey: OWNER_A,
      tabs: [
        { id: "one", title: "API" },
        { id: "two", title: "Web" },
      ],
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.tabs)).toBe(true);
    expect(state.tabs.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(state.mruTabIds)).toBe(true);
  });

  it("activates idempotently and closes the active tab to the MRU survivor", () => {
    let state = tabs("one", "two", "three");
    state = reduceTerminalTabSet(state, activate("one"));
    state = reduceTerminalTabSet(state, activate("two"));
    expect(state.mruTabIds).toEqual(["two", "one", "three"]);

    state = reduceTerminalTabSet(state, close("two"));
    expect(state.activeTabId).toBe("one");
    expect(state.mruTabIds).toEqual(["one", "three"]);
    state = reduceTerminalTabSet(state, close("three"));
    expect(state.activeTabId).toBe("one");
    state = reduceTerminalTabSet(state, close("one"));
    expect(state).toMatchObject({ activeTabId: null, mruTabIds: [], tabs: [] });
  });

  it("renames without changing identity, order, active tab, or MRU", () => {
    const initial = tabs("one", "two");
    const renamed = reduceTerminalTabSet(initial, rename("one", "Server"));

    expect(renamed.tabs).toEqual([
      { id: "one", title: "Server" },
      { id: "two", title: "two" },
    ]);
    expect(renamed.activeTabId).toBe(initial.activeTabId);
    expect(renamed.mruTabIds).toEqual(initial.mruTabIds);
    expect(reduceTerminalTabSet(renamed, rename("one", "Server"))).toBe(renamed);
  });

  it("rejects duplicate IDs and enforces the bounded tab count", () => {
    let state = tabs("one");
    expect(reduceTerminalTabSet(state, create("one", "Duplicate"))).toBe(state);
    for (let index = 1; index < MAX_TERMINAL_TABS; index += 1) {
      state = reduceTerminalTabSet(state, create(`tab-${index}`, `Tab ${index}`));
    }
    expect(state.tabs).toHaveLength(MAX_TERMINAL_TABS);
    expect(reduceTerminalTabSet(state, create("overflow", "Overflow"))).toBe(state);
  });

  it.each([
    create("", "Title"),
    create(" id", "Title"),
    create("id", ""),
    create("id", " Title"),
    create("x".repeat(MAX_TERMINAL_TAB_ID_BYTES + 1), "Title"),
    create("id", "x".repeat(MAX_TERMINAL_TAB_TITLE_BYTES + 1)),
    create("id", "bad\nname"),
    activate("missing"),
    close("missing"),
    rename("missing", "Name"),
    { ownerKey: OWNER_A, type: "unknown" } as unknown as TerminalTabSetAction,
    { ownerKey: OWNER_A, tab: { id: "id", title: "Name", session: "secret" }, type: "create" },
  ])("fails closed for malformed or stale operation %#", (action) => {
    const state = tabs("one");
    expect(reduceTerminalTabSet(state, action as TerminalTabSetAction)).toBe(state);
  });

  it("rejects every mutation owned by another workspace", () => {
    const state = tabs("one", "two");
    for (const action of [
      { ...create("three", "Three"), ownerKey: OWNER_B },
      { ...activate("one"), ownerKey: OWNER_B },
      { ...rename("one", "Renamed"), ownerKey: OWNER_B },
      { ...close("one"), ownerKey: OWNER_B },
      { ownerKey: OWNER_B, type: "clear-owner" as const },
    ]) {
      expect(reduceTerminalTabSet(state, action)).toBe(state);
    }
  });

  it("replaces and clears workspace ownership explicitly", () => {
    const state = tabs("one", "two");
    const replaced = reduceTerminalTabSet(state, { ownerKey: OWNER_B, type: "replace-owner" });
    expect(replaced).toEqual({
      activeTabId: null,
      mruTabIds: [],
      ownerKey: OWNER_B,
      tabs: [],
    });
    expect(reduceTerminalTabSet(replaced, { ownerKey: OWNER_A, type: "clear-owner" })).toBe(
      replaced,
    );
    expect(reduceTerminalTabSet(replaced, { ownerKey: OWNER_B, type: "clear-owner" })).toBe(
      emptyTerminalTabSet(),
    );
  });

  it("stores no runtime, output, process, shell, session, secret, or gateway fields", () => {
    const state = tabs("one");
    const serialized = JSON.stringify(state);
    for (const forbidden of [
      "output",
      "process",
      "shell",
      "session",
      "secret",
      "gateway",
      "args",
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
    expect(Object.keys(state.tabs[0] ?? {})).toEqual(["id", "title"]);
  });

  it("fails closed when given a forged invalid state", () => {
    const forged = {
      activeTabId: "missing",
      mruTabIds: [],
      ownerKey: OWNER_A,
      tabs: [],
    } as TerminalTabSet;
    expect(reduceTerminalTabSet(forged, create("one", "One"))).toBe(forged);
  });
});

function owner(ownerKey: string): TerminalTabSet {
  return reduceTerminalTabSet(emptyTerminalTabSet(), { ownerKey, type: "replace-owner" });
}

function tabs(...ids: string[]): TerminalTabSet {
  return ids.reduce((state, id) => reduceTerminalTabSet(state, create(id, id)), owner(OWNER_A));
}

function create(id: string, title: string): TerminalTabSetAction {
  return { ownerKey: OWNER_A, tab: { id, title }, type: "create" };
}

function activate(tabId: string): TerminalTabSetAction {
  return { ownerKey: OWNER_A, tabId, type: "activate" };
}

function rename(tabId: string, title: string): TerminalTabSetAction {
  return { ownerKey: OWNER_A, tabId, title, type: "rename" };
}

function close(tabId: string): TerminalTabSetAction {
  return { ownerKey: OWNER_A, tabId, type: "close" };
}
