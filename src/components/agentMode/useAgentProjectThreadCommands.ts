import { useMemo } from "react";
import type { AgentNewThreadPicker } from "../../application/agentNewThreadPicker";
import type { AgentProjectGroup } from "./agentModePresentation";
import { agentNewThreadRoute } from "./agentNewThreadRequest";
import { agentRailScopeEntryFor } from "./agentSidebarPresentation";
import type { AgentThreadNavigation } from "./useAgentThreadNavigation";
import { useAgentLatestCallback } from "./useAgentThreadPresentationViews";

export interface AgentProjectThreadCommandsOptions {
  readonly navigation: Pick<
    AgentThreadNavigation,
    "newThreadTarget" | "setProjectScope" | "scopeEntries"
  >;
  readonly groups: ReadonlyArray<AgentProjectGroup>;
  readonly composer: {
    clearSelection(): void;
    resetDraftLaunch(projectRootKey: string | null): void;
    resetProjectDraftLaunch(projectRootKey: string): void;
    clearDraftTarget(): void;
  };
  readonly picker: AgentNewThreadPicker | null;
  activeProjectRootKey(): string | null;
  onBeforeProjectChange(): void;
  onSelectProjectEnvironment(rootKey: string): void;
}

export interface AgentProjectThreadCommands {
  createInCurrentProject(): void;
  requestNewThread(shiftKey: boolean): void;
  openNewThreadPicker(): void;
  switchProject(projectRootKey: string): boolean;
  newThreadInProject(projectRootKey: string): boolean;
}

export function useAgentProjectThreadCommands({
  activeProjectRootKey,
  composer,
  groups,
  navigation,
  onBeforeProjectChange,
  onSelectProjectEnvironment,
  picker,
}: AgentProjectThreadCommandsOptions): AgentProjectThreadCommands {
  const selectEnvironmentFor = (projectRootKey: string): void => {
    if (linkedGroup(groups, projectRootKey)) return;
    onSelectProjectEnvironment(projectRootKey);
  };

  const createInCurrentProject = useAgentLatestCallback(() => {
    onBeforeProjectChange();
    const target = navigation.newThreadTarget();
    if (target === null) return;
    selectEnvironmentFor(target.projectRootKey);
    composer.resetDraftLaunch(target.projectRootKey);
    composer.clearSelection();
  });

  const openNewThreadPicker = useAgentLatestCallback(() => {
    if (picker?.open() === true) return;
    createInCurrentProject();
  });

  const switchProject = useAgentLatestCallback((projectRootKey: string) => {
    onBeforeProjectChange();
    if (!navigation.setProjectScope(projectRootKey)) return false;
    selectEnvironmentFor(projectRootKey);
    composer.clearDraftTarget();
    return true;
  });

  const newThreadInProject = useAgentLatestCallback((projectRootKey: string) => {
    onBeforeProjectChange();
    if (!navigation.setProjectScope(projectRootKey)) return false;
    selectEnvironmentFor(projectRootKey);
    composer.resetProjectDraftLaunch(projectRootKey);
    composer.clearSelection();
    return true;
  });

  const requestNewThread = useAgentLatestCallback((shiftKey: boolean) => {
    const route = agentNewThreadRoute({
      shiftKey,
      activeProjectRootKey: activeProjectRootKey(),
      projectCount: navigation.scopeEntries.length,
    });
    if (route.kind === "picker") {
      openNewThreadPicker();
      return;
    }
    if (sameProject(navigation, navigation.newThreadTarget(), route.projectRootKey)) {
      createInCurrentProject();
      return;
    }
    if (newThreadInProject(route.projectRootKey)) return;
    openNewThreadPicker();
  });

  return useMemo(
    () => ({
      createInCurrentProject,
      requestNewThread,
      openNewThreadPicker,
      switchProject,
      newThreadInProject,
    }),
    [
      createInCurrentProject,
      newThreadInProject,
      openNewThreadPicker,
      requestNewThread,
      switchProject,
    ],
  );
}

function sameProject(
  navigation: Pick<AgentThreadNavigation, "scopeEntries">,
  current: { readonly projectRootKey: string } | null,
  projectRootKey: string,
): boolean {
  if (current === null) return false;
  const entry = agentRailScopeEntryFor(navigation.scopeEntries, projectRootKey);
  return (entry?.projectRootKey ?? projectRootKey) === current.projectRootKey;
}

function linkedGroup(groups: ReadonlyArray<AgentProjectGroup>, projectRootKey: string): boolean {
  return groups.some(
    (group) => group.projectRootKey === projectRootKey && group.memberProjectRootKeys !== undefined,
  );
}
