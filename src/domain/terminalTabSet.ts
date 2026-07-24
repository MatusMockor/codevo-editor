import { isWellFormedUnicode } from "./unicodeText";

export const MAX_TERMINAL_TABS = 16;
export const MAX_TERMINAL_TAB_ID_BYTES = 64;
export const MAX_TERMINAL_TAB_TITLE_BYTES = 128;
export const MAX_TERMINAL_TAB_OWNER_BYTES = 4_096;

export interface TerminalTab {
  readonly id: string;
  readonly title: string;
}

/**
 * Presentation-neutral terminal tab identity. Runtime sessions intentionally
 * live outside this state so process details and gateways cannot enter it.
 */
export interface TerminalTabSet {
  readonly activeTabId: string | null;
  readonly mruTabIds: readonly string[];
  readonly ownerKey: string | null;
  readonly tabs: readonly TerminalTab[];
}

export type TerminalTabSetAction =
  | { readonly type: "replace-owner"; readonly ownerKey: string }
  | { readonly type: "clear-owner"; readonly ownerKey: string }
  | {
      readonly type: "create";
      readonly ownerKey: string;
      readonly tab: { readonly id: string; readonly title: string };
    }
  | { readonly type: "activate"; readonly ownerKey: string; readonly tabId: string }
  | {
      readonly type: "rename";
      readonly ownerKey: string;
      readonly tabId: string;
      readonly title: string;
    }
  | { readonly type: "close"; readonly ownerKey: string; readonly tabId: string };

const EMPTY_TERMINAL_TAB_SET: TerminalTabSet = freezeState(null, [], null, []);

export function emptyTerminalTabSet(): TerminalTabSet {
  return EMPTY_TERMINAL_TAB_SET;
}

/** Owner-fenced immutable reducer with active-tab MRU fallback on close. */
export function reduceTerminalTabSet(
  state: TerminalTabSet,
  action: TerminalTabSetAction,
): TerminalTabSet {
  if (!validState(state) || !validAction(action)) return state;
  if (action.type === "replace-owner") {
    return freezeState(action.ownerKey, [], null, []);
  }
  if (state.ownerKey !== action.ownerKey) return state;
  if (action.type === "clear-owner") return EMPTY_TERMINAL_TAB_SET;
  if (action.type === "create") return createTab(state, action.tab);
  if (action.type === "activate") return activateTab(state, action.tabId);
  if (action.type === "rename") return renameTab(state, action.tabId, action.title);
  return closeTab(state, action.tabId);
}

function createTab(
  state: TerminalTabSet,
  candidate: { readonly id: string; readonly title: string },
): TerminalTabSet {
  if (state.tabs.length >= MAX_TERMINAL_TABS || state.tabs.some(({ id }) => id === candidate.id)) {
    return state;
  }
  const tab = createTerminalTab(candidate.id, candidate.title);
  if (!tab) return state;
  return freezeState(state.ownerKey, [...state.tabs, tab], tab.id, [tab.id, ...state.mruTabIds]);
}

/** Creates a reducer-safe tab value without exposing the reducer's validation internals. */
export function createTerminalTab(id: string, title: string): TerminalTab | null {
  if (!validTabId(id) || !validTitle(title)) return null;
  return Object.freeze({ id, title });
}

function activateTab(state: TerminalTabSet, tabId: string): TerminalTabSet {
  if (state.activeTabId === tabId || !hasTab(state, tabId)) return state;
  return freezeState(state.ownerKey, state.tabs, tabId, promote(state.mruTabIds, tabId));
}

function renameTab(state: TerminalTabSet, tabId: string, title: string): TerminalTabSet {
  const index = state.tabs.findIndex(({ id }) => id === tabId);
  if (index < 0 || state.tabs[index]?.title === title) return state;
  const tabs = state.tabs.map((tab, tabIndex) =>
    tabIndex === index ? Object.freeze({ ...tab, title }) : tab,
  );
  return freezeState(state.ownerKey, tabs, state.activeTabId, state.mruTabIds);
}

