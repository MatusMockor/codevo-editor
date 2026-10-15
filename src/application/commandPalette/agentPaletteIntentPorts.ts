import {
  executeCommandAndWait,
  type CommandContext,
  type CommandExecutionOutcome,
  type CommandLookup,
} from "../commandRegistry";
import type { PaletteBranchSource } from "./commandPaletteProvider";
import type { PaletteIntentPorts } from "./executePaletteIntent";

export interface AgentPaletteIntentDependencies {
  readonly commands: CommandLookup;
  readonly context: CommandContext;
  readonly workspaceTabs: readonly string[];
  readonly branchSource: PaletteBranchSource | null;
  activateWorkspaceTab(path: string): Promise<void>;
}

export type AgentPaletteIntentPorts = Pick<
  PaletteIntentPorts,
  "switchWorkspaceProject" | "runWorkspaceScript" | "switchBranch"
>;

export function agentPaletteIntentPorts(
  dependencies: AgentPaletteIntentDependencies,
): AgentPaletteIntentPorts {
  return {
    async switchWorkspaceProject(path) {
      if (!dependencies.workspaceTabs.includes(path)) return false;
      await dependencies.activateWorkspaceTab(path);
      return true;
    },
    async runWorkspaceScript(scriptKey): Promise<CommandExecutionOutcome> {
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
