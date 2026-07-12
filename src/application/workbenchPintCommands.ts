import type { Command } from "./commandRegistry";

interface WorkbenchPintCommandsOptions {
  hasPhpWorkspace: boolean;
  isRunning: boolean;
  isWorkspaceTrusted: boolean;
  hasActivePhpDocument: boolean;
  formatChangedFiles: Command["run"];
  formatActiveFile: Command["run"];
}

export function workbenchPintCommands({
  hasPhpWorkspace,
  isRunning,
  isWorkspaceTrusted,
  hasActivePhpDocument,
  formatChangedFiles,
  formatActiveFile,
}: WorkbenchPintCommandsOptions): Command[] {
  const baseEnabled = (context: Parameters<Command["isEnabled"]>[0]) =>
    context.hasWorkspace &&
    hasPhpWorkspace &&
    isWorkspaceTrusted &&
    !isRunning;

  return [
    {
      id: "pint.formatChangedFiles",
      title: "Pint: Format Changed Files",
      category: "PHP",
      isEnabled: baseEnabled,
      run: formatChangedFiles,
    },
    {
      id: "pint.formatActiveFile",
      title: "Pint: Format Active File",
      category: "PHP",
      isEnabled: (context) =>
        baseEnabled(context) &&
        context.hasActiveDocument &&
        hasActivePhpDocument,
      run: formatActiveFile,
    },
  ];
}
