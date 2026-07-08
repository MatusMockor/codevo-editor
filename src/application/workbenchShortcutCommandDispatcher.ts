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

export function dispatchWorkbenchShortcutCommand({
  commandContext,
  commandIds,
  commandRegistry,
  event,
  keymap,
}: DispatchWorkbenchShortcutCommandOptions): boolean {
  for (const commandId of commandIds) {
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
