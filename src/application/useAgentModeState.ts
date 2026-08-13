import { useCallback, useEffect, useState } from "react";

export interface AgentModeState {
  readonly agentModeActive: boolean;
  setAgentModeActive(active: boolean): void;
  toggleAgentMode(): void;
}

export function useAgentModeState(
  workspaceOwnerKey: string | null,
  hasWorkspace: boolean,
): AgentModeState {
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(false);
  }, [workspaceOwnerKey]);

  const toggleAgentMode = useCallback(() => setActive((current) => !current), []);

  return {
    agentModeActive: active && hasWorkspace,
    setAgentModeActive: setActive,
    toggleAgentMode,
  };
}
