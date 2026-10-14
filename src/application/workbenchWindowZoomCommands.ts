import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";
import type { WindowZoomActions } from "./useWorkbenchWindowZoom";

export function workbenchWindowZoomCommands(
  shortcut: (commandId: KeymapCommandId) => string,
  actions: WindowZoomActions,
): readonly Command[] {
  return [
    {
      id: "workbench.zoomIn",
      title: "Zoom In",
      category: "View",
      shortcut: shortcut("workbench.zoomIn"),
      isEnabled: () => true,
      run: actions.zoomIn,
    },
    {
      id: "workbench.zoomOut",
      title: "Zoom Out",
      category: "View",
      shortcut: shortcut("workbench.zoomOut"),
      isEnabled: () => true,
      run: actions.zoomOut,
    },
    {
      id: "workbench.zoomReset",
      title: "Reset Zoom",
      category: "View",
      shortcut: shortcut("workbench.zoomReset"),
      isEnabled: () => true,
      run: actions.zoomReset,
    },
  ];
}
