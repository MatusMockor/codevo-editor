import { parseShortcutSequence, type KeymapPlatform } from "./keymap";

type WindowZoomCommandId = "workbench.zoomIn" | "workbench.zoomOut" | "workbench.zoomReset";

const ZOOM_KEYS: Readonly<Record<WindowZoomCommandId, ReadonlySet<string>>> = {
  "workbench.zoomIn": new Set(["=", "plus", "equal", "numpadadd", "add"]),
  "workbench.zoomOut": new Set(["-", "minus", "numpadsubtract", "subtract"]),
  "workbench.zoomReset": new Set(["0", "digit0", "numpad0"]),
};

export function windowZoomDefaultConflictsWithShortcut(
  commandId: WindowZoomCommandId,
  shortcut: string,
  platform: KeymapPlatform,
): boolean {
  const stroke = parseShortcutSequence(shortcut)?.[0];
  if (!stroke || stroke.alt) return false;
  if (platform === "mac" && (!stroke.meta || stroke.ctrl)) return false;
  if (platform !== "mac" && !stroke.meta && !stroke.ctrl) return false;
  if (commandId !== "workbench.zoomIn" && stroke.shift) return false;
  return ZOOM_KEYS[commandId].has(stroke.key);
}
