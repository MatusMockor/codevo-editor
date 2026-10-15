export function formatAgentModeWindowTitle(workspaceName: string | null): string {
  if (!workspaceName) {
    return "Agents";
  }

  return `Agents - ${displayBaseName(workspaceName)}`;
}

function displayBaseName(path: string): string {
  const normalizedPath = path.replace(/[\\/]+$/, "");
  return normalizedPath.split(/[\\/]/).pop() ?? "";
}
