import { detectKeymapPlatform, type KeymapPlatform } from "../domain/keymap";

export function appShellClassName(
  settingsOpen: boolean,
  platform: KeymapPlatform = detectKeymapPlatform(),
): string {
  const settingsClass = settingsOpen ? " app-shell--settings" : "";
  const platformClass = platform === "mac" ? " app-shell--mac" : "";

  return `app-shell app-shell--agent-mode${settingsClass}${platformClass}`;
}
