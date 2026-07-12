export type EditorGroupId = string;

export type EditorSplitDirection = "right" | "down";
export type EditorSplitOrientation = "horizontal" | "vertical";

export interface EditorGroupLayout {
  kind: "group";
  groupId: EditorGroupId;
}

export interface EditorSplitLayout {
  kind: "split";
  orientation: EditorSplitOrientation;
  sizes: [number, number];
  children: [EditorLayout, EditorLayout];
}

export type EditorLayout = EditorGroupLayout | EditorSplitLayout;

export const MIN_EDITOR_PANE_SIZE = 0.1;

export function editorGroupLayout(groupId: EditorGroupId): EditorGroupLayout {
  return { kind: "group", groupId };
}

export function clampEditorSplitSizes(
  sizes: readonly number[],
  minimum = MIN_EDITOR_PANE_SIZE,
): [number, number] {
  const safeMinimum = Number.isFinite(minimum)
    ? Math.min(0.5, Math.max(0, minimum))
    : MIN_EDITOR_PANE_SIZE;
  const first = Number.isFinite(sizes[0]) ? Math.max(0, sizes[0]) : 0.5;
  const second = Number.isFinite(sizes[1]) ? Math.max(0, sizes[1]) : 0.5;
  const scale = Math.max(first, second);
  const scaledFirst = scale > 0 ? first / scale : 0.5;
  const scaledSecond = scale > 0 ? second / scale : 0.5;
  const normalizedFirst = scaledFirst / (scaledFirst + scaledSecond);
  const clampedFirst = Math.min(
    1 - safeMinimum,
    Math.max(safeMinimum, normalizedFirst),
  );

  return [clampedFirst, 1 - clampedFirst];
}

export function splitEditorLayout(
  layout: EditorLayout,
  targetGroupId: EditorGroupId,
  newGroupId: EditorGroupId,
  direction: EditorSplitDirection,
  sizes: readonly number[] = [0.5, 0.5],
): EditorLayout | null {
  if (
    !targetGroupId ||
    !newGroupId ||
    editorGroupIdsInLayout(layout).includes(newGroupId)
  ) {
    return null;
  }

  return splitEditorLayoutAtTarget(
    layout,
    targetGroupId,
    newGroupId,
    direction,
    sizes,
  );
}

function splitEditorLayoutAtTarget(
  layout: EditorLayout,
  targetGroupId: EditorGroupId,
  newGroupId: EditorGroupId,
  direction: EditorSplitDirection,
  sizes: readonly number[],
): EditorLayout | null {

  if (layout.kind === "group") {
    if (layout.groupId !== targetGroupId) {
      return null;
    }

    return {
      kind: "split",
      orientation: direction === "right" ? "horizontal" : "vertical",
      sizes: clampEditorSplitSizes(sizes),
      children: [layout, editorGroupLayout(newGroupId)],
    };
  }

  const left = splitEditorLayoutAtTarget(
    layout.children[0],
    targetGroupId,
    newGroupId,
    direction,
    sizes,
  );
  if (left) {
    return { ...layout, children: [left, layout.children[1]] };
  }

  const right = splitEditorLayoutAtTarget(
    layout.children[1],
    targetGroupId,
    newGroupId,
    direction,
    sizes,
  );
  if (!right) {
    return null;
  }

  return { ...layout, children: [layout.children[0], right] };
}

export function removeEditorGroupFromLayout(
  layout: EditorLayout,
  groupId: EditorGroupId,
): EditorLayout | null {
  if (layout.kind === "group") {
    return layout.groupId === groupId ? null : layout;
  }

  const first = removeEditorGroupFromLayout(layout.children[0], groupId);
  const second = removeEditorGroupFromLayout(layout.children[1], groupId);
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }

  return { ...layout, children: [first, second] };
}

export function updateEditorSplitSizes(
  layout: EditorLayout,
  splitPath: readonly number[],
  sizes: readonly number[],
): EditorLayout {
  if (layout.kind !== "split") {
    return layout;
  }
  if (splitPath.length === 0) {
    return { ...layout, sizes: clampEditorSplitSizes(sizes) };
  }

  const [childIndex, ...remainingPath] = splitPath;
  if (childIndex !== 0 && childIndex !== 1) {
    return layout;
  }
  const child = updateEditorSplitSizes(
    layout.children[childIndex],
    remainingPath,
    sizes,
  );
  if (child === layout.children[childIndex]) {
    return layout;
  }

  const children: [EditorLayout, EditorLayout] = [...layout.children];
  children[childIndex] = child;
  return { ...layout, children };
}

export function editorGroupIdsInLayout(layout: EditorLayout): EditorGroupId[] {
  if (layout.kind === "group") {
    return [layout.groupId];
  }

  return [
    ...editorGroupIdsInLayout(layout.children[0]),
    ...editorGroupIdsInLayout(layout.children[1]),
  ];
}

export function normalizeEditorLayout(
  value: unknown,
  validGroupIds: ReadonlySet<EditorGroupId>,
  fallbackGroupId: EditorGroupId,
): EditorLayout {
  const seen = new Set<EditorGroupId>();
  const normalized = normalizeEditorLayoutNode(value, validGroupIds, seen);
  return normalized ?? editorGroupLayout(fallbackGroupId);
}

function normalizeEditorLayoutNode(
  value: unknown,
  validGroupIds: ReadonlySet<EditorGroupId>,
  seen: Set<EditorGroupId>,
): EditorLayout | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.kind === "group") {
    if (
      typeof value.groupId !== "string" ||
      !validGroupIds.has(value.groupId) ||
      seen.has(value.groupId)
    ) {
      return null;
    }
    seen.add(value.groupId);
    return editorGroupLayout(value.groupId);
  }
  if (value.kind !== "split" || !Array.isArray(value.children)) {
    return null;
  }

  const first = normalizeEditorLayoutNode(value.children[0], validGroupIds, seen);
  const second = normalizeEditorLayoutNode(value.children[1], validGroupIds, seen);
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }

  return {
    kind: "split",
    orientation: value.orientation === "vertical" ? "vertical" : "horizontal",
    sizes: clampEditorSplitSizes(Array.isArray(value.sizes) ? value.sizes : []),
    children: [first, second],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
