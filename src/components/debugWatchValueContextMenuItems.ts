import type { DebugCopyValueCandidate } from "../application/debugCopyValue";
import type { ContextMenuItem } from "./ContextMenu";
import { debugValueContextMenuItems } from "./debugValueContextMenuItems";
import type { DebugCopyValueSurface } from "./debugCopyValueSurface";

/** VS Code Watch `3_modification` relative order: Set Value, Copy Value, Copy as Expression. */
export function debugWatchValueContextMenuItems({
  candidate,
  onCopyEvaluatePath,
  onCopyValue,
  onSetValue,
  surface,
}: {
  readonly candidate: DebugCopyValueCandidate | null;
  readonly surface?: DebugCopyValueSurface;
  onCopyEvaluatePath(): void;
  onCopyValue(): void;
  onSetValue?(): void;
}): readonly ContextMenuItem[] {
  const items: ContextMenuItem[] = onSetValue
    ? [{ id: "debug.setWatchExpression", label: "Set Value", onSelect: onSetValue }]
    : [];
  items.push(
    ...debugValueContextMenuItems({
      candidate,
      onCopyEvaluatePath,
      onCopyValue,
      surface,
    }),
  );
  return items;
}
