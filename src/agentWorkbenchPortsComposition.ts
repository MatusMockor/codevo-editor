import { RemoteRepositoryIdentityCoordinator } from "./application/remoteRepositoryIdentityCoordinator";
import type { AgentWorkbenchPorts } from "./components/agentWorkbenchPortsContext";
import type { FileSearchGateway } from "./domain/workspace";
import { BrowserDiffViewGateway } from "./infrastructure/browserDiffViewGateway";
import { TauriGitGateway } from "./infrastructure/tauriGitGateway";
import { TauriGitSurfaceGateway } from "./infrastructure/tauriGitSurfaceGateway";
import { TauriGitWorkingTreeGateway } from "./infrastructure/tauriGitWorkingTreeGateway";
import { TauriGitWorktreeGateway } from "./infrastructure/tauriGitWorktreeGateway";
import {
  TauriForgeUrlOpener,
  TauriPullRequestGateway,
} from "./infrastructure/tauriPullRequestGateway";
import type { AgentRightPanelGateways } from "./components/agentMode/rightPanel/agentRightPanelGateways";
import { BrowserAgentAttachmentEncoder } from "./infrastructure/browserAgentAttachmentEncoder";
import { BrowserAgentComposerDraftPreference } from "./infrastructure/browserAgentComposerDraftPreference";
import { BrowserAgentProjectSelectionPreference } from "./infrastructure/browserAgentProjectSelectionPreference";
import { BrowserAgentRailProjectCollapsePreference } from "./infrastructure/browserAgentRailProjectCollapsePreference";
import { BrowserAgentRailProjectFocusPreference } from "./infrastructure/browserAgentRailProjectFocusPreference";
import { BrowserAgentRailWorkingSectionPreference } from "./infrastructure/browserAgentRailWorkingSectionPreference";
import { BrowserAgentThreadBranchMemory } from "./infrastructure/browserAgentThreadBranchMemory";
import { BrowserAgentTranscriptPositionPreference } from "./infrastructure/browserAgentTranscriptPositionPreference";
import { BrowserTextClipboardGateway } from "./infrastructure/browserTextClipboardGateway";
import { createDocumentAppFocusPort } from "./infrastructure/documentAppFocusPort";
import { TauriAgentArtifactFileGateway } from "./infrastructure/tauriAgentArtifactFileGateway";
import { TauriAgentArtifactGateway } from "./infrastructure/tauriAgentArtifactGateway";
import { TauriAgentArtifactPreviewGateway } from "./infrastructure/tauriAgentArtifactPreviewGateway";
import { TauriAgentAttentionGateway } from "./infrastructure/tauriAgentAttentionGateway";
import { TauriAgentLinkedFileGateway } from "./infrastructure/tauriAgentLinkedFileGateway";
import { TauriCodexRateLimitResetGateway } from "./infrastructure/tauriCodexRateLimitResetGateway";
import { TauriDirectoryListingGateway } from "./infrastructure/tauriDirectoryListingGateway";
import { createTauriFilePreviewReader } from "./infrastructure/tauriFilePreviewReader";
import { TauriCompareUrlOpener } from "./infrastructure/tauriGitIntegrationGateway";
import { resolveTauriWorkspaceHome } from "./infrastructure/tauriHomeDirectory";
import { TauriLocalProjectCloneGateway } from "./infrastructure/tauriLocalProjectCloneGateway";
import { TauriRemoteGitSyncGateway } from "./infrastructure/tauriRemoteGitSyncGateway";
import { TauriRemotePortPreviewGateway } from "./infrastructure/tauriRemotePortPreviewGateway";
import { TauriRemoteRepositoryIdentityGateway } from "./infrastructure/tauriRemoteRepositoryIdentityGateway";
import { TauriRepositoryIdentityGateway } from "./infrastructure/tauriRepositoryIdentityGateway";
import { TauriRevealPathGateway } from "./infrastructure/tauriRevealPathGateway";
import { WebviewAgentImageSurface } from "./infrastructure/webviewAgentImageSurface";

export function createAgentWorkbenchPorts(): AgentWorkbenchPorts {
  return {
    projectIdentity: new TauriRepositoryIdentityGateway(),
    remoteRepositoryIdentity: new RemoteRepositoryIdentityCoordinator(
      new TauriRemoteRepositoryIdentityGateway(),
    ),
    remoteGitSync: new TauriRemoteGitSyncGateway(),
    remoteAttachmentEncoder: new BrowserAgentAttachmentEncoder(),
    remoteCompareUrlOpener: new TauriCompareUrlOpener(),
    revealPath: new TauriRevealPathGateway(),
    outsideLinkedFiles: new TauriAgentLinkedFileGateway(),
    filePreviewReader: createTauriFilePreviewReader(),
    directoryListing: new TauriDirectoryListingGateway(),
    localClone: new TauriLocalProjectCloneGateway(),
    textClipboard: new BrowserTextClipboardGateway(),
    artifactLoader: new TauriAgentArtifactGateway(),
    artifactPreview: new TauriAgentArtifactPreviewGateway(),
    artifactFileLocator: new TauriAgentArtifactFileGateway(),
    imageSurface: new WebviewAgentImageSurface(),
    remotePortPreview: new TauriRemotePortPreviewGateway(),
    threadBranchMemory: new BrowserAgentThreadBranchMemory(),
    projectCollapsePreference: new BrowserAgentRailProjectCollapsePreference(),
    projectFocusPreference: new BrowserAgentRailProjectFocusPreference(),
    workingSectionPreference: new BrowserAgentRailWorkingSectionPreference(),
    sessionRestore: {
      projectSelections: new BrowserAgentProjectSelectionPreference(),
      composerDrafts: new BrowserAgentComposerDraftPreference(),
      transcriptPositions: new BrowserAgentTranscriptPositionPreference(),
    },
    codexRateLimitResets: new TauriCodexRateLimitResetGateway(),
    threadNotificationPorts: () => ({
      focus: createDocumentAppFocusPort(),
      system: new TauriAgentAttentionGateway(),
    }),
    resolveWorkspaceHome: resolveTauriWorkspaceHome,
    rightPanelGateways: createAgentRightPanelGateways,
  };
}

export function createAgentRightPanelGateways(
  fileSearch: FileSearchGateway,
): AgentRightPanelGateways {
  const surface = new TauriGitSurfaceGateway();
  return {
    git: new TauriGitGateway(),
    surfaceStatus: surface,
    workingTree: new TauriGitWorkingTreeGateway(),
    branchDiff: surface,
    diffComputation: new BrowserDiffViewGateway(),
    fileSearch,
    pullRequest: new TauriPullRequestGateway(),
    worktrees: new TauriGitWorktreeGateway(),
    externalUrl: new TauriForgeUrlOpener(),
  };
}

let standalonePorts: AgentWorkbenchPorts | null = null;

export function standaloneAgentWorkbenchPorts(): AgentWorkbenchPorts {
  standalonePorts ??= createAgentWorkbenchPorts();
  return standalonePorts;
}
