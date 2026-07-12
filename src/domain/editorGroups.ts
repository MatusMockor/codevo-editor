import { reorderVisibleTabs, type TabDropPosition } from "./tabOrdering";
import { nextActiveEditorPathAfterClose } from "./workspace";
import {
  editorGroupIdsInLayout,
  editorGroupLayout,
  normalizeEditorLayout,
  removeEditorGroupFromLayout,
  splitEditorLayout,
  updateEditorSplitSizes,
  type EditorGroupId,
  type EditorLayout,
  type EditorSplitDirection,
} from "./editorLayout";

export type { EditorGroupId, EditorLayout, EditorSplitDirection } from "./editorLayout";

export interface EditorGroup {
  activePath: string | null;
  openPaths: string[];
  previewPath: string | null;
}

export interface EditorGroupOpenTransition {
  nextActivePath: string | null;
  nextOpenPaths: string[];
  nextPreviewPath: string | null;
}

interface EditorGroupTabReorder {
  fromPath: string;
  toPath: string;
  position: TabDropPosition;
}

type EditorGroupFieldUpdate<Value> = Value | ((current: Value) => Value);

export function createEditorGroup(
  group: EditorGroup = {
    activePath: null,
    openPaths: [],
    previewPath: null,
  },
): EditorGroup {
  return {
    ...group,
    openPaths: [...group.openPaths],
  };
}

export function activateEditorGroupPath(
  group: EditorGroup,
  activePath: string | null,
): EditorGroup {
  return { ...group, activePath };
}

export function openEditorGroupPath(
  group: EditorGroup,
  transition: EditorGroupOpenTransition,
): EditorGroup {
  return {
    ...group,
    activePath: transition.nextActivePath,
    openPaths: transition.nextOpenPaths,
    previewPath: transition.nextPreviewPath,
  };
}

export function closeEditorGroupPath(
  group: EditorGroup,
  path: string,
): EditorGroup {
  const nextOpenPaths = group.openPaths.filter((item) => item !== path);
  const nextPreviewPath = group.previewPath === path ? null : group.previewPath;

  if (group.activePath !== path) {
    return {
      ...group,
      openPaths: nextOpenPaths,
      previewPath: nextPreviewPath,
    };
  }

  return {
    activePath: nextActiveEditorPathAfterClose(
      path,
      group.openPaths,
      group.previewPath,
    ),
    openPaths: nextOpenPaths,
    previewPath: nextPreviewPath,
  };
}

export function reorderEditorGroupTabs(
  group: EditorGroup,
  reorder: EditorGroupTabReorder,
): EditorGroup {
  const reordered = reorderVisibleTabs({
    openPaths: group.openPaths,
    previewPath: group.previewPath,
    ...reorder,
  });

  return {
    ...group,
    openPaths: reordered.openPaths,
    previewPath: reordered.previewPath,
  };
}

export function updateEditorGroupOpenPaths(
  group: EditorGroup,
  update: EditorGroupFieldUpdate<string[]>,
): EditorGroup {
  return {
    ...group,
    openPaths: resolveEditorGroupFieldUpdate(group.openPaths, update),
  };
}

export function updateEditorGroupPreviewPath(
  group: EditorGroup,
  update: EditorGroupFieldUpdate<string | null>,
): EditorGroup {
  return {
    ...group,
    previewPath: resolveEditorGroupFieldUpdate(group.previewPath, update),
  };
}

function resolveEditorGroupFieldUpdate<Value>(
  current: Value,
  update: EditorGroupFieldUpdate<Value>,
): Value {
  if (typeof update === "function") {
    return (update as (value: Value) => Value)(current);
  }

  return update;
}

export interface EditorGroupsState {
  groups: Record<EditorGroupId, EditorGroup>;
  activeGroupId: EditorGroupId;
  layout: EditorLayout;
}

