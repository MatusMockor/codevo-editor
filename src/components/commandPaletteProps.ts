import type { ComponentProps } from "react";
import type { useWorkbenchController } from "../application/useWorkbenchController";
import type { CommandPalette } from "./CommandPalette";

export function commandPaletteProps(
  workbench: ReturnType<typeof useWorkbenchController>,
): ComponentProps<typeof CommandPalette> {
  return {
    commands: workbench.commands,
    context: workbench.commandContext,
    initialQuery: workbench.commandPaletteInitialQuery,
    isOpen: workbench.paletteOpen,
    onClose: () => workbench.setPaletteOpen(false),
    onCommandError: workbench.reportCommandError,
  };
}
