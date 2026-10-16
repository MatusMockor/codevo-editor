import { useEffect, useLayoutEffect, useMemo } from "react";
import type { AgentThreadView } from "../../../application/agentThreadPorts";
import {
  agentProjectOwnsLaunchRoot,
  agentProjectOwnsOwner,
  type AgentProjectDescriptor,
} from "../../../domain/agentProject";
import type { RemoteRunnerContextValue } from "../../remoteRunner/remoteRunnerContext";
import { agentSurfaceScopeFor } from "../agentSurfacePolicy";
import type { AgentWorkbenchChrome } from "../agentWorkbenchChrome";
import { useAgentDraftEnvironment } from "../useAgentDraftEnvironment";
import type { AgentThreadNavigation } from "../useAgentThreadNavigation";
import { useRemoteSurfaceContext } from "../useRemoteSurfaceContext";
import { useScopedAgentNotice } from "../useScopedAgentNotice";
import type { AgentModeProjects } from "./useAgentModeProjects";

export interface AgentModeScopeOptions {
  readonly navigation: AgentThreadNavigation;
  readonly selectedThread: AgentThreadView | null;
  readonly selectedThreadId: string | null;
  readonly projectsState: AgentModeProjects;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly selectedServerId: string | null;
  readonly remoteContext: RemoteRunnerContextValue | null;
  readonly chrome: AgentWorkbenchChrome;
  readonly workspaceRoot: string | null;
  onSelectedProjectChange(rootKey: string | null): void;
}

export function useAgentModeScope({
  navigation,
  selectedThread,
  selectedThreadId,
  projectsState,
  projects,
  selectedServerId,
  remoteContext,
  chrome,
  workspaceRoot,
  onSelectedProjectChange,
}: AgentModeScopeOptions) {
  const { groups, displayProjects, repositoryIdentities, projectLinks } = projectsState;
  const draft = useAgentDraftEnvironment({
    scope: navigation.composerScope,
    selectedThread,
    groups,
    projects,
    displayProjects,
    selectedServerId,
    repositoryIdentities,
    projectLinks,
  });
  const { scope: composerScope, projects: composerProjects } = draft;
  const remoteSurface = useRemoteSurfaceContext({
    remote: remoteContext,
    thread: selectedThread,
    selectedThreadId,
    draftProjectRootKey:
      composerScope?.kind === "missing" ? null : (composerScope?.projectRootKey ?? null),
  });
  const selectedProject =
    projects.find(
      (project) =>
        project.rootKey === (selectedThread?.thread.owner.rootKey ?? composerScope?.projectRootKey),
    ) ?? null;
  const selectedRootKey = selectedProject?.rootKey ?? null;
  useLayoutEffect(
    () => onSelectedProjectChange(selectedRootKey),
    [onSelectedProjectChange, selectedRootKey],
  );
  const [localNotice, setLocalNotice] = useScopedAgentNotice(
    JSON.stringify([
      selectedServerId,
      selectedThreadId,
      selectedRootKey,
      selectedProject?.ownerId,
      selectedProject?.generation,
    ]),
  );
  const selectWorkspace = chrome.workspaceActivation?.select;
  useEffect(() => {
    if (selectWorkspace === undefined) return;
    if (
      selectedProject === null ||
      selectedProject.rootKey.startsWith("remote:") ||
      selectedProject.origin === "closed-tab-live-tasks"
    ) {
      selectWorkspace(null);
      return;
    }
    const owner = selectedThread?.thread.owner;
    const valid =
      owner === undefined
        ? composerScope !== null &&
          composerScope.kind !== "missing" &&
          composerScope.ownerId === selectedProject.ownerId &&
          composerScope.generation === selectedProject.generation
        : agentProjectOwnsOwner(selectedProject, owner) &&
          agentProjectOwnsLaunchRoot(selectedProject, owner.repositoryRoot);
    selectWorkspace(valid ? selectedProject : null);
  }, [composerScope, selectedProject, selectedThread, selectWorkspace, workspaceRoot]);
  const surfaceScope = useMemo(
    () => agentSurfaceScopeFor(composerScope, displayProjects, workspaceRoot),
    [composerScope, displayProjects, workspaceRoot],
  );
  return {
    draft,
    composerScope,
    composerProjects,
    remoteSurface,
    selectedRootKey,
    localNotice,
    setLocalNotice,
    surfaceScope,
  };
}

export type AgentModeScope = ReturnType<typeof useAgentModeScope>;
