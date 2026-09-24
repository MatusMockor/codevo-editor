import { AgentAgentsPanel } from "../AgentAgentsPanel";
import type { AgentAgentsPanelGroup } from "../agentAgentsPanelPresentation";
import { useAgentThreadAgentsSnapshot } from "./agentAgentsPanelHooks";

const NO_GROUPS: ReadonlyArray<AgentAgentsPanelGroup> = [];

export function AgentAgentsPanelSurface() {
  const agents = useAgentThreadAgentsSnapshot();
  if (agents === null) return <AgentAgentsPanel groups={NO_GROUPS} />;
  return <AgentAgentsPanel groups={agents.groups} key={agents.threadId} ticker={agents.ticker} />;
}
