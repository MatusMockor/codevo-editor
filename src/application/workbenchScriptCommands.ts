import {
  isPackageScriptName,
  type PackageScript,
} from "../domain/packageScripts";
import type { Command } from "./commandRegistry";

interface WorkbenchScriptCommandsOptions {
  composerScripts: readonly PackageScript[];
  npmScripts: readonly PackageScript[];
  runInActiveTerminal(command: string): void;
}

export function workbenchScriptCommands({
  composerScripts,
  npmScripts,
  runInActiveTerminal,
}: WorkbenchScriptCommandsOptions): Command[] {
  return [
    ...commandsForScripts("composer", composerScripts, runInActiveTerminal),
    ...commandsForScripts("npm", npmScripts, runInActiveTerminal),
  ];
}

function commandsForScripts(
  runner: "composer" | "npm",
  scripts: readonly PackageScript[],
  runInActiveTerminal: (command: string) => void,
): Command[] {
  return scripts.flatMap(({ name }) => {
    if (!isPackageScriptName(name)) {
      return [];
    }

    const terminalCommand =
      runner === "composer"
        ? `composer run-script ${name}`
        : `npm run ${name}`;

    return [
      {
        id: `script.${runner}.${name}`,
        title: `${runner}: ${name}`,
        category: "Scripts",
        isEnabled: (context) => context.hasWorkspace,
        run: () => runInActiveTerminal(terminalCommand),
      },
    ];
  });
}
