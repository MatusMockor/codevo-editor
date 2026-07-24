import type { DebugCopyValueCandidate } from "../application/debugCopyValue";
import type { ContextMenuItem } from "./ContextMenu";
import { canDebugCopyEvaluatePath, type DebugCopyValueSurface } from "./debugCopyValueSurface";

export function debugValueContextMenuItems({
  candidate,
  onCopyEvaluatePath,
  onCopyValue,
  onAddToWatch,
  onSetValue,
  surface,
}: {
  readonly candidate: DebugCopyValueCandidate | null;
  readonly surface?: DebugCopyValueSurface;
  onCopyEvaluatePath(): void;
  onCopyValue(): void;
  onAddToWatch?(): void;
  onSetValue?(): void;
}): readonly ContextMenuItem[] {
  const items: ContextMenuItem[] = candidate
    ? [{ id: "copy-value", label: "Copy Value", onSelect: onCopyValue }]
    : [];
  if (candidate?.adapterEvaluateName !== undefined && canDebugCopyEvaluatePath(surface)) {
    items.push({
      id: "copy-evaluate-path",
      label: "Copy as Expression",
      onSelect: onCopyEvaluatePath,
    });
  }
  if (onSetValue) items.push({ id: "debug.setVariable", label: "Set Value", onSelect: onSetValue });
  if (onAddToWatch) {
    items.push({
      id: "debug.addToWatchExpressions",
      label: "Add to Watch",
      onSelect: onAddToWatch,
    });
  }
  return items;
}
