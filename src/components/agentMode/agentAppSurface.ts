import type { CommandExecutionRunner } from "../../application/commandRegistry";
import type { NodePackageTaskState } from "../../application/nodePackageTaskLifecycle";
import type { AgentWorkbenchLayoutState } from "../../application/useAgentWorkbenchLayout";
import type { WorkbenchAgentsSurface } from "../../application/useWorkbenchAgents";
import type { WorkspaceOpenOutcome } from "../../application/workbenchController/useWorkspaceOpenRequestLifecycle";
import type { WorkspaceIdentityDescriptor } from "../../application/workspaceIdentityGatewayPort";
import type { GitRepositoryStatus } from "../../domain/gitRepositoryMapping";
import type {
  NodePackageScript,
  NodePackageTaskLaunchTarget,
} from "../../domain/nodePackageScripts";
import type {
  AppSettings,
  SettingsSection,
  StatusBarItemVisibility,
  WorkspaceSettings,
} from "../../domain/settings";
import type { WorkspaceTrustState } from "../../domain/trust";
import type { VscodeProcessTasksPanelProps } from "../VscodeProcessTasksPanel";

export type AgentAppSettingsFailurePolicy = "report" | "reportAndReject";

export interface AgentAppWorkspaceOpenReceipt {
  readonly outcome: WorkspaceOpenOutcome;
  isCurrent(): boolean;
}

export interface AgentAppNodePackageScripts {
  readonly scripts: readonly NodePackageScript[];
  readonly truncated: boolean;
  readonly available: boolean;
  readonly error: string | null;
  readonly pending: boolean;
  readonly task: NodePackageTaskState | null;
  run(
    script: NodePackageScript,
    launchTarget?: NodePackageTaskLaunchTarget,
    repositoryRoot?: string,
  ): boolean;
  stop(): void;
  refresh(): Promise<boolean>;
}

export interface AgentAppSurface {
  readonly agentWorkbench: AgentWorkbenchLayoutState;
  readonly appSettings: AppSettings;
  readonly bottomPanelVisible: boolean;
  readonly nodePackageScripts: AgentAppNodePackageScripts;
  readonly settingsOpen: boolean;
  readonly runCommand: CommandExecutionRunner;
  readonly workspaceIdentityDescriptor: WorkspaceIdentityDescriptor | null;
  readonly workspaceRoot: string | null;
  readonly workspaceSettings: WorkspaceSettings;
  readonly workspaceTrust: WorkspaceTrustState | null;
  readonly agents: WorkbenchAgentsSurface;
  readonly gitRepositoryStatuses?: GitRepositoryStatus[];
  readonly vscodeProcessTasks?: VscodeProcessTasksPanelProps;
  readonly closeWorkspaceTab: (path: string) => Promise<void>;
  readonly hideBottomPanel: () => void;
  readonly openWorkspaceRootWithReceipt: (path: string) => Promise<AgentAppWorkspaceOpenReceipt>;
  readonly saveWorkbenchSettings: (
    nextAppSettings: AppSettings,
    nextWorkspaceSettings: WorkspaceSettings,
    nextTrusted: boolean | null,
    appSettingsFailurePolicy?: AgentAppSettingsFailurePolicy,
  ) => Promise<void>;
  readonly showTerminalPanel: () => void;
  readonly activateWorkspaceTab?: (path: string) => Promise<void>;
  readonly openSettingsSection?: (section: SettingsSection) => void;
  readonly setStatusBarItemVisibility?: (
    key: keyof StatusBarItemVisibility,
    visible: boolean,
  ) => Promise<void>;
}
