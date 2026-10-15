import type { NodePackageScript } from "../domain/nodePackageScripts";
import type { Command, CommandContext } from "./commandRegistry";

interface WorkbenchNodePackageScriptCommandsOptions {
  readonly enabled: boolean;
  readonly pending: boolean;
  readonly scripts: readonly NodePackageScript[];
  run(script: NodePackageScript): void;
  stop(): void;
}

export function workbenchNodePackageScriptCommands({
  enabled,
  pending,
  scripts,
  run,
  stop,
}: WorkbenchNodePackageScriptCommandsOptions): Command[] {
  return [
    ...scripts.map((script) => ({
      id: `script.node.${script.key}`,
      title: `${script.packageManager}: ${script.scriptName} (${packageLabel(script)})`,
      category: "Scripts",
      isEnabled: (context: CommandContext) => context.hasWorkspace && enabled && !pending,
      run: () => run(script),
    })),
    {
      id: "script.node.stopCurrent",
      title: "Stop Current Package Script",
      category: "Scripts",
      isEnabled: (context: CommandContext) => context.hasWorkspace && enabled && pending,
      run: stop,
    },
  ];
}

function packageLabel(script: NodePackageScript): string {
  if (script.packageName) return `${script.packageName} · ${script.manifestRelativePath}`;
  return script.manifestRelativePath;
}
