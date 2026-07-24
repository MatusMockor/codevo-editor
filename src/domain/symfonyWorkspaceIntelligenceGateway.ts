import type {
  SymfonyConsoleCommandsResult,
  SymfonyRoutesResult,
  SymfonyServicesResult,
} from "./symfonyWorkspaceIntelligence";

/** Application-facing boundary for bounded Symfony workspace inspection. */
export interface SymfonyWorkspaceIntelligenceGateway {
  listSymfonyConsoleCommands(workspaceId: string): Promise<SymfonyConsoleCommandsResult>;
  listSymfonyRoutes(workspaceId: string): Promise<SymfonyRoutesResult>;
  listSymfonyServices(workspaceId: string): Promise<SymfonyServicesResult>;
}
