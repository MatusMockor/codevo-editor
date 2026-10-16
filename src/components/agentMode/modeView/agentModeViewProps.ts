import type { RemoteDeviceMcpSources } from "../../../application/remoteDeviceMcpSource";
import type { AgentQuestionApprovalGateway } from "../../../application/agentApprovalPorts";
import type {
  AgentArtifactLoader,
  AgentArtifactPreviewPort,
} from "../../../application/agentArtifactPorts";
import type { AgentNewThreadPicker } from "../../../application/agentNewThreadPicker";
import type { AgentRailProjectCollapsePreferencePort } from "../../../application/agentRailProjectCollapsePreferencePort";
import type { AgentRailProjectFocusPreferencePort } from "../../../application/agentRailProjectFocusPreferencePort";
import type { AgentRailWorkingSectionPreferencePort } from "../../../application/agentRailWorkingSectionPreferencePort";
import type { AgentThreadNotificationCenter } from "../../../application/agentThreadNotificationCenter";
import type {
  AgentTasksNotice,
  AgentThreadsSurface,
  ExternalSessionsSurface,
} from "../../../application/agentThreadPorts";
import type { AgentViewCommandBridge } from "../../../application/agentViewCommandBridge";
import type { AgentModelFavoritesPersistence } from "../../../application/useAgentModelFavorites";
import type { AgentProviderManagementSurface } from "../../../application/useAgentProviderManagement";
import type { AgentAccountUsageLoadState } from "../../../domain/agentAccountUsage";
import type { AgentFollowUpBehavior } from "../../../domain/agentFollowUpBehavior";
import type { AgentImageSurfacePort } from "../../../domain/agentImageShrink";
import type { AgentProjectDescriptor } from "../../../domain/agentProject";
import type { RemoteRunnerServer } from "../../../domain/remoteRunner";
import type { AgentCliKind } from "../../../domain/agentTask";
import type { SpeechLanguage } from "../../../domain/speechDictation";
import type { TextClipboardGateway } from "../../../domain/textClipboard";
import type { WorkspaceTrustOrigin } from "../../../domain/trust";
import type { AgentWorkbenchChrome } from "../agentWorkbenchChrome";
import type { AgentNavigationSession } from "../useAgentThreadNavigation";
import type { AgentRemotePortPreviewWiring } from "../useAgentServerPorts";

export type AgentModeAgents = AgentThreadsSurface & {
  readonly accountUsage?: Readonly<Record<"claudeCode" | "codex", AgentAccountUsageLoadState>>;
  readonly providerManagement: AgentProviderManagementSurface;
  readonly externalSessions?: ExternalSessionsSurface;
};

export interface AgentModeViewProps {
  readonly followUpBehavior?: AgentFollowUpBehavior;
  readonly dictationLanguage?: SpeechLanguage;
  readonly composerVisible?: boolean;
  readonly questionGateway?: AgentQuestionApprovalGateway | null;
  readonly artifactLoader?: AgentArtifactLoader | null;
  readonly artifactPreview?: AgentArtifactPreviewPort | null;
  readonly imageSurface?: AgentImageSurfacePort | null;
  readonly navigationSession?: AgentNavigationSession;
  readonly navigationKey?: string;
  readonly agents: AgentModeAgents;
  readonly modelFavoritesPersistence?: AgentModelFavoritesPersistence | null;
  readonly workspaceRoot: string | null;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly projectsLoaded?: boolean;
  readonly overflowRootPaths: ReadonlyArray<string>;
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>>;
  readonly nowTickMs?: number;
  readonly viewCommands?: AgentViewCommandBridge | null;
  readonly chrome: AgentWorkbenchChrome;
  readonly textClipboard?: TextClipboardGateway | null;
  readonly projectCollapsePreference?: AgentRailProjectCollapsePreferencePort | null;
  readonly projectFocusPreference?: AgentRailProjectFocusPreferencePort | null;
  readonly workingSectionPreference?: AgentRailWorkingSectionPreferencePort | null;
  readonly newThreadPicker?: AgentNewThreadPicker | null;
  readonly threadNotifications?: AgentThreadNotificationCenter | null;
  readonly threadNotificationsVisible?: boolean;
  readonly remotePortPreview?: AgentRemotePortPreviewWiring | null;
  onOpenSourceControl?(): void;
  onOpenEnvironmentSettings?(): void;
  onOpenUsageSettings?(): void;
  onOpenMcpSettings?(): void;
  onTrustProject(projectRootKey: string, origin?: WorkspaceTrustOrigin): void;
  onCloseProject?(rootPath: string): void;
  onActivateWorkspaceTab?(rootPath: string): Promise<boolean>;
  onReleaseProject(projectRootKey: string): void;
}

export interface AgentModeCloneAttachments {
  readonly local: AgentThreadsSurface["attachments"];
  readonly remote: AgentThreadsSurface["attachments"];
}

export type LocalAgentModeViewProps = AgentModeViewProps & {
  onSelectedThreadChange(threadId: string | null): void;
  onSelectedProjectChange(rootKey: string | null): void;
  onSelectProjectEnvironment(rootKey: string): void;
  refreshRemoteProjects(): Promise<void>;
  selectedServerId: string | null;
  authoritativeRemoteProjectKeys: ReadonlySet<string>;
  cloneAttachments: AgentModeCloneAttachments;
  deviceMcpSources?: RemoteDeviceMcpSources;
};

export const NO_REMOTE_SERVERS: readonly RemoteRunnerServer[] = [];
export const REMOTE_PROVIDERS_ENABLED = { claudeCode: true, codex: true } as const;

export type AgentModeNoticeReporter = (notice: AgentTasksNotice | null) => void;
