import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { AgentShipState } from "../domain/agentShip";
import type {
  AgentShipFlowDependencies,
  AgentShipFlowSurface,
} from "./agentShip/agentShipFlowContract";
import { createAgentShipFlowCoordinator } from "./agentShip/agentShipFlowCoordinator";

export {
  AGENT_SHIP_STATUS_FRESHNESS_MS,
  DIRTY_WORKTREE_REMOVE_CONFIRMATION,
  type AgentShipFlowDependencies,
  type AgentShipFlowSurface,
  type ExternalUrlOpenerPort,
} from "./agentShip/agentShipFlowContract";

export function useAgentShipFlow(dependencies: AgentShipFlowDependencies): AgentShipFlowSurface {
  const [states, setStates] = useState<ReadonlyMap<string, AgentShipState>>(() => new Map());
  const [flow] = useState(() => createAgentShipFlowCoordinator(dependencies, setStates));

  useLayoutEffect(() => {
    flow.setDependencies(dependencies);
  });

  useEffect(() => {
    flow.setMounted(true);
    return () => {
      flow.setMounted(false);
    };
  }, [flow]);

  return useMemo(
    () => ({
      states,
      refreshShipStatus: flow.refreshShipStatus,
      commit: flow.commit,
      push: flow.push,
      openCompareUrl: flow.openCompareUrl,
      integrate: flow.integrate,
      removeWorktree: flow.removeWorktree,
      resetShip: flow.resetShip,
      clear: flow.clear,
    }),
    [flow, states],
  );
}
