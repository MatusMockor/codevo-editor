import type { KeymapCommandId } from "../domain/keymap";
import type { CommandContext, CommandRegistry } from "./commandRegistry";

const NATIVE_MENU_COMMAND_IDS = {
  "mockor-close-active-tab": "editor.closeTab",
  "mockor-editor-font-zoom-in": "editor.fontZoomIn",
  "mockor-editor-font-zoom-out": "editor.fontZoomOut",
  "mockor-editor-font-zoom-reset": "editor.fontZoomReset",
  "mockor-open-appearance-settings": "workbench.openAppearanceSettings",
  "mockor-toggle-font-ligatures": "editor.toggleFontLigatures",
} as const satisfies Record<string, KeymapCommandId>;

export type NativeMenuEventName = keyof typeof NATIVE_MENU_COMMAND_IDS;

export const NATIVE_MENU_EVENT_NAMES = Object.keys(
  NATIVE_MENU_COMMAND_IDS,
) as readonly NativeMenuEventName[];

interface DispatchNativeMenuCommandOptions {
  commandContext: CommandContext;
  commandRegistry: Pick<CommandRegistry, "get">;
  eventName: string;
}

export function dispatchNativeMenuCommand({
  commandContext,
  commandRegistry,
  eventName,
}: DispatchNativeMenuCommandOptions): boolean {
  const commandId = nativeMenuCommandId(eventName);

  if (!commandId) {
    return false;
  }

  const command = commandRegistry.get(commandId);

  if (!command?.isEnabled(commandContext)) {
    return false;
  }

  void command.run();
  return true;
}

function nativeMenuCommandId(eventName: string): KeymapCommandId | undefined {
  if (!Object.prototype.hasOwnProperty.call(NATIVE_MENU_COMMAND_IDS, eventName)) {
    return undefined;
  }

  return NATIVE_MENU_COMMAND_IDS[eventName as NativeMenuEventName];
}
