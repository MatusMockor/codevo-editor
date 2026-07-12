import type { Command } from "./commandRegistry";

interface WorkbenchEslintCommandsOptions {
  hasPackageJson: boolean;
  isRunning: boolean;
  runEslintAnalysis: Command["run"];
  hasFixesForActiveFile: boolean;
  isActiveBufferClean: boolean;
  isWorkspaceTrusted: boolean;
  fixAllInActiveFile: Command["run"];
}

export function workbenchEslintCommands({
  hasPackageJson,
  isRunning,
  runEslintAnalysis,
  hasFixesForActiveFile,
  isActiveBufferClean,
  isWorkspaceTrusted,
  fixAllInActiveFile,
}: WorkbenchEslintCommandsOptions): Command[] {
  return [
    {
      id: "eslint.analyseWorkspace",
      title: "ESLint: Analyse Workspace",
      category: "JavaScript",
      isEnabled: (context) =>
        context.hasWorkspace && hasPackageJson && !isRunning,
      run: runEslintAnalysis,
    },
    {
      id: "eslint.fixAllInActiveFile",
      title: "ESLint: Fix All in Active File",
      category: "JavaScript",
      isEnabled: (context) =>
        context.hasWorkspace &&
        context.hasActiveDocument &&
        hasFixesForActiveFile &&
        isActiveBufferClean &&
        isWorkspaceTrusted,
      run: fixAllInActiveFile,
    },
  ];
}
