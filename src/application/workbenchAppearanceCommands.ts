import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";

interface WorkbenchAppearanceCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  openSettingsPanel: Command["run"];
  openAppearanceSettingsPanel: Command["run"];
}

export function workbenchAppearanceCommands({
  shortcut,
  openSettingsPanel,
  openAppearanceSettingsPanel,
}: WorkbenchAppearanceCommandsOptions): Command[] {
  return [
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
  ];
}
