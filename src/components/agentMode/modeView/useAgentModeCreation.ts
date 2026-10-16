import { useLayoutEffect, useMemo, type RefObject } from "react";
import type { AgentThreadView } from "../../../application/agentThreadPorts";
import type { AgentProjectDescriptor } from "../../../domain/agentProject";
import { agentThreadHeaderProject, type AgentWorkbenchChrome } from "../agentWorkbenchChrome";
import { remoteAddProjectCloneActive } from "../remoteAddProject/remoteAddProjectPresentation";
import {
  agentConversationEscapeAction,
  useAgentConversationEscape,
} from "../useAgentConversationEscape";
import { useAgentProjectCreation } from "../useAgentProjectCreation";
import type { AgentThreadNavigation } from "../useAgentThreadNavigation";
import { useAgentLatestCallback } from "../useAgentThreadPresentationViews";
import type { AgentModeNoticeReporter } from "./agentModeViewProps";
import type { AgentModeComposer } from "./useAgentModeComposer";
import type { AgentModeProjects } from "./useAgentModeProjects";

export interface AgentModeCreationOptions {
  readonly chrome: AgentWorkbenchChrome;
  readonly navigation: AgentThreadNavigation;
  readonly projectsState: AgentModeProjects;
  readonly composerState: AgentModeComposer;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly selectedThread: AgentThreadView | null;
  readonly selectedThreadId: string | null;
  readonly selectedServerId: string | null;
  readonly workspaceRoot: string | null;
  readonly projectSelectionIntent: number;
  readonly openAddProjectRef: RefObject<() => void>;
  readonly activeProjectRootKeyRef: RefObject<string | null>;
  readonly setLocalNotice: AgentModeNoticeReporter;
  refreshRemoteProjects(): Promise<void>;
  onSelectProjectEnvironment(rootKey: string): void;
}

export function useAgentModeCreation({
  chrome,
  navigation,
  projectsState,
  composerState,
  projects,
  selectedThread,
  selectedThreadId,
  selectedServerId,
  workspaceRoot,
  projectSelectionIntent,
  openAddProjectRef,
  activeProjectRootKeyRef,
  setLocalNotice,
  refreshRemoteProjects,
  onSelectProjectEnvironment,
}: AgentModeCreationOptions) {
  const { groups, executionGroups } = projectsState;
  const { composer, composerProps } = composerState;
  const composerTargetProjectRootKey = composer.target?.projectRootKey ?? null;
  const composerTargetRepositoryRoot = composer.target?.repositoryRoot ?? null;
  const addProjectSelectionIdentity = useMemo(
    () => ({ selectedThreadId, projectSelectionIntent, composerTargetProjectRootKey }),
    [composerTargetProjectRootKey, selectedThreadId, projectSelectionIntent],
  );
  const selectAddedProject = useAgentLatestCallback((project: AgentProjectDescriptor) => {
    if (!navigation.setProjectScope(project.rootKey)) return;
    navigation.setRailScope({ projectRootKey: project.rootKey, repositoryRoot: project.rootPath });
    onSelectProjectEnvironment(project.rootKey);
    navigation.clearSelectedThread();
    composer.clearSelection();
  });
  const creation = useAgentProjectCreation({
    selectionIdentity: addProjectSelectionIdentity,
    onProjectAdded: selectAddedProject,
    chrome: chrome.addProject,
    projects,
    reportNotice: setLocalNotice,
    workspaceRoot,
    selectedServerId,
    refreshProjects: refreshRemoteProjects,
  });
  const { remoteAdd } = creation;
  useAgentConversationEscape(
    navigation.centerRef,
    creation.visible ? null : agentConversationEscapeAction(composerProps),
  );
  const openRemoteAddProject = useAgentLatestCallback(creation.open);
  const cancelPendingClone = useAgentLatestCallback(creation.cancel);
  const dismissPendingClone = useAgentLatestCallback(creation.dismiss);
  const openAddProject = useAgentLatestCallback(creation.open);
  useLayoutEffect(() => {
    openAddProjectRef.current = openAddProject;
  }, [openAddProject, openAddProjectRef]);
  const openPendingClone = useAgentLatestCallback(creation.showPending);
  const remoteAddCloneRunning =
    remoteAdd.pendingClone !== null && remoteAddProjectCloneActive(remoteAdd.pendingClone.status);

  const cloneComposerVisible =
    creation.visible && creation.pending !== null && creation.pendingClone !== null;
  const cloneProjectRootKey = creation.completedProject?.rootKey ?? null;
  const cloneProjectRootPath = creation.completedProject?.rootPath ?? null;
  const headerFallback = useMemo(() => {
    if (cloneComposerVisible)
      return cloneProjectRootKey === null || cloneProjectRootPath === null
        ? null
        : { projectRootKey: cloneProjectRootKey, repositoryRoot: cloneProjectRootPath };
    return composerTargetProjectRootKey === null || composerTargetRepositoryRoot === null
      ? null
      : {
          projectRootKey: composerTargetProjectRootKey,
          repositoryRoot: composerTargetRepositoryRoot,
        };
  }, [
    cloneComposerVisible,
    cloneProjectRootKey,
    cloneProjectRootPath,
    composerTargetProjectRootKey,
    composerTargetRepositoryRoot,
  ]);
  const headerProject = useMemo(() => {
    const header = agentThreadHeaderProject(
      selectedThread,
      executionGroups,
      projects,
      headerFallback,
    );
    if (header === null) return null;
    const group = groups.find(
      (entry) =>
        entry.projectRootKey === header.projectRootKey ||
        entry.memberProjectRootKeys?.includes(header.projectRootKey),
    );
    return group ? { ...header, label: group.label } : header;
  }, [groups, executionGroups, headerFallback, projects, selectedThread]);
  const activeProjectRootKey = headerProject?.projectRootKey ?? null;
  useLayoutEffect(() => {
    activeProjectRootKeyRef.current = activeProjectRootKey;
  }, [activeProjectRootKey, activeProjectRootKeyRef]);
  return {
    creation,
    openRemoteAddProject,
    cancelPendingClone,
    dismissPendingClone,
    openAddProject,
    openPendingClone,
    remoteAddCloneRunning,
    cloneComposerVisible,
    headerProject,
  };
}

export type AgentModeCreation = ReturnType<typeof useAgentModeCreation>;
