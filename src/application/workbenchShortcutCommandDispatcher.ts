import {
  keymapCommands,
  matchesShortcut,
  shortcutForCommand,
  type KeymapCommandId,
  type KeymapSettings,
} from "../domain/keymap";
import {
  executeCommand,
  type CommandLookup,
  type CommandContext,
} from "./commandRegistry";

interface DispatchWorkbenchShortcutCommandOptions {
  commandContext: CommandContext;
  commandIds?: readonly KeymapCommandId[];
  commandRegistry: CommandLookup;
  event: KeyboardEvent;
  keymap: KeymapSettings;
}

const KEYMAP_COMMAND_IDS = keymapCommands.map((command) => command.id);

export function dispatchWorkbenchShortcutCommand({
  commandContext,
  commandIds = KEYMAP_COMMAND_IDS,
  commandRegistry,
  event,
  keymap,
}: DispatchWorkbenchShortcutCommandOptions): boolean {
  for (const commandId of commandIds) {
    if (!commandRegistry.get(commandId)) {
      continue;
    }

    if (!matchesShortcut(event, shortcutForCommand(keymap, commandId))) {
      continue;
    }

    event.preventDefault();

    const outcome = executeCommand(commandRegistry, commandId, commandContext);
    if (outcome === "missing") {
      continue;
    }

    return true;
  }

  return false;
}
