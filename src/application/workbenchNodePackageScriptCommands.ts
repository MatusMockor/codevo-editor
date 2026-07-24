import type { NodePackageScript } from "../domain/nodePackageScripts";
import {
  npmRunSelectedScriptCommandId,
  npmRunSelectedScriptTitle,
} from "../domain/npmRunSelectedScript";
import type { NpmRunSelectedScriptContextCapture } from "../domain/command";
import type { Command, CommandContext } from "./commandRegistry";

interface WorkbenchNodePackageScriptCommandsOptions {
  readonly enabled: boolean;
  readonly pending: boolean;
  readonly scripts: readonly NodePackageScript[];
  runSelectedScript?(capture: NpmRunSelectedScriptContextCapture): boolean;
  run(script: NodePackageScript): void;
  stop(): void;
}

export function workbenchNodePackageScriptCommands({
  enabled,
  pending,
  scripts,
  runSelectedScript,
  run,
  stop,
}: WorkbenchNodePackageScriptCommandsOptions): Command[] {
  return [
    {
      id: npmRunSelectedScriptCommandId,
      title: npmRunSelectedScriptTitle,
      category: "NPM",
      visibleInCommandPalette: false,
      isEnabled: (context: CommandContext) =>
        context.hasWorkspace &&
        context.hasActiveDocument &&
        enabled &&
        !pending &&
        Boolean(context.npmRunSelectedScriptCapture) &&
        Boolean(runSelectedScript),
      run: (context?: CommandContext) => {
        if (context?.npmRunSelectedScriptCapture) {
          runSelectedScript?.(context.npmRunSelectedScriptCapture);
        }
      },
    },
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
