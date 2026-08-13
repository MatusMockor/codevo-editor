interface WindowTitleInput {
  activeFilePath: string | null;
  agentModeActive?: boolean;
  isDirty: boolean;
  workspaceName: string | null;
}

export function displayBaseName(path: string): string {
  const normalizedPath = path.replace(/[\\/]+$/, "");
  return normalizedPath.split(/[\\/]/).pop() ?? "";
}

export function formatAgentModeWindowTitle(workspaceName: string | null): string {
  if (!workspaceName) {
    return "Agents";
  }

  return `Agents - ${displayBaseName(workspaceName)}`;
}

export function formatWindowTitle({
  activeFilePath,
  agentModeActive = false,
  isDirty,
  workspaceName,
}: WindowTitleInput): string {
  if (agentModeActive) {
    return formatAgentModeWindowTitle(workspaceName);
  }

  if (!workspaceName) {
    return "Codevo Editor";
  }

  const workspace = displayBaseName(workspaceName);

  if (!activeFilePath) {
    return workspace;
  }

  const file = displayBaseName(activeFilePath);

  if (isDirty) {
    return `• ${file} - ${workspace}`;
  }

  return `${file} - ${workspace}`;
}
