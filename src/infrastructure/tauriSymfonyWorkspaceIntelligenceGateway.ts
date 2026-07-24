import { invoke } from "@tauri-apps/api/core";
import type {
  SymfonyConsoleCommandsResult,
  SymfonyRoutesResult,
  SymfonyServicesResult,
} from "../domain/symfonyWorkspaceIntelligence";
import type { SymfonyWorkspaceIntelligenceGateway } from "../domain/symfonyWorkspaceIntelligenceGateway";
import {
  invokeSymfonyWorkspaceIntelligenceIpc,
  SYMFONY_WORKSPACE_INTELLIGENCE_IPC_COMMANDS,
  type InvokeSymfonyWorkspaceIntelligenceCommand,
} from "./tauriSymfonyWorkspaceIntelligenceIpcContract";

const invokeSymfonyCommand: InvokeSymfonyWorkspaceIntelligenceCommand = (command, args) =>
  invoke(command, args);

export class TauriSymfonyWorkspaceIntelligenceGateway implements SymfonyWorkspaceIntelligenceGateway {
  constructor(
    private readonly invokeCommand: InvokeSymfonyWorkspaceIntelligenceCommand = invokeSymfonyCommand,
  ) {}

  listSymfonyConsoleCommands(workspaceId: string): Promise<SymfonyConsoleCommandsResult> {
    return invokeSymfonyWorkspaceIntelligenceIpc(
      this.invokeCommand,
      SYMFONY_WORKSPACE_INTELLIGENCE_IPC_COMMANDS.commands,
      { workspaceId },
    );
  }

  listSymfonyRoutes(workspaceId: string): Promise<SymfonyRoutesResult> {
    return invokeSymfonyWorkspaceIntelligenceIpc(
      this.invokeCommand,
      SYMFONY_WORKSPACE_INTELLIGENCE_IPC_COMMANDS.routes,
      { workspaceId },
    );
  }

  listSymfonyServices(workspaceId: string): Promise<SymfonyServicesResult> {
    return invokeSymfonyWorkspaceIntelligenceIpc(
      this.invokeCommand,
      SYMFONY_WORKSPACE_INTELLIGENCE_IPC_COMMANDS.services,
      { workspaceId },
    );
  }
}
