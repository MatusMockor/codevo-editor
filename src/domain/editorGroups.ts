import { reorderVisibleTabs, type TabDropPosition } from "./tabOrdering";
import { nextActiveEditorPathAfterClose } from "./workspace";

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
