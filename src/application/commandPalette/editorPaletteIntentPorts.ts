import {
  executeCommandAndWait,
  type CommandContext,
  type CommandExecutionOutcome,
  type CommandLookup,
} from "../commandRegistry";
import type { PaletteBranchSource } from "./commandPaletteProvider";
import type { PaletteIntentPorts } from "./executePaletteIntent";

export interface EditorPaletteIntentDependencies {
  readonly commands: CommandLookup;
  readonly context: CommandContext;
  readonly workspaceTabs: readonly string[];
  readonly branchSource: PaletteBranchSource | null;
  activateWorkspaceTab(path: string): Promise<void>;
}

export type EditorPaletteIntentPorts = Pick<
  PaletteIntentPorts,
  "switchEditorProject" | "runEditorScript" | "switchBranch"
>;

export function editorPaletteIntentPorts(
  dependencies: EditorPaletteIntentDependencies,
): EditorPaletteIntentPorts {
  return {
    async switchEditorProject(path) {
      if (!dependencies.workspaceTabs.includes(path)) return false;
      await dependencies.activateWorkspaceTab(path);
      return true;
    },
    async runEditorScript(scriptKey): Promise<CommandExecutionOutcome> {
      const command = dependencies.commands.get(`script.node.${scriptKey}`);
      if (command === undefined) return "missing";
      return executeCommandAndWait(command, dependencies.context);
    },
    async switchBranch(name, remote) {
      const source = dependencies.branchSource;
      if (source === null) return false;
      await source.switchTo({ name, remote, current: false });
      return true;
    },
  };
}