export type EditorGroupsAction =
  | { type: "activate-group"; groupId: EditorGroupId }
  | { type: "split-group"; groupId?: EditorGroupId; newGroupId: EditorGroupId; direction: EditorSplitDirection }
  | { type: "close-group"; groupId: EditorGroupId }
  | { type: "open-tab"; groupId?: EditorGroupId; path: string; preview?: boolean }
  | { type: "activate-tab"; groupId?: EditorGroupId; path: string }
  | { type: "pin-tab"; groupId?: EditorGroupId; path: string }
  | { type: "close-tab"; groupId?: EditorGroupId; path: string }
  | { type: "reorder-tab"; groupId?: EditorGroupId; fromPath: string; toPath: string; position: TabDropPosition }
  | { type: "transfer-tab"; fromGroupId: EditorGroupId; toGroupId: EditorGroupId; path: string; mode: "move" | "copy" }
  | { type: "promote-dirty-tab"; path: string }
  | { type: "remap-path"; fromPath: string; toPath: string }
  | { type: "resize-split"; splitPath: readonly number[]; sizes: readonly number[] };

export interface CloseEditorGroupTabResult {
  state: EditorGroupsState;
  membershipRemoved: boolean;
  finalMembershipRemoved: boolean;
}

export interface CloseEditorGroupResult {
  state: EditorGroupsState;
  closed: boolean;
  finalMembershipPaths: string[];
}

export function createInitialEditorGroupsState(
  groupId: EditorGroupId,
  group: EditorGroup = createEditorGroup(),
): EditorGroupsState {
  const normalizedGroup = normalizeGroup(group);
  return {
    groups: { [groupId]: normalizedGroup },
    activeGroupId: groupId,
    layout: editorGroupLayout(groupId),
  };
}

/** Migrates the current one-element array seam as well as repairing persisted state. */
export function normalizeEditorGroupsState(
  value: unknown,
  fallbackGroupId: EditorGroupId,
): EditorGroupsState {
  if (Array.isArray(value)) {
    const first = isEditorGroup(value[0]) ? value[0] : createEditorGroup();
    return createInitialEditorGroupsState(fallbackGroupId, first);
  }
  if (isEditorGroup(value)) {
    return createInitialEditorGroupsState(fallbackGroupId, value);
  }
  if (!isRecord(value) || !isRecord(value.groups)) {
    return createInitialEditorGroupsState(fallbackGroupId);
  }

  const groups = Object.fromEntries(
    Object.entries(value.groups).flatMap(([id, group]) =>
      id && isEditorGroup(group) ? [[id, normalizeGroup(group)]] : [],
    ),
  );
  if (Object.keys(groups).length === 0) {
    return createInitialEditorGroupsState(fallbackGroupId);
  }

  const validIds = new Set(Object.keys(groups));
  const requestedActiveId = typeof value.activeGroupId === "string" ? value.activeGroupId : "";
  const layoutFallback = validIds.has(requestedActiveId)
    ? requestedActiveId
    : Object.keys(groups)[0];
  let layout = normalizeEditorLayout(value.layout, validIds, layoutFallback);
  const laidOutIds = new Set(editorGroupIdsInLayout(layout));
  for (const groupId of Object.keys(groups)) {
    if (laidOutIds.has(groupId)) {
      continue;
    }
    const layoutGroupIds = editorGroupIdsInLayout(layout);
    const anchorId = layoutGroupIds[layoutGroupIds.length - 1];
    layout = splitEditorLayout(layout, anchorId, groupId, "right") ?? layout;
    laidOutIds.add(groupId);
  }
  const activeGroupId = laidOutIds.has(requestedActiveId)
    ? requestedActiveId
    : editorGroupIdsInLayout(layout)[0];

  return { groups, activeGroupId, layout };
}

