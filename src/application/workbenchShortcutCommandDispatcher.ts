import {
  keymapCommands,
  matchesShortcut,
  shortcutForCommand,
  type KeymapCommandId,
  type KeymapSettings,
} from "../domain/keymap";
import type {
  CommandContext,
  CommandExecutionRunner,
  CommandLookup,
} from "./commandRegistry";

interface DispatchWorkbenchShortcutCommandOptions {
  commandContext: CommandContext;
  commandIds?: readonly KeymapCommandId[];
  commandRegistry: CommandLookup;
  event: KeyboardEvent;
  keymap: KeymapSettings;
  runCommand: CommandExecutionRunner;
}

const KEYMAP_COMMAND_IDS = keymapCommands.map((command) => command.id);

export function dispatchWorkbenchShortcutCommand({
  commandContext,
  commandIds = KEYMAP_COMMAND_IDS,
  commandRegistry,
  event,
  keymap,
  runCommand,
}: DispatchWorkbenchShortcutCommandOptions): boolean {
  for (const commandId of commandIds) {
    if (!commandRegistry.get(commandId)) {
      continue;
    }

    if (!matchesShortcut(event, shortcutForCommand(keymap, commandId))) {
      continue;
    }

    event.preventDefault();

    runCommand(commandId, commandContext);
    return true;
  }

  return false;
}
