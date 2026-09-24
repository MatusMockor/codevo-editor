import type { ColorSchemePreference, PaletteId } from "../../domain/appearance";
import type { PaletteIntent } from "../../domain/commandPalette/paletteItem";
import type { FileSearchResult } from "../../domain/workspace";
import {
  executeCommandAndWait,
  type CommandContext,
  type CommandExecutionOutcome,
  type CommandLookup,
} from "../commandRegistry";
import type { AgentPaletteProvider, ComposerPaletteModels } from "./commandPaletteProvider";

export type PaletteExecutionOutcome = "close" | "stay" | "failed";

export interface PaletteIntentPorts {
  readonly commands: CommandLookup;
  readonly context: CommandContext;
  readonly agent: AgentPaletteProvider | null;
  readonly models: ComposerPaletteModels | null;
  openFile(result: FileSearchResult): Promise<void>;
  switchEditorProject(path: string): Promise<boolean>;
  runEditorScript(scriptKey: string): Promise<CommandExecutionOutcome>;
  switchBranch(name: string, remote: boolean): Promise<boolean>;
  setPalette(palette: PaletteId): Promise<void>;
  setColorScheme(scheme: ColorSchemePreference): Promise<void>;
}

export async function executePaletteIntent(
  intent: PaletteIntent,
  ports: PaletteIntentPorts,
): Promise<PaletteExecutionOutcome> {
  switch (intent.kind) {
    case "none":
    case "page":
      return "stay";
    case "command":
      return runCommand(intent.commandId, ports);
    case "openThread":
      return settled(ports.agent?.openThread(intent.threadId) ?? false);
    case "newThreadIn":
      return settled(ports.agent?.newThreadIn(intent.projectKey) ?? false);
    case "switchProject":
      if (ports.agent !== null) return settled(ports.agent.switchProject(intent.projectKey));
      return settled(await ports.switchEditorProject(intent.projectKey));
    case "runScript":
      if (ports.agent !== null) return settled(ports.agent.runScript(intent.scriptKey));
      return settled((await ports.runEditorScript(intent.scriptKey)) === "executed");
    case "selectModel":
      return settled(ports.models?.selectModel(intent.modelKey) ?? false);
    case "openFile":
      await ports.openFile(intent.result);
      return "close";
    case "switchBranch":
      return settled(await ports.switchBranch(intent.name, intent.remote));
    case "setPalette":
      await ports.setPalette(intent.palette);
      return "close";
    case "setColorScheme":
      await ports.setColorScheme(intent.scheme);
      return "close";
    default:
      return unreachableIntent(intent);
  }
}

async function runCommand(
  commandId: string,
  ports: PaletteIntentPorts,
): Promise<PaletteExecutionOutcome> {
  const command = ports.commands.get(commandId);
  if (command === undefined) return "failed";
  const outcome = await executeCommandAndWait(command, ports.context);
  if (outcome === "executed") return "close";
  return "stay";
}

function settled(done: boolean): PaletteExecutionOutcome {
  if (done) return "close";
  return "failed";
}

function unreachableIntent(intent: never): never {
  return intent;
}