export function editorGroupsReducer(
  state: EditorGroupsState,
  action: EditorGroupsAction,
): EditorGroupsState {
  switch (action.type) {
    case "activate-group":
      return hasOwnGroup(state.groups, action.groupId)
        ? { ...state, activeGroupId: action.groupId }
        : state;
    case "split-group":
      return splitEditorGroup(state, action.groupId ?? state.activeGroupId, action.newGroupId, action.direction);
    case "close-group":
      return closeEditorGroup(state, action.groupId).state;
    case "open-tab":
      return updateGroup(state, action.groupId, (group) => openGroupTab(group, action.path, action.preview ?? false));
    case "activate-tab":
      return updateGroup(state, action.groupId, (group) =>
        editorGroupHasPath(group, action.path) ? { ...group, activePath: action.path } : group,
      );
    case "pin-tab":
      return updateGroup(state, action.groupId, (group) => pinGroupTab(group, action.path));
    case "close-tab":
      return closeEditorGroupTab(state, action.groupId ?? state.activeGroupId, action.path).state;
    case "reorder-tab":
      return updateGroup(state, action.groupId, (group) =>
        editorGroupHasPath(group, action.fromPath) && editorGroupHasPath(group, action.toPath)
          ? reorderEditorGroupTabs(group, action)
          : group,
      );
    case "transfer-tab":
      return transferEditorGroupTab(state, action.fromGroupId, action.toGroupId, action.path, action.mode);
    case "promote-dirty-tab":
      return promoteDirtyEditorGroupPath(state, action.path);
    case "remap-path":
      return remapEditorGroupPath(state, action.fromPath, action.toPath);
    case "resize-split": {
      const layout = updateEditorSplitSizes(state.layout, action.splitPath, action.sizes);
      return layout === state.layout ? state : { ...state, layout };
    }
  }
}

export function splitEditorGroup(
  state: EditorGroupsState,
  targetGroupId: EditorGroupId,
  newGroupId: EditorGroupId,
  direction: EditorSplitDirection,
): EditorGroupsState {
  const source = getOwnGroup(state.groups, targetGroupId);
  if (!source || hasOwnGroup(state.groups, newGroupId) || !newGroupId) {
    return state;
  }
  const layout = splitEditorLayout(state.layout, targetGroupId, newGroupId, direction);
  if (!layout) {
    return state;
  }

  const currentPath = source.activePath;
  const group = currentPath
    ? createEditorGroup({
        activePath: currentPath,
        openPaths: source.previewPath === currentPath ? [] : [currentPath],
        previewPath: source.previewPath === currentPath ? currentPath : null,
      })
    : createEditorGroup();
  return {
    groups: { ...state.groups, [newGroupId]: group },
    activeGroupId: newGroupId,
    layout,
  };
}

export function closeEditorGroup(
  state: EditorGroupsState,
  groupId: EditorGroupId,
): CloseEditorGroupResult {
  const group = getOwnGroup(state.groups, groupId);
  if (!group) {
    return { state, closed: false, finalMembershipPaths: [] };
  }
  const groupIds = Object.keys(state.groups);
  if (groupIds.length === 1) {
    const nextGroup = createEditorGroup();
    const nextState = groupsEqual(group, nextGroup)
      ? state
      : { ...state, groups: { [groupId]: nextGroup } };
    return {
      state: nextState,
      closed: false,
      finalMembershipPaths: editorGroupVisiblePaths(group),
    };
  }

  const paths = editorGroupVisiblePaths(group);
  const currentLayoutIds = editorGroupIdsInLayout(state.layout);
  const closingIndex = currentLayoutIds.indexOf(groupId);
  const adjacentGroupId = currentLayoutIds[closingIndex + 1] ??
    currentLayoutIds[closingIndex - 1];
  const groups = { ...state.groups };
  delete groups[groupId];
  const layout = removeEditorGroupFromLayout(state.layout, groupId);
  if (!layout) {
    return { state, closed: false, finalMembershipPaths: [] };
  }
  const remainingIds = editorGroupIdsInLayout(layout);
  const activeGroupId = state.activeGroupId === groupId
    ? adjacentGroupId ?? remainingIds[0]
    : state.activeGroupId;
  const finalMembershipPaths = paths.filter(
    (path) => !Object.values(groups).some((candidate) => editorGroupHasPath(candidate, path)),
  );
  return { state: { groups, activeGroupId, layout }, closed: true, finalMembershipPaths };
}

