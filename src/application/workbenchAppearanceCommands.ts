import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";

interface WorkbenchAppearanceCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  zoomEditorFontIn: Command["run"];
  zoomEditorFontOut: Command["run"];
  resetEditorFontSize: Command["run"];
  toggleEditorFontLigatures: Command["run"];
  openSettingsPanel: Command["run"];
  openAppearanceSettingsPanel: Command["run"];
}

interface WorkbenchAppearanceCommands {
  editorCommands: Command[];
  workbenchCommands: Command[];
}

export function workbenchAppearanceCommands({
  shortcut,
  zoomEditorFontIn,
  zoomEditorFontOut,
  resetEditorFontSize,
  toggleEditorFontLigatures,
  openSettingsPanel,
  openAppearanceSettingsPanel,
}: WorkbenchAppearanceCommandsOptions): WorkbenchAppearanceCommands {
  return {
    editorCommands: [
      {
        id: "editor.fontZoomIn",
        title: "Increase Editor Font Size",
        category: "Editor",
        shortcut: shortcut("editor.fontZoomIn"),
        isEnabled: () => true,
        run: zoomEditorFontIn,
      },
      {
        id: "editor.fontZoomOut",
        title: "Decrease Editor Font Size",
        category: "Editor",
        shortcut: shortcut("editor.fontZoomOut"),
        isEnabled: () => true,
        run: zoomEditorFontOut,
      },
      {
        id: "editor.fontZoomReset",
        title: "Reset Editor Font Size",
        category: "Editor",
        shortcut: shortcut("editor.fontZoomReset"),
        isEnabled: () => true,
        run: resetEditorFontSize,
      },
      {
        id: "editor.toggleFontLigatures",
        title: "Toggle Editor Font Ligatures",
        category: "Editor",
        shortcut: shortcut("editor.toggleFontLigatures"),
        isEnabled: () => true,
        run: toggleEditorFontLigatures,
      },
    ],
    workbenchCommands: [
      {
        id: "workbench.openSettings",
        title: "Open Settings",
        category: "Workbench",
        shortcut: shortcut("workbench.openSettings"),
        isEnabled: () => true,
        run: openSettingsPanel,
      },
      {
        id: "workbench.openAppearanceSettings",
        title: "Open Appearance Settings",
        category: "Workbench",
        shortcut: shortcut("workbench.openAppearanceSettings"),
        isEnabled: () => true,
        run: openAppearanceSettingsPanel,
      },
    ],
  };
}
