import { useCallback, useState } from "react";

export interface AgentModeState {
  readonly agentModeActive: boolean;
  setAgentModeActive(active: boolean): void;
  toggleAgentMode(): void;
}

interface OwnedAgentModeState {
  readonly active: boolean;
  readonly generation: number;
  readonly workspaceOwnerKey: string | null;
}

export function useAgentModeState(
  workspaceOwnerKey: string | null,
  hasWorkspace: boolean,
): AgentModeState {
  const currentWorkspaceOwnerKey = hasWorkspace ? workspaceOwnerKey : null;
  const [ownedState, setOwnedState] = useState<OwnedAgentModeState>({
    active: false,
    generation: 0,
    workspaceOwnerKey: currentWorkspaceOwnerKey,
  });

  if (ownedState.workspaceOwnerKey !== currentWorkspaceOwnerKey) {
    setOwnedState({
      active: false,
      generation: ownedState.generation + 1,
      workspaceOwnerKey: currentWorkspaceOwnerKey,
    });
  }

  const ownedGeneration = ownedState.generation;

  const setAgentModeActive = useCallback(
    (active: boolean) => {
      setOwnedState((current) => {
        if (
          currentWorkspaceOwnerKey === null ||
          current.workspaceOwnerKey !== currentWorkspaceOwnerKey ||
          current.generation !== ownedGeneration
        ) {
          return current;
        }

        if (current.active === active) {
          return current;
        }

        return { ...current, active };
      });
    },
    [currentWorkspaceOwnerKey, ownedGeneration],
  );

  const toggleAgentMode = useCallback(() => {
    if (currentWorkspaceOwnerKey === null) {
      return;
    }

    setOwnedState((current) =>
      current.workspaceOwnerKey === currentWorkspaceOwnerKey &&
      current.generation === ownedGeneration
        ? { ...current, active: !current.active }
        : current,
    );
  }, [currentWorkspaceOwnerKey, ownedGeneration]);

  const activeForCurrentWorkspace =
    currentWorkspaceOwnerKey !== null &&
    ownedState.workspaceOwnerKey === currentWorkspaceOwnerKey &&
    ownedState.active;

  return {
    agentModeActive: activeForCurrentWorkspace,
    setAgentModeActive,
    toggleAgentMode,
  };
}
