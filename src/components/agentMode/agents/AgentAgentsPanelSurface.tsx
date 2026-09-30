import { AgentAgentsPanel } from "../AgentAgentsPanel";
import type { AgentAgentsPanelGroup } from "../agentAgentsPanelPresentation";
import { useAgentRunningWorkSnapshot, useAgentThreadAgentsSnapshot } from "./agentAgentsPanelHooks";

const NO_GROUPS: ReadonlyArray<AgentAgentsPanelGroup> = [];

export function AgentAgentsPanelSurface() {
  const agents = useAgentThreadAgentsSnapshot();
  const running = useAgentRunningWorkSnapshot();
  if (agents === null) return <AgentAgentsPanel groups={NO_GROUPS} />;
  return (
    <AgentAgentsPanel
      groups={agents.groups}
      key={agents.threadId}
      running={running?.threadId === agents.threadId ? running : null}
      ticker={agents.ticker}
    />
  );
}