export function closeEditorGroupTab(
  state: EditorGroupsState,
  groupId: EditorGroupId,
  path: string,
): CloseEditorGroupTabResult {
  const group = getOwnGroup(state.groups, groupId);
  if (!group || !editorGroupHasPath(group, path)) {
    return { state, membershipRemoved: false, finalMembershipRemoved: false };
  }
  const nextGroup = closeEditorGroupPath(group, path);
  const nextState = { ...state, groups: { ...state.groups, [groupId]: nextGroup } };
  return {
    state: nextState,
    membershipRemoved: true,
    finalMembershipRemoved: editorGroupPathReferenceCount(nextState, path) === 0,
  };
}

export function transferEditorGroupTab(
  state: EditorGroupsState,
  fromGroupId: EditorGroupId,
  toGroupId: EditorGroupId,
  path: string,
  mode: "move" | "copy",
): EditorGroupsState {
  const source = getOwnGroup(state.groups, fromGroupId);
  const target = getOwnGroup(state.groups, toGroupId);
  if (!source || !target || fromGroupId === toGroupId || !editorGroupHasPath(source, path)) {
    return state;
  }

  const sourceWasPreview = source.previewPath === path;
  const nextTarget = openGroupTab(target, path, sourceWasPreview);
  const nextSource = mode === "move" ? closeEditorGroupPath(source, path) : source;
  return {
    ...state,
    activeGroupId: toGroupId,
    groups: {
      ...state.groups,
      [fromGroupId]: nextSource,
      [toGroupId]: nextTarget,
    },
  };
}

export function promoteDirtyEditorGroupPath(
  state: EditorGroupsState,
  path: string,
): EditorGroupsState {
  let changed = false;
  const groups = Object.fromEntries(
    Object.entries(state.groups).map(([id, group]) => {
      if (group.previewPath !== path) {
        return [id, group];
      }
      changed = true;
      return [id, pinGroupTab(group, path)];
    }),
  );
  return changed ? { ...state, groups } : state;
}

export function remapEditorGroupPath(
  state: EditorGroupsState,
  fromPath: string,
  toPath: string,
): EditorGroupsState {
  if (!fromPath || !toPath || fromPath === toPath) {
    return state;
  }
  let changed = false;
  const groups = Object.fromEntries(
    Object.entries(state.groups).map(([id, group]) => {
      if (!editorGroupHasPath(group, fromPath)) {
        return [id, group];
      }
      changed = true;
      const sourceWasPinned = group.openPaths.includes(fromPath);
      const destinationWasPinned = group.openPaths.includes(toPath);
      const openPaths = uniquePaths(group.openPaths.map((path) => path === fromPath ? toPath : path));
      const remappedPreviewPath = group.previewPath === fromPath
        ? toPath
        : group.previewPath;
      const previewPath = remappedPreviewPath === toPath &&
        (sourceWasPinned || destinationWasPinned)
        ? null
        : remappedPreviewPath;
      return [id, normalizeGroup({
        activePath: group.activePath === fromPath ? toPath : group.activePath,
        openPaths,
        previewPath,
      })];
    }),
  );
  return changed ? { ...state, groups } : state;
}

export function editorGroupVisiblePaths(group: EditorGroup): string[] {
  return group.previewPath && !group.openPaths.includes(group.previewPath)
    ? [...group.openPaths, group.previewPath]
    : [...group.openPaths];
}

export function editorGroupsUniquePaths(state: EditorGroupsState): string[] {
  return uniquePaths(Object.values(state.groups).flatMap(editorGroupVisiblePaths));
}

export function editorGroupPathReferenceCount(
  state: EditorGroupsState,
  path: string,
): number {
  return Object.values(state.groups).filter((group) => editorGroupHasPath(group, path)).length;
}

export function isLastEditorGroupMembership(
  state: EditorGroupsState,
  groupId: EditorGroupId,
  path: string,
): boolean {
  const group = getOwnGroup(state.groups, groupId);
  return Boolean(group && editorGroupHasPath(group, path)) &&
    editorGroupPathReferenceCount(state, path) === 1;
}

