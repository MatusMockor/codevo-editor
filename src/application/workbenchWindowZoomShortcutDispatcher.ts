import {
  defaultShortcutForCommand,
  keymapCommands,
  lookupKeymapShortcutSequence,
  normalizeShortcutSequenceInput,
  shortcutForCommand,
  type KeymapCommandId,
  type KeymapPlatform,
  type KeymapSettings,
} from "../domain/keymap";
import {
  matchesShortcutStroke,
  parseShortcutSequence,
  shortcutStrokeFromKeyboardEvent,
} from "../domain/shortcutSequence";
import type { CommandContext, CommandExecutionRunner, CommandLookup } from "./commandRegistry";
import { dispatchResolvedWorkbenchShortcutCommands } from "./workbenchShortcutCommandDispatcher";

export const WINDOW_ZOOM_COMMAND_IDS: ReadonlySet<KeymapCommandId> = new Set([
  "workbench.zoomIn",
  "workbench.zoomOut",
  "workbench.zoomReset",
]);
const KEYMAP_COMMAND_IDS = keymapCommands.map((command) => command.id);

export function windowZoomShortcutNeedsCapture(
  keymap: KeymapSettings,
  event: KeyboardEvent,
  platform: KeymapPlatform,
): boolean {
  if (event.isComposing) return false;
  const startsZoomShortcut = [...WINDOW_ZOOM_COMMAND_IDS].some((commandId) => {
    const sequence = parseShortcutSequence(shortcutForCommand(keymap, commandId, platform));
    return sequence !== null && matchesShortcutStroke(event, sequence[0], platform);
  });
  if (!startsZoomShortcut) return false;
  const stroke = shortcutStrokeFromKeyboardEvent(event);
  if (!stroke) return false;
  const lookup = lookupKeymapShortcutSequence(keymap, [stroke], KEYMAP_COMMAND_IDS, platform);
  if (lookup.prefix.some((id) => WINDOW_ZOOM_COMMAND_IDS.has(id))) return true;
  return lookup.prefix.length === 0 && WINDOW_ZOOM_COMMAND_IDS.has(lookup.exact[0]);
}

export function dispatchWorkbenchWindowZoomPhysicalShortcut({
  commandContext,
  commandRegistry,
  event,
  keymap,
  platform,
  runCommand,
}: {
  readonly commandContext: CommandContext;
  readonly commandRegistry: CommandLookup;
  readonly event: KeyboardEvent;
  readonly keymap: KeymapSettings;
  readonly platform: KeymapPlatform;
  readonly runCommand: CommandExecutionRunner;
}): boolean {
  const commandId = defaultWindowZoomCommandForEvent(event, platform);
  if (!commandId) return false;
  const shortcut = defaultShortcutForCommand(commandId, platform);
  if (
    normalizeShortcutSequenceInput(shortcutForCommand(keymap, commandId, platform)) !== shortcut
  ) {
    return false;
  }
  const stroke = shortcutStrokeFromKeyboardEvent(event);
  if (stroke) {
    const logical = lookupKeymapShortcutSequence(keymap, [stroke], KEYMAP_COMMAND_IDS, platform);
    if (
      logical.prefix.length > 0 ||
      logical.exact.some(
        (id) => id !== commandId && !commandUsesDefaultWindowZoomShortcut(keymap, id, platform),
      )
    )
      return false;
  }
  const physicalShortcut = `${platform === "mac" ? "Cmd" : "Ctrl"}${event.shiftKey ? "+Shift" : ""}+${commandId === "workbench.zoomIn" ? "=" : commandId === "workbench.zoomOut" ? "-" : "0"}`;
  for (const candidate of [physicalShortcut, shortcut]) {
    const owners = lookupKeymapShortcutSequence(keymap, candidate, KEYMAP_COMMAND_IDS, platform);
    if (owners.prefix.length > 0 || owners.exact.some((id) => id !== commandId)) return false;
  }
  const handled = dispatchResolvedWorkbenchShortcutCommands({
    commandContext,
    commandIds: [commandId],
    commandRegistry,
    event,
    runCommand,
  });
  if (!handled) return false;
  event.stopImmediatePropagation();
  return true;
}

function defaultWindowZoomCommandForEvent(
  event: KeyboardEvent,
  platform: KeymapPlatform,
): KeymapCommandId | null {
  if (event.isComposing || event.altKey || event.getModifierState?.("AltGraph")) return null;
  if (event.metaKey !== (platform === "mac") || event.ctrlKey !== (platform !== "mac")) {
    return null;
  }
  if (event.code === "Equal" || event.code === "NumpadAdd") {
    return "workbench.zoomIn";
  }
  if (event.code === "Minus" || event.code === "NumpadSubtract") {
    return event.shiftKey ? null : "workbench.zoomOut";
  }
  if (event.code === "Digit0" || event.code === "Numpad0") {
    return event.shiftKey ? null : "workbench.zoomReset";
  }
  if (event.key === "+" || event.key === "=") {
    return "workbench.zoomIn";
  }
  if (event.shiftKey) return null;
  if (event.key === "-") {
    return "workbench.zoomOut";
  }
  if (event.key === "0") {
    return "workbench.zoomReset";
  }
  return null;
}

function commandUsesDefaultWindowZoomShortcut(
  keymap: KeymapSettings,
  commandId: KeymapCommandId,
  platform: KeymapPlatform,
): boolean {
  return (
    WINDOW_ZOOM_COMMAND_IDS.has(commandId) &&
    normalizeShortcutSequenceInput(shortcutForCommand(keymap, commandId, platform)) ===
      defaultShortcutForCommand(commandId, platform)
  );
}
