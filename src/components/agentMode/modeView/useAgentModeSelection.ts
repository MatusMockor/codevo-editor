import { useCallback, useState } from "react";
import type { RemoteRunnerContextValue } from "../../remoteRunner/remoteRunnerContext";
import type { AgentNavigationSession } from "../useAgentThreadNavigation";

interface AgentModeSelection {
  readonly navigationKey: string;
  readonly threadId: string | null;
  readonly projectRootKey: string | null;
}

function freshAgentModeSelection(
  navigationKey: string,
  session: AgentNavigationSession | undefined,
): AgentModeSelection {
  return {
    navigationKey,
    threadId: session?.current.selectedThreadId ?? null,
    projectRootKey: null,
  };
}

function currentAgentModeSelection(
  stored: AgentModeSelection,
  navigationKey: string,
  session: AgentNavigationSession | undefined,
): AgentModeSelection {
  if (stored.navigationKey === navigationKey) return stored;
  return freshAgentModeSelection(navigationKey, session);
}

export interface AgentModeSelectionState {
  readonly selectedThreadId: string | null;
  readonly selectedProjectRootKey: string | null;
  setSelectedThreadId(threadId: string | null): void;
  setSelectedProjectRootKey(projectRootKey: string | null): void;
  selectProjectEnvironment(rootKey: string): void;
}

export function useAgentModeSelection(
  navigationKey: string,
  session: AgentNavigationSession | undefined,
  remote: RemoteRunnerContextValue | null,
): AgentModeSelectionState {
  const [stored, setStored] = useState(() => freshAgentModeSelection(navigationKey, session));
  const { threadId: selectedThreadId, projectRootKey: selectedProjectRootKey } =
    currentAgentModeSelection(stored, navigationKey, session);
  const setSelectedThreadId = useCallback(
    (threadId: string | null) =>
      setStored((previous) => ({
        ...currentAgentModeSelection(previous, navigationKey, session),
        threadId,
      })),
    [navigationKey, session],
  );
  const setSelectedProjectRootKey = useCallback(
    (projectRootKey: string | null) =>
      setStored((previous) => ({
        ...currentAgentModeSelection(previous, navigationKey, session),
        projectRootKey,
      })),
    [navigationKey, session],
  );
  const selectProjectEnvironment = useCallback(
    (rootKey: string) => {
      if (!rootKey.startsWith("remote:")) {
        remote?.selectServer(null);
        return;
      }
      const server = remote?.servers.find((entry) =>
        rootKey.startsWith(`remote:${encodeURIComponent(entry.id)}:`),
      );
      if (server !== undefined) remote?.selectServer(server.id);
    },
    [remote],
  );
  return {
    selectedThreadId,
    selectedProjectRootKey,
    setSelectedThreadId,
    setSelectedProjectRootKey,
    selectProjectEnvironment,
  };
}
