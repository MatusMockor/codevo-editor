import { createContext, useContext } from "react";
import { standaloneAgentWorkbenchPorts } from "../agentWorkbenchPortsComposition";
import type {
  AgentArtifactFileLocator,
  AgentArtifactLoader,
  AgentArtifactPreviewPort,
} from "../application/agentArtifactPorts";
import type { AgentAttachmentEncoderPort } from "../application/agentAttachmentEncoderPort";
import type { AgentOutsideTextFilePort } from "../application/agentOutsideLinkedFile";
import type { AgentRailProjectCollapsePreferencePort } from "../application/agentRailProjectCollapsePreferencePort";
import type { AgentRailProjectFocusPreferencePort } from "../application/agentRailProjectFocusPreferencePort";
import type { AgentRailWorkingSectionPreferencePort } from "../application/agentRailWorkingSectionPreferencePort";
import type { ExternalUrlOpenerPort } from "../application/agentShip/agentShipFlowContract";
import type { AgentThreadBranchMemoryPort } from "../application/agentThreadBranchMemoryPort";
import type { AgentThreadNotificationCenterPorts } from "../application/agentThreadNotificationCenter";
import type { CodexRateLimitResetGateway } from "../application/codexRateLimitResetGateway";
import type { FilePreviewReader } from "../application/filePreview/filePreviewReader";
import type { LocalProjectCloneGateway } from "../application/ports/localProjectCloneGateway";
import type { RemoteRepositoryIdentityCoordinator } from "../application/remoteRepositoryIdentityCoordinator";
import type { RepositoryIdentityGateway } from "../application/repositoryIdentityGateway";
import type { AgentImageSurfacePort } from "../domain/agentImageShrink";
import type { DirectoryListingGateway } from "../domain/directoryListing";
import type { RemoteGitSyncPort } from "../domain/remoteGitSync";
import type { RemotePortPreviewPort } from "../domain/remotePortPreview";
import type { TextClipboardGateway } from "../domain/textClipboard";
import type { FileSearchGateway } from "../domain/workspace";
import type { WorkspaceHomeReference } from "../domain/workspaceRootEligibility";
import type { RevealPathGateway } from "../infrastructure/tauriRevealPathGateway";
import type { AgentRightPanelGateways } from "./agentMode/rightPanel/agentRightPanelGateways";
import type { AgentSessionRestorePorts } from "./agentMode/useAgentSessionRestore";

export interface AgentWorkbenchPorts {
  readonly projectIdentity: RepositoryIdentityGateway;
  readonly remoteRepositoryIdentity: RemoteRepositoryIdentityCoordinator;
  readonly remoteGitSync: RemoteGitSyncPort;
  readonly remoteAttachmentEncoder: AgentAttachmentEncoderPort;
  readonly remoteCompareUrlOpener: ExternalUrlOpenerPort;
  readonly revealPath: RevealPathGateway;
  readonly outsideLinkedFiles: AgentOutsideTextFilePort;
  readonly filePreviewReader: FilePreviewReader;
  readonly directoryListing: DirectoryListingGateway;
  readonly localClone: LocalProjectCloneGateway;
  readonly textClipboard: TextClipboardGateway;
  readonly artifactLoader: AgentArtifactLoader;
  readonly artifactPreview: AgentArtifactPreviewPort;
  readonly artifactFileLocator: AgentArtifactFileLocator;
  readonly imageSurface: AgentImageSurfacePort;
  readonly remotePortPreview: RemotePortPreviewPort;
  readonly threadBranchMemory: AgentThreadBranchMemoryPort;
  readonly projectCollapsePreference: AgentRailProjectCollapsePreferencePort;
  readonly projectFocusPreference: AgentRailProjectFocusPreferencePort;
  readonly workingSectionPreference: AgentRailWorkingSectionPreferencePort;
  readonly sessionRestore: AgentSessionRestorePorts;
  readonly codexRateLimitResets: CodexRateLimitResetGateway;
  threadNotificationPorts(): AgentThreadNotificationCenterPorts;
  resolveWorkspaceHome(): Promise<WorkspaceHomeReference>;
  rightPanelGateways(fileSearch: FileSearchGateway): AgentRightPanelGateways;
}

export const AgentWorkbenchPortsContext = createContext<AgentWorkbenchPorts | null>(null);

export function useAgentWorkbenchPorts(): AgentWorkbenchPorts {
  return useContext(AgentWorkbenchPortsContext) ?? standaloneAgentWorkbenchPorts();
}
