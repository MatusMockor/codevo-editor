interface WindowTitleInput {
  activeFilePath: string | null;
  isDirty: boolean;
  workspaceName: string | null;
}

function basename(path: string): string {
  const normalizedPath = path.replace(/[\\/]+$/, "");
  return normalizedPath.split(/[\\/]/).pop() ?? "";
}

export function formatWindowTitle({
  activeFilePath,
  isDirty,
  workspaceName,
}: WindowTitleInput): string {
  if (!workspaceName) {
    return "Mockor Editor";
  }

  const workspace = basename(workspaceName);

  if (!activeFilePath) {
    return workspace;
  }

  const file = basename(activeFilePath);

  if (isDirty) {
    return `• ${file} - ${workspace}`;
  }

  return `${file} - ${workspace}`;
}
