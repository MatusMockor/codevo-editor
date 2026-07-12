import type { Command } from "./commandRegistry";

interface WorkbenchEslintCommandsOptions {
  hasPackageJson: boolean;
  isRunning: boolean;
  runEslintAnalysis: Command["run"];
}

export function workbenchEslintCommands({
  hasPackageJson,
  isRunning,
  runEslintAnalysis,
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
  ];
}
