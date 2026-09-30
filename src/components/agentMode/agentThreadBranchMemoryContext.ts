import { createContext, useContext } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  EMPTY_AGENT_THREAD_BRANCH_MEMORY,
  agentThreadBranchOf,
  type AgentThreadBranchMemory,
} from "../../domain/agentThreadBranchMemory";
import { AgentRowServerNamesContext } from "./agentRowServerNamesContext";
import {
  agentThreadRowLocation,
  agentThreadRowServerName,
  type AgentThreadRowLocation,
} from "./agentThreadRowLocation";

export const AgentThreadBranchMemoryContext = createContext<AgentThreadBranchMemory>(
  EMPTY_AGENT_THREAD_BRANCH_MEMORY,
);

export interface AgentThreadRowPlace {
  readonly serverName: string | null;
  readonly connectedServerName: string | null;
  readonly location: AgentThreadRowLocation;
}

export function useAgentThreadRowPlace(view: AgentThreadView): AgentThreadRowPlace {
  const memory = useContext(AgentThreadBranchMemoryContext);
  const serverNames = useContext(AgentRowServerNamesContext);
  const owner = view.thread.owner;
  const serverName = agentThreadRowServerName(view, serverNames);
  const execution = view.execution;
  const connectedServerName =
    execution?.kind === "remote" ? (serverNames.get(execution.serverId) ?? null) : null;
  const rememberedBranch = agentThreadBranchOf(memory, {
    threadId: view.thread.threadId,
    rootKey: owner.rootKey,
    ownerId: owner.ownerId,
  });
  return {
    serverName,
    connectedServerName,
    location: agentThreadRowLocation(view, { serverName, rememberedBranch }),
  };
}
