export function appShellClassName(agentModeActive: boolean, settingsOpen: boolean): string {
  const agentClass = agentModeActive ? " app-shell--agent-mode" : "";
  const settingsClass = settingsOpen ? " app-shell--settings" : "";

  return `app-shell${agentClass}${settingsClass}`;
}
