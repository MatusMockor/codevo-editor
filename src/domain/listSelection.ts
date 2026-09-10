import type { KeymapPlatform } from "./keymap";

export interface ListSelection {
  readonly ids: ReadonlySet<string>;
  readonly anchorId: string | null;
  readonly leadId: string | null;
}

export interface ListSelectionOwner {
  readonly key: string;
  readonly generation: number;
}

export interface OwnedListSelection {
  readonly owner: ListSelectionOwner;
  readonly selection: ListSelection;
}

export interface ListSelectionModifiers {
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}

export type ListSelectionGesture = "open" | "toggle" | "extend";

export type ListSelectionCommit =
  | { readonly kind: "ownerChanged" }
  | {
      readonly kind: "ready";
      readonly owner: ListSelectionOwner;
      readonly ids: ReadonlyArray<string>;
      readonly missingIds: ReadonlyArray<string>;
    };

export const EMPTY_LIST_SELECTION: ListSelection = {
  ids: new Set<string>(),
  anchorId: null,
  leadId: null,
};

export function listSelectionOwner(
  previous: ListSelectionOwner | null,
  key: string,
): ListSelectionOwner {
  if (previous !== null && previous.key === key) return previous;
  return { key, generation: (previous?.generation ?? -1) + 1 };
}

export function sameListSelectionOwner(
  left: ListSelectionOwner,
  right: ListSelectionOwner,
): boolean {
  return left.key === right.key && left.generation === right.generation;
}

export function ownedListSelection(owner: ListSelectionOwner): OwnedListSelection {
  return { owner, selection: EMPTY_LIST_SELECTION };
}

export function rebaseOwnedSelection(
  current: OwnedListSelection,
  owner: ListSelectionOwner,
): OwnedListSelection {
  if (sameListSelectionOwner(current.owner, owner)) return current;
  return ownedListSelection(owner);
}

export function isSelected(selection: ListSelection, id: string): boolean {
  return selection.ids.has(id);
}

export function selectionCount(selection: ListSelection): number {
  return selection.ids.size;
}

export function clearSelection(): ListSelection {
  return EMPTY_LIST_SELECTION;
}

export function replaceSelection(id: string, order: ReadonlyArray<string>): ListSelection | null {
  if (!order.includes(id)) return null;
  return { ids: new Set([id]), anchorId: id, leadId: id };
}

export function toggleSelection(
  current: ListSelection,
  id: string,
  order: ReadonlyArray<string>,
): ListSelection | null {
  if (!order.includes(id)) return null;
  const ids = new Set(current.ids);
  if (ids.has(id)) {
    ids.delete(id);
    return { ids, anchorId: id, leadId: id };
  }
  ids.add(id);
  return { ids, anchorId: id, leadId: id };
}

export function extendSelection(
  current: ListSelection,
  id: string,
  order: ReadonlyArray<string>,
): ListSelection | null {
  const index = order.indexOf(id);
  if (index < 0) return null;
  const anchorIndex = current.anchorId === null ? -1 : order.indexOf(current.anchorId);
  if (anchorIndex < 0) return replaceSelection(id, order);
  const start = Math.min(anchorIndex, index);
  const end = Math.max(anchorIndex, index);
  return { ids: new Set(order.slice(start, end + 1)), anchorId: current.anchorId, leadId: id };
}

export function applyListSelectionGesture(
  current: ListSelection,
  gesture: ListSelectionGesture,
  id: string,
  order: ReadonlyArray<string>,
): ListSelection | null {
  if (gesture === "open") return replaceSelection(id, order);
  if (gesture === "toggle") return toggleSelection(current, id, order);
  if (gesture === "extend") return extendSelection(current, id, order);
  return unsupportedListSelectionGesture(gesture);
}

export function reconcileSelection(
  current: ListSelection,
  order: ReadonlyArray<string>,
): ListSelection {
  const visible = new Set(order);
  const ids = [...current.ids].filter((id) => visible.has(id));
  const anchorId =
    current.anchorId !== null && visible.has(current.anchorId) ? current.anchorId : null;
  const leadId = current.leadId !== null && visible.has(current.leadId) ? current.leadId : null;
  if (
    ids.length === current.ids.size &&
    anchorId === current.anchorId &&
    leadId === current.leadId
  ) {
    return current;
  }
  return { ids: new Set(ids), anchorId, leadId };
}

export function hasSelectionBeyond(selection: ListSelection, activeId: string | null): boolean {
  for (const id of selection.ids) {
    if (id !== activeId) return true;
  }
  return false;
}

export function orderedSelectionIds(
  selection: ListSelection,
  order: ReadonlyArray<string>,
): ReadonlyArray<string> {
  return order.filter((id) => selection.ids.has(id));
}

export function listSelectionGesture(
  modifiers: ListSelectionModifiers,
  platform: KeymapPlatform,
): ListSelectionGesture {
  if (modifiers.shiftKey) return "extend";
  if (platform === "mac") return modifiers.metaKey ? "toggle" : "open";
  return modifiers.ctrlKey ? "toggle" : "open";
}

export function listSelectionCommit(
  current: OwnedListSelection,
  owner: ListSelectionOwner,
  order: ReadonlyArray<string>,
): ListSelectionCommit {
  if (!sameListSelectionOwner(current.owner, owner)) return { kind: "ownerChanged" };
  const visible = new Set(order);
  return {
    kind: "ready",
    owner,
    ids: orderedSelectionIds(current.selection, order),
    missingIds: [...current.selection.ids].filter((id) => !visible.has(id)).sort(),
  };
}

function unsupportedListSelectionGesture(gesture: never): never {
  throw new TypeError(`Unsupported list selection gesture: ${String(gesture)}.`);
}
