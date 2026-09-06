import { detectKeymapPlatform, type KeymapPlatform } from "../domain/keymap";

export function appShellClassName(
  agentModeActive: boolean,
  settingsOpen: boolean,
  platform: KeymapPlatform = detectKeymapPlatform(),
): string {
  const agentClass = agentModeActive ? " app-shell--agent-mode" : "";
  const settingsClass = settingsOpen ? " app-shell--settings" : "";
  const platformClass = platform === "mac" ? " app-shell--mac" : "";

  return `app-shell${agentClass}${settingsClass}${platformClass}`;
}
