import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { AgentModelFavoritesPersistence } from "../../../application/useAgentModelFavorites";
import type { AgentProjectDescriptor } from "../../../domain/agentProject";
import type { AgentCliKind } from "../../../domain/agentTask";
import type { TextClipboardGateway } from "../../../domain/textClipboard";
import type { WorkspaceTrustOrigin } from "../../../domain/trust";
import { NoProjectsHero } from "../../projects/NoProjectsHero";
import { AgentCloneComposer } from "../AgentCloneComposer";
import { AgentRegionBoundary } from "../AgentRegionBoundary";
import { AgentRemoteDraftProjectChooser } from "../AgentRemoteDraftProjectChooser";
import type { AgentThreadNavigation } from "../useAgentThreadNavigation";
import {
  REMOTE_PROVIDERS_ENABLED,
  type AgentModeAgents,
  type AgentModeCloneAttachments,
} from "./agentModeViewProps";
import type { AgentModeComposer } from "./useAgentModeComposer";
import type { AgentModeCreation } from "./useAgentModeCreation";
import type { AgentModeProjects } from "./useAgentModeProjects";
import type { AgentModeThreadMenu } from "./useAgentModeThreadMenu";
import type { AgentModeScope } from "./useAgentModeScope";

export interface AgentModeConversationProps {
  readonly agents: AgentModeAgents;
  readonly navigation: AgentThreadNavigation;
  readonly projectsState: AgentModeProjects;
  readonly scope: AgentModeScope;
  readonly composerState: AgentModeComposer;
  readonly creationState: AgentModeCreation;
  readonly threadMenu: AgentModeThreadMenu;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly projectsLoaded: boolean;
  readonly cloneAttachments: AgentModeCloneAttachments;
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>>;
  readonly modelFavoritesPersistence: AgentModelFavoritesPersistence | null;
  readonly selectedThreadId: string | null;
  readonly selectedServerId: string | null;
  readonly textClipboard: TextClipboardGateway | null;
  readonly setProjectSelectionIntent: Dispatch<SetStateAction<number>>;
  readonly session: ReactNode;
  onOpenEnvironmentSettings?(): void;
  trustProject(projectRootKey: string, origin?: WorkspaceTrustOrigin): void;
}

export function AgentModeConversation({
  agents,
  navigation,
  projectsState,
  scope,
  composerState,
  creationState,
  threadMenu,
  projects,
  projectsLoaded,
  cloneAttachments,
  providerEnabled,
  modelFavoritesPersistence,
  selectedThreadId,
  selectedServerId,
  textClipboard,
  setProjectSelectionIntent,
  session,
  onOpenEnvironmentSettings,
  trustProject,
}: AgentModeConversationProps) {
  const { creation } = creationState;
  const { composer } = composerState;
  const { groups } = projectsState;
  return (
    <AgentRegionBoundary
      clipboard={textClipboard}
      region="conversation"
      resetKeys={[selectedThreadId, selectedServerId, creation.visible]}
    >
      {projects.length === 0 &&
      creation.pendingClones.length === 0 &&
      selectedServerId === null &&
      selectedThreadId === null ? (
        projectsLoaded ? (
          <NoProjectsHero onAddProject={creationState.openAddProject} />
        ) : null
      ) : creation.visible && creation.pending !== null && creation.pendingClone !== null ? (
        <AgentCloneComposer
          creation={creation}
          agents={{
            ...agents,
            attachments:
              creation.pending.environment === null
                ? cloneAttachments.local
                : cloneAttachments.remote,
          }}
          projects={projects}
          providerEnabled={
            creation.pending.environment === null ? providerEnabled : REMOTE_PROVIDERS_ENABLED
          }
          providerManagement={agents.providerManagement}
          modelFavoritesPersistence={modelFavoritesPersistence}
          endSessionConfirmation={threadMenu.menu.endSessionConfirmation}
          onThreadStarted={navigation.selectStartedThread}
          onOpenProviderSettings={agents.configureAgentCli}
          onOpenEnvironmentSettings={onOpenEnvironmentSettings}
          onTrustProject={trustProject}
        />
      ) : selectedThreadId === null && selectedServerId !== null && composer.target === null ? (
        <AgentRemoteDraftProjectChooser
          key={selectedServerId}
          projects={scope.composerProjects}
          cloneRunning={creationState.remoteAddCloneRunning}
          onAddProject={creationState.openRemoteAddProject}
          counterpart={scope.draft.counterpart}
          onAddCounterpart={(path) => creation.addCounterpart(selectedServerId, path)}
          onSelect={(project) => {
            const live = projects.find(
              (candidate) =>
                candidate.rootKey === project.rootKey &&
                candidate.ownerId === project.ownerId &&
                candidate.generation === project.generation,
            );
            if (
              live === undefined ||
              live.trust !== "trusted" ||
              selectedServerId === null ||
              !live.rootKey.startsWith(`remote:${encodeURIComponent(selectedServerId)}:`)
            )
              return;
            const group = groups.find(
              (candidate) =>
                candidate.projectRootKey === live.rootKey ||
                candidate.memberProjectRootKeys?.includes(live.rootKey),
            );
            setProjectSelectionIntent((current) => current + 1);
            navigation.setRailScope({
              projectRootKey: live.rootKey,
              repositoryRoot: live.rootPath,
              memberProjectRootKeys: group?.memberProjectRootKeys,
            });
            composer.startNewThread(project.rootKey, project.rootPath);
          }}
        />
      ) : (
        session
      )}
    </AgentRegionBoundary>
  );
}
