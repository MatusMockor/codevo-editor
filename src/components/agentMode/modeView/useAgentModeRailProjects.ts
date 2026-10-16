import type { Dispatch, RefObject, SetStateAction } from "react";
import type { AgentNewThreadPicker } from "../../../application/agentNewThreadPicker";
import type { AgentTasksNotice } from "../../../application/agentThreadPorts";
import type { AgentProjectDescriptor } from "../../../domain/agentProject";
import { agentProjectWorkspaceTabRoot } from "../agentProjectWorkspaceTab";
import { agentRailScopeEntryFor } from "../agentSidebarPresentation";
import type { AgentWorkbenchChrome } from "../agentWorkbenchChrome";
import type { AgentComposerControllerState } from "../useAgentComposerState";
import { useAgentProjectThreadCommands } from "../useAgentProjectThreadCommands";
import type { AgentThreadNavigation } from "../useAgentThreadNavigation";
import { useAgentLatestCallback } from "../useAgentThreadPresentationViews";
import type { AgentModeNoticeReporter } from "./agentModeViewProps";
import type { AgentModeProjects } from "./useAgentModeProjects";

function workspaceTabSwitchFailedNotice(label: string): AgentTasksNotice {
  return { kind: "warning", message: `Could not switch to ${label}.`, action: null };
}

export interface AgentModeRailProjectsOptions {
  readonly chrome: AgentWorkbenchChrome;
  readonly navigation: AgentThreadNavigation;
  readonly projectsState: AgentModeProjects;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly composer: AgentComposerControllerState;
  readonly newThreadPicker: AgentNewThreadPicker | null;
  readonly activeProjectRootKeyRef: RefObject<string | null>;
  readonly setLocalNotice: AgentModeNoticeReporter;
  readonly setProjectSelectionIntent: Dispatch<SetStateAction<number>>;
  resetDraftLaunch(projectRootKey: string | null): void;
  resetProjectDraftLaunch(projectRootKey: string): void;
  onSelectProjectEnvironment(rootKey: string): void;
  onActivateWorkspaceTab?(rootPath: string): Promise<boolean>;
}

export function useAgentModeRailProjects({
  chrome,
  navigation,
  projectsState,
  projects,
  composer,
  newThreadPicker,
  activeProjectRootKeyRef,
  setLocalNotice,
  setProjectSelectionIntent,
  resetDraftLaunch,
  resetProjectDraftLaunch,
  onSelectProjectEnvironment,
  onActivateWorkspaceTab,
}: AgentModeRailProjectsOptions) {
  const { groups, projectDisclosure, projectFocus } = projectsState;
  const projectThreads = useAgentProjectThreadCommands({
    navigation,
    groups,
    composer: {
      clearSelection: composer.clearSelection,
      clearDraftTarget: composer.clearDraftTarget,
      resetDraftLaunch,
      resetProjectDraftLaunch,
    },
    picker: newThreadPicker,
    activeProjectRootKey: () => activeProjectRootKeyRef.current,
    onBeforeProjectChange: () => {
      chrome.addProject?.cancelSelection?.();
      setProjectSelectionIntent((current) => current + 1);
    },
    onSelectProjectEnvironment,
  });
  const requestNewThread = projectThreads.requestNewThread;
  const newThreadInProject = useAgentLatestCallback((projectRootKey: string) => {
    projectThreads.newThreadInProject(projectRootKey);
  });
  const activateRailProject = (projectRootKey: string): boolean | Promise<boolean> => {
    const entry = agentRailScopeEntryFor(navigation.scopeEntries, projectRootKey);
    const tabRoot =
      onActivateWorkspaceTab === undefined
        ? null
        : agentProjectWorkspaceTabRoot(projects, projectRootKey, entry?.memberProjectRootKeys);
    if (tabRoot !== null && onActivateWorkspaceTab !== undefined) {
      projectDisclosure.expand(projectRootKey);
      return onActivateWorkspaceTab(tabRoot).then((switched) => {
        if (!switched) setLocalNotice(workspaceTabSwitchFailedNotice(entry?.label ?? tabRoot));
        return switched;
      });
    }
    const scope = navigation.railScope;
    const current =
      scope !== null &&
      agentRailScopeEntryFor(navigation.scopeEntries, scope.projectRootKey)?.projectRootKey ===
        projectRootKey;
    if (!current && !projectThreads.switchProject(projectRootKey)) return false;
    projectDisclosure.expand(projectRootKey);
    return true;
  };
  const switchRailProject = useAgentLatestCallback((projectRootKey: string) => {
    void activateRailProject(projectRootKey);
  });
  const focusRailProject = useAgentLatestCallback((projectRootKey: string) => {
    const previous = projectFocus.focus;
    const activated = activateRailProject(projectRootKey);
    if (activated === false) return;
    projectFocus.setFocus("active");
    if (activated === true) return;
    void activated.then((switched) => {
      if (!switched) projectFocus.setFocus(previous);
    });
  });
  const showAllRailProjects = useAgentLatestCallback(() => projectFocus.setFocus("all"));
  return {
    projectThreads,
    requestNewThread,
    newThreadInProject,
    switchRailProject,
    focusRailProject,
    showAllRailProjects,
  };
}

export type AgentModeRailProjects = ReturnType<typeof useAgentModeRailProjects>;
