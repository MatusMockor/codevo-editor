import { useMemo } from "react";
import type { AgentNewThreadPicker } from "../../application/agentNewThreadPicker";
import type { AgentProjectGroup } from "./agentModePresentation";
import { shouldCreateNewThreadInCurrentProject } from "./agentNewThreadRequest";
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
    clearDraftTarget(): void;
  };
  readonly picker: AgentNewThreadPicker | null;
  onBeforeProjectChange(): void;
  onSelectProjectEnvironment(rootKey: string): void;
}

export interface AgentProjectThreadCommands {
  createInCurrentProject(): void;
  requestNewThread(shiftKey: boolean): void;
  switchProject(projectRootKey: string): boolean;
  newThreadInProject(projectRootKey: string): boolean;
}

export function useAgentProjectThreadCommands({
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
    composer.clearSelection();
  });

  const requestNewThread = useAgentLatestCallback((shiftKey: boolean) => {
    const projectCount = navigation.scopeEntries.length;
    if (shouldCreateNewThreadInCurrentProject(shiftKey, projectCount)) {
      createInCurrentProject();
      return;
    }
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
    composer.clearSelection();
    return true;
  });

  return useMemo(
    () => ({ createInCurrentProject, requestNewThread, switchProject, newThreadInProject }),
    [createInCurrentProject, newThreadInProject, requestNewThread, switchProject],
  );
}

function linkedGroup(groups: ReadonlyArray<AgentProjectGroup>, projectRootKey: string): boolean {
  return groups.some(
    (group) => group.projectRootKey === projectRootKey && group.memberProjectRootKeys !== undefined,
  );
}
