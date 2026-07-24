import { isPackageScriptName, type PackageScript } from "../domain/packageScripts";
import type { Command } from "./commandRegistry";

interface WorkbenchScriptCommandsOptions {
  composerScripts: readonly PackageScript[];
  runInActiveTerminal(command: string): void;
}

interface ScriptRunner {
  idNamespace: string;
  label: string;
  terminalCommandFor(name: string): string;
}

export function workbenchScriptCommands({
  composerScripts,
  runInActiveTerminal,
}: WorkbenchScriptCommandsOptions): Command[] {
  const composerRunner: ScriptRunner = {
    idNamespace: "composer",
    label: "composer",
    terminalCommandFor: (name) => `composer run-script ${name}`,
  };
  return commandsForScripts(composerRunner, composerScripts, runInActiveTerminal);
}

function commandsForScripts(
  runner: ScriptRunner,
  scripts: readonly PackageScript[],
  runInActiveTerminal: (command: string) => void,
): Command[] {
  return scripts.flatMap(({ name }) => {
    if (!isPackageScriptName(name)) {
      return [];
    }

    const terminalCommand = runner.terminalCommandFor(name);

    return [
      {
        id: `script.${runner.idNamespace}.${name}`,
        title: `${runner.label}: ${name}`,
        category: "Scripts",
        isEnabled: (context) => context.hasWorkspace,
        run: () => runInActiveTerminal(terminalCommand),
      },
    ];
  });
}
