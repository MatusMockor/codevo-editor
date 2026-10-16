import type { AgentShipState } from "../../domain/agentShip";
import type { AgentShipFlowDependencies, AgentShipFlowSurface } from "./agentShipFlowContract";
import { removeShipWorktree } from "./agentShipRemoveWorktree";
import { commitShip, integrateShip, openShipCompareUrl, pushShip } from "./agentShipSteps";
import {
  applyShip,
  clearShip,
  createAgentShipFlowState,
  refreshShipStatus,
} from "./agentShipFlowState";

export type AgentShipFlowCommands = Omit<AgentShipFlowSurface, "states">;

export interface AgentShipFlowCoordinator extends AgentShipFlowCommands {
  setDependencies(dependencies: AgentShipFlowDependencies): void;
  setMounted(mounted: boolean): void;
}

export function createAgentShipFlowCoordinator(
  dependencies: AgentShipFlowDependencies,
  setStates: (states: ReadonlyMap<string, AgentShipState>) => void,
): AgentShipFlowCoordinator {
  const state = createAgentShipFlowState(dependencies, setStates);
  return {
    setDependencies: (next) => {
      state.dependenciesRef.current = next;
    },
    setMounted: (mounted) => {
      state.mountedRef.current = mounted;
    },
    refreshShipStatus: (threadId) => refreshShipStatus(state, threadId),
    commit: (threadId, message, selection) => commitShip(state, threadId, message, selection),
    push: (threadId) => pushShip(state, threadId),
    openCompareUrl: (threadId) => openShipCompareUrl(state, threadId),
    integrate: (threadId, mode) => integrateShip(state, threadId, mode),
    removeWorktree: (threadId, options) => removeShipWorktree(state, threadId, options),
    resetShip: (threadId) => applyShip(state, threadId, { kind: "reset" }),
    clear: (threadId) => clearShip(state, threadId),
  };
}