function closeTab(state: TerminalTabSet, tabId: string): TerminalTabSet {
  if (!hasTab(state, tabId)) return state;
  const tabs = state.tabs.filter(({ id }) => id !== tabId);
  const mru = state.mruTabIds.filter((id) => id !== tabId);
  const activeTabId = state.activeTabId === tabId ? (mru[0] ?? null) : state.activeTabId;
  return freezeState(state.ownerKey, tabs, activeTabId, mru);
}

function promote(ids: readonly string[], tabId: string): readonly string[] {
  return [tabId, ...ids.filter((id) => id !== tabId)];
}

function hasTab(state: TerminalTabSet, tabId: string): boolean {
  return state.tabs.some(({ id }) => id === tabId);
}

function validAction(action: TerminalTabSetAction): boolean {
  if (!plainRecord(action) || !validOwnerKey(action.ownerKey)) return false;
  if (action.type === "replace-owner" || action.type === "clear-owner") {
    return hasExactKeys(action, ["ownerKey", "type"]);
  }
  if (action.type === "create") {
    return (
      hasExactKeys(action, ["ownerKey", "tab", "type"]) &&
      plainRecord(action.tab) &&
      hasExactKeys(action.tab, ["id", "title"]) &&
      validTabId(action.tab.id) &&
      validTitle(action.tab.title)
    );
  }
  if (action.type === "activate" || action.type === "close") {
    return hasExactKeys(action, ["ownerKey", "tabId", "type"]) && validTabId(action.tabId);
  }
  if (action.type === "rename") {
    return (
      hasExactKeys(action, ["ownerKey", "tabId", "title", "type"]) &&
      validTabId(action.tabId) &&
      validTitle(action.title)
    );
  }
  return false;
}

function validState(state: TerminalTabSet): boolean {
  if (
    !plainRecord(state) ||
    !hasExactKeys(state, ["activeTabId", "mruTabIds", "ownerKey", "tabs"]) ||
    (state.ownerKey !== null && !validOwnerKey(state.ownerKey)) ||
    !Array.isArray(state.tabs) ||
    !Array.isArray(state.mruTabIds) ||
    state.tabs.length > MAX_TERMINAL_TABS
  ) {
    return false;
  }
  const ids = state.tabs.map(({ id }) => id);
  return (
    state.tabs.every(
      (tab) =>
        plainRecord(tab) &&
        hasExactKeys(tab, ["id", "title"]) &&
        validTabId(tab.id) &&
        validTitle(tab.title),
    ) &&
    new Set(ids).size === ids.length &&
    (state.activeTabId === null || ids.includes(state.activeTabId)) &&
    state.mruTabIds.length === ids.length &&
    new Set(state.mruTabIds).size === ids.length &&
    state.mruTabIds.every((id) => ids.includes(id)) &&
    (ids.length === 0 ? state.activeTabId === null : state.activeTabId !== null)
  );
}

function validOwnerKey(value: unknown): value is string {
  return boundedCleanString(value, MAX_TERMINAL_TAB_OWNER_BYTES);
}

function validTabId(value: unknown): value is string {
  return boundedCleanString(value, MAX_TERMINAL_TAB_ID_BYTES) && value === value.trim();
}

function validTitle(value: unknown): value is string {
  return boundedCleanString(value, MAX_TERMINAL_TAB_TITLE_BYTES) && value === value.trim();
}

function boundedCleanString(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !/[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value) &&
    new TextEncoder().encode(value).byteLength <= maxBytes &&
    isWellFormedUnicode(value)
  );
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return false;
  }
  return true;
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function freezeState(
  ownerKey: string | null,
  tabs: readonly TerminalTab[],
  activeTabId: string | null,
  mruTabIds: readonly string[],
): TerminalTabSet {
  return Object.freeze({
    activeTabId,
    mruTabIds: Object.freeze([...mruTabIds]),
    ownerKey,
    tabs: Object.freeze([...tabs]),
  });
}
