import type { Command } from "./commandRegistry";

interface WorkbenchPhpstanCommandsOptions {
  hasPhpWorkspace: boolean;
  isRunning: boolean;
  runPhpstanAnalysis: Command["run"];
}

export function workbenchPhpstanCommands({
  hasPhpWorkspace,
  isRunning,
  runPhpstanAnalysis,
}: WorkbenchPhpstanCommandsOptions): Command[] {
  return [
    {
      id: "phpstan.analyseWorkspace",
      title: "PHPStan: Analyse Workspace",
      category: "PHP",
      isEnabled: (context) =>
        context.hasWorkspace && hasPhpWorkspace && !isRunning,
      run: runPhpstanAnalysis,
    },
  ];
}
