import type { KeymapCommandId } from "../domain/keymap";
import type { PaletteLaunchRequest } from "./commandPalette/commandPaletteLaunch";
import type { Command } from "./commandRegistry";

interface WorkbenchPaletteCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  openPalette(request: PaletteLaunchRequest): void;
}

export function workbenchPaletteCommands({
  openPalette,
  shortcut,
}: WorkbenchPaletteCommandsOptions): Command[] {
  return [
    {
      id: "palette.open",
      title: "Open Command Palette",
      category: "Workbench",
      shortcut: shortcut("palette.open"),
      visibleInCommandPalette: false,
      isEnabled: () => true,
      run: () => openPalette({ page: "root", query: "" }),
    },
    {
      id: "palette.shortcuts",
      title: "Keyboard Shortcuts",
      category: "Workbench",
      shortcut: shortcut("palette.shortcuts"),
      visibleInCommandPalette: false,
      isEnabled: () => true,
      run: () => openPalette({ page: "shortcuts", query: "" }),
    },
  ];
}
