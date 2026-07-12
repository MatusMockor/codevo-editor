import type { Command } from "./commandRegistry";

interface WorkbenchPhpstanCommandsOptions {
  hasPhpWorkspace: boolean;
  isRunning: boolean;
  runPhpstanAnalysis: Command["run"];
  hasDiagnosticAtCursor: boolean;
  isActiveBufferClean: boolean;
  isWorkspaceTrusted: boolean;
  ignoreIssueAtCursor: Command["run"];
}

export function workbenchPhpstanCommands({
  hasPhpWorkspace,
  isRunning,
  runPhpstanAnalysis,
  hasDiagnosticAtCursor,
  isActiveBufferClean,
  isWorkspaceTrusted,
  ignoreIssueAtCursor,
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
    {
      id: "phpstan.ignoreIssueAtCursor",
      title: "PHPStan: Ignore Issue at Cursor",
      category: "PHP",
      isEnabled: (context) =>
        context.hasWorkspace &&
        context.hasActiveDocument &&
        hasDiagnosticAtCursor &&
        isActiveBufferClean &&
        isWorkspaceTrusted,
      run: ignoreIssueAtCursor,
    },
  ];
}
