import {
  matchesShortcut,
  shortcutForCommand,
  type KeymapCommandId,
  type KeymapSettings,
} from "../domain/keymap";
import type { CommandContext, CommandRegistry } from "./commandRegistry";

interface DispatchWorkbenchShortcutCommandOptions {
  commandContext: CommandContext;
  commandIds: readonly KeymapCommandId[];
  commandRegistry: Pick<CommandRegistry, "get">;
  event: KeyboardEvent;
  keymap: KeymapSettings;
}

const WORKSPACE_TAB_SHORTCUT_COMMAND_IDS = [
  "workspace.nextTab",
  "workspace.previousTab",
] as const satisfies readonly KeymapCommandId[];

export function dispatchWorkbenchShortcutCommand({
  commandContext,
  commandIds,
  commandRegistry,
  event,
  keymap,
}: DispatchWorkbenchShortcutCommandOptions): boolean {
  for (const commandId of [
    ...commandIds,
    ...WORKSPACE_TAB_SHORTCUT_COMMAND_IDS,
  ]) {
    if (!matchesShortcut(event, shortcutForCommand(keymap, commandId))) {
      continue;
    }

    event.preventDefault();

    const command = commandRegistry.get(commandId);

    if (command?.isEnabled(commandContext)) {
      void command.run();
    }

    return true;
  }

  return false;
}
