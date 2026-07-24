import {
  keymapCommands,
  matchesShortcut,
  shortcutForCommand,
  type KeymapCommandId,
  type KeymapSettings,
} from "../domain/keymap";
import type { CommandContext, CommandExecutionRunner, CommandLookup } from "./commandRegistry";

interface DispatchWorkbenchShortcutCommandOptions {
  commandContext: CommandContext;
  commandIds?: readonly KeymapCommandId[];
  commandRegistry: CommandLookup;
  event: KeyboardEvent;
  keymap: KeymapSettings;
  runCommand: CommandExecutionRunner;
}

interface DispatchResolvedWorkbenchShortcutCommandsOptions {
  commandContext: CommandContext;
  commandIds: readonly KeymapCommandId[];
  commandRegistry: CommandLookup;
  event: KeyboardEvent;
  runCommand: CommandExecutionRunner;
}

const KEYMAP_COMMAND_IDS = keymapCommands.map((command) => command.id);
const FOCUS_SCOPED_COMMAND_IDS: ReadonlySet<KeymapCommandId> = new Set(["debug.setVariable"]);

export function dispatchWorkbenchShortcutCommand({
  commandContext,
  commandIds = KEYMAP_COMMAND_IDS,
  commandRegistry,
  event,
  keymap,
  runCommand,
}: DispatchWorkbenchShortcutCommandOptions): boolean {
  const matchingCommandIds: KeymapCommandId[] = [];
  const collectedCommandIds = new Set<KeymapCommandId>();

  // Commands registered later in the catalog are more specific and therefore
  // get the first opportunity to handle an intentional shortcut collision.
  // De-duplicate defensively so a custom catalog cannot evaluate one command
  // more than once for a single keydown.
  for (let index = commandIds.length - 1; index >= 0; index -= 1) {
    const commandId = commandIds[index];
    if (!commandId || collectedCommandIds.has(commandId)) {
      continue;
    }

    collectedCommandIds.add(commandId);

    const command = commandRegistry.get(commandId);
    if (!command) {
      continue;
    }

    if (FOCUS_SCOPED_COMMAND_IDS.has(commandId)) {
      let enabled = false;
      try {
        enabled = command.isEnabled(commandContext);
      } catch {
        enabled = false;
      }
      if (!enabled) continue;
    }

    if (!matchesShortcut(event, shortcutForCommand(keymap, commandId))) {
      continue;
    }

    matchingCommandIds.push(commandId);
  }

  if (matchingCommandIds.length === 0) {
    return false;
  }

  return dispatchResolvedWorkbenchShortcutCommands({
    commandContext,
    commandIds: matchingCommandIds,
    commandRegistry,
    event,
    runCommand,
  });
}

/**
 * Dispatches command ids that were already resolved by a multi-stroke keymap
 * lookup. The ids are expected in conflict-priority order, matching the order
 * produced by the shortcut sequence index.
 */
export function dispatchResolvedWorkbenchShortcutCommands({
  commandContext,
  commandIds,
  commandRegistry,
  event,
  runCommand,
}: DispatchResolvedWorkbenchShortcutCommandsOptions): boolean {
  const runnableCommandIds: KeymapCommandId[] = [];
  const collectedCommandIds = new Set<KeymapCommandId>();

  for (const commandId of commandIds) {
    if (collectedCommandIds.has(commandId)) continue;
    collectedCommandIds.add(commandId);

    const command = commandRegistry.get(commandId);
    if (!command) continue;

    if (FOCUS_SCOPED_COMMAND_IDS.has(commandId)) {
      let enabled = false;
      try {
        enabled = command.isEnabled(commandContext);
      } catch {
        enabled = false;
      }
      if (!enabled) continue;
    }

    runnableCommandIds.push(commandId);
  }

  if (runnableCommandIds.length === 0) return false;

  // A known binding owns the keydown even when every candidate is disabled.
  // This prevents the browser or editor underneath from observing a shortcut
  // that the workbench explicitly reserves.
  event.preventDefault();

  for (const commandId of runnableCommandIds) {
    if (runCommand(commandId, commandContext) === "executed") {
      break;
    }
  }

  return true;
}
