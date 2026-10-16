import { memo, type ComponentProps } from "react";
import type { AgentModelFavoritesPersistence } from "../../../application/useAgentModelFavorites";
import type { AgentProjectDescriptor } from "../../../domain/agentProject";
import type { AgentCliKind } from "../../../domain/agentTask";
import type { WorkspaceTrustOrigin } from "../../../domain/trust";
import { NoProjectsHero } from "../../projects/NoProjectsHero";
import { AgentCloneComposer } from "../AgentCloneComposer";
import { AgentRemoteDraftProjectChooser } from "../AgentRemoteDraftProjectChooser";
import {
  REMOTE_PROVIDERS_ENABLED,
  type AgentModeAgents,
  type AgentModeCloneAttachments,
} from "./agentModeViewProps";
import type { AgentModeCreation } from "./useAgentModeCreation";

export type AgentModeConversationKind = "noProjects" | "clone" | "remoteChooser" | "session";

type ChooserProps = ComponentProps<typeof AgentRemoteDraftProjectChooser>;
type CloneProps = ComponentProps<typeof AgentCloneComposer>;

export interface AgentModeConversationProps {
  readonly kind: Exclude<AgentModeConversationKind, "session">;
  readonly projectsLoaded: boolean;
  readonly agents: AgentModeAgents;
  readonly creation: AgentModeCreation["creation"];
  readonly cloneAttachments: AgentModeCloneAttachments;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>>;
  readonly modelFavoritesPersistence: AgentModelFavoritesPersistence | null;
  readonly endSessionConfirmation: CloneProps["endSessionConfirmation"];
  readonly selectedServerId: string | null;
  readonly chooserProjects: ChooserProps["projects"];
  readonly chooserCloneRunning: boolean;
  readonly counterpart: ChooserProps["counterpart"];
  onAddProject(): void;
  onAddRemoteProject: ChooserProps["onAddProject"];
  onSelectRemoteProject: ChooserProps["onSelect"];
  onThreadStarted: CloneProps["onThreadStarted"];
  onOpenProviderSettings: CloneProps["onOpenProviderSettings"];
  onOpenEnvironmentSettings?(): void;
  onTrustProject(projectRootKey: string, origin?: WorkspaceTrustOrigin): void;
}

export const AgentModeConversation = memo(function AgentModeConversation({
  kind,
  projectsLoaded,
  agents,
  creation,
  cloneAttachments,
  projects,
  providerEnabled,
  modelFavoritesPersistence,
  endSessionConfirmation,
  selectedServerId,
  chooserProjects,
  chooserCloneRunning,
  counterpart,
  onAddProject,
  onAddRemoteProject,
  onSelectRemoteProject,
  onThreadStarted,
  onOpenProviderSettings,
  onOpenEnvironmentSettings,
  onTrustProject,
}: AgentModeConversationProps) {
  if (kind === "noProjects") {
    return projectsLoaded ? <NoProjectsHero onAddProject={onAddProject} /> : null;
  }
  if (kind === "clone") {
    const remoteClone = creation.pending !== null && creation.pending.environment !== null;
    return (
      <AgentCloneComposer
        creation={creation}
        agents={{
          ...agents,
          attachments: remoteClone ? cloneAttachments.remote : cloneAttachments.local,
        }}
        projects={projects}
        providerEnabled={remoteClone ? REMOTE_PROVIDERS_ENABLED : providerEnabled}
        providerManagement={agents.providerManagement}
        modelFavoritesPersistence={modelFavoritesPersistence}
        endSessionConfirmation={endSessionConfirmation}
        onThreadStarted={onThreadStarted}
        onOpenProviderSettings={onOpenProviderSettings}
        onOpenEnvironmentSettings={onOpenEnvironmentSettings}
        onTrustProject={onTrustProject}
      />
    );
  }
  return (
    <AgentRemoteDraftProjectChooser
      key={selectedServerId}
      projects={chooserProjects}
      cloneRunning={chooserCloneRunning}
      onAddProject={onAddRemoteProject}
      counterpart={counterpart}
      onAddCounterpart={(path) =>
        selectedServerId === null ? undefined : creation.addCounterpart(selectedServerId, path)
      }
      onSelect={onSelectRemoteProject}
    />
  );
});