export function countEditorGroupMemberships(state: EditorGroupsState): number {
  return Object.values(state.groups).reduce(
    (total, group) => total + editorGroupVisiblePaths(group).length,
    0,
  );
}

export function countDirtyEditorDocuments(
  state: EditorGroupsState,
  dirtyPaths: ReadonlySet<string>,
): { uniqueDocuments: number; memberships: number } {
  const uniqueDocuments = editorGroupsUniquePaths(state).filter((path) => dirtyPaths.has(path)).length;
  const memberships = Object.values(state.groups).reduce(
    (total, group) => total + editorGroupVisiblePaths(group).filter((path) => dirtyPaths.has(path)).length,
    0,
  );
  return { uniqueDocuments, memberships };
}

function updateGroup(
  state: EditorGroupsState,
  requestedGroupId: EditorGroupId | undefined,
  update: (group: EditorGroup) => EditorGroup,
): EditorGroupsState {
  const groupId = requestedGroupId ?? state.activeGroupId;
  const group = getOwnGroup(state.groups, groupId);
  if (!group) {
    return state;
  }
  const nextGroup = update(group);
  return nextGroup === group ? state : { ...state, groups: { ...state.groups, [groupId]: nextGroup } };
}

function openGroupTab(group: EditorGroup, path: string, preview: boolean): EditorGroup {
  if (!path) {
    return group;
  }
  if (group.openPaths.includes(path)) {
    return group.activePath === path ? group : { ...group, activePath: path };
  }
  if (!preview) {
    return {
      activePath: path,
      openPaths: [...group.openPaths, path],
      previewPath: group.previewPath === path ? null : group.previewPath,
    };
  }
  if (group.previewPath === path && group.activePath === path) {
    return group;
  }
  return { ...group, activePath: path, previewPath: path };
}

function pinGroupTab(group: EditorGroup, path: string): EditorGroup {
  if (!editorGroupHasPath(group, path)) {
    return group;
  }
  const openPaths = group.openPaths.includes(path) ? group.openPaths : [...group.openPaths, path];
  const previewPath = group.previewPath === path ? null : group.previewPath;
  if (openPaths === group.openPaths && previewPath === group.previewPath) {
    return group;
  }
  return { ...group, openPaths, previewPath };
}

function editorGroupHasPath(group: EditorGroup, path: string): boolean {
  return group.previewPath === path || group.openPaths.includes(path);
}

function normalizeGroup(group: EditorGroup): EditorGroup {
  const previewPath = group.previewPath || null;
  const openPaths = uniquePaths(group.openPaths.filter((path) => path && path !== previewPath));
  const visiblePaths = previewPath ? [...openPaths, previewPath] : openPaths;
  return {
    activePath: group.activePath && visiblePaths.includes(group.activePath)
      ? group.activePath
      : visiblePaths[0] ?? null,
    openPaths,
    previewPath,
  };
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

function groupsEqual(left: EditorGroup, right: EditorGroup): boolean {
  return left.activePath === right.activePath &&
    left.previewPath === right.previewPath &&
    left.openPaths.length === right.openPaths.length &&
    left.openPaths.every((path, index) => path === right.openPaths[index]);
}

function isEditorGroup(value: unknown): value is EditorGroup {
  return isRecord(value) &&
    (typeof value.activePath === "string" || value.activePath === null) &&
    Array.isArray(value.openPaths) && value.openPaths.every((path) => typeof path === "string") &&
    (typeof value.previewPath === "string" || value.previewPath === null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnGroup(
  groups: Record<EditorGroupId, EditorGroup>,
  groupId: EditorGroupId,
): boolean {
  return Object.prototype.hasOwnProperty.call(groups, groupId);
}

function getOwnGroup(
  groups: Record<EditorGroupId, EditorGroup>,
  groupId: EditorGroupId,
): EditorGroup | undefined {
  return hasOwnGroup(groups, groupId) ? groups[groupId] : undefined;
}
