import type { AppUpdaterGateway, AppUpdaterPreferencesGateway } from "../../domain/appUpdater";
import type { GitGateway } from "../../domain/git";
import type { SettingsGateway } from "../../domain/settings";
import type { TerminalGateway } from "../../domain/terminal";
import type { WorkspaceTrustGateway } from "../../domain/trust";
import type { VscodeProcessTasksGateway } from "../../domain/vscodeProcessTasksGateway";
import type {
  FileSearchGateway,
  WorkspaceFileGateway,
  WorkspaceOwnerFileGateway,
} from "../../domain/workspace";
import type { WorkspaceFileChangeGateway } from "../../domain/workspaceFileChange";
import type { WorkspaceHomeReference } from "../../domain/workspaceRootEligibility";
import type { WorkspaceRuntimeLifecycleGateway } from "../../domain/workspaceRuntimeLifecycle";
import type { NodePackageScriptsWorkbenchGateway } from "../useNodePackageScriptWorkbench";
import type { WorkbenchControllerAgentsOptions } from "../useWorkbenchControllerAgents";
import type { WindowZoomGateway } from "../windowZoomGateway";
import type { WorkbenchPrompter } from "../workbenchPrompter";
import type { WorkspaceIdentityGateway } from "../workspaceIdentityGatewayPort";
import type { AgentScriptsWorkspaceReader } from "./agentWorkspaceRuntimes";
import type { AgentNativeShutdownPort } from "./useAgentApplicationShutdown";

export type AgentAppAgentGateways = WorkbenchControllerAgentsOptions["options"] & {
  readonly resolveWorkspaceHome?: () => Promise<WorkspaceHomeReference>;
  readonly windowZoomGateway?: WindowZoomGateway;
};

export type AgentWorkspaceFiles = Pick<WorkspaceFileGateway, "readDirectory"> &
  AgentScriptsWorkspaceReader;

export type AgentWorkspaceOwnerFiles = Pick<
  WorkspaceOwnerFileGateway,
  "createDirectoryForWorkspace" | "createTextFileWithContentForWorkspace"
>;

export interface AgentAppWorkspaceGateways {
  readonly fileChanges: WorkspaceFileChangeGateway;
  readonly fileSearch: FileSearchGateway;
  readonly files: AgentWorkspaceFiles;
  readonly identity: WorkspaceIdentityGateway;
  readonly ownerFiles: AgentWorkspaceOwnerFiles;
}

export interface AgentAppUpdaterComposition {
  readonly appUpdaterGateway: AppUpdaterGateway;
  readonly appUpdaterPreferencesGateway: AppUpdaterPreferencesGateway;
  readonly appVersion: string;
}

export interface AgentAppControllerPorts {
  readonly agentGateways: AgentAppAgentGateways;
  readonly appUpdater: AgentAppUpdaterComposition;
  readonly gitGateway: GitGateway;
  readonly isBenignError: (error: unknown) => boolean;
  readonly nativeShutdown?: AgentNativeShutdownPort;
  readonly nodePackageScriptsGateway: NodePackageScriptsWorkbenchGateway;
  readonly settingsGateway: SettingsGateway;
  readonly terminalGateway: TerminalGateway;
  readonly vscodeProcessTasksGateway: VscodeProcessTasksGateway;
  readonly workbenchPrompter: WorkbenchPrompter;
  readonly workspace: AgentAppWorkspaceGateways;
  readonly workspaceRuntimeLifecycleGateway: WorkspaceRuntimeLifecycleGateway;
  readonly workspaceTrustGateway: WorkspaceTrustGateway;
}
