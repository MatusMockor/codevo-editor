import type { ReactNode } from "react";
import { usePublishAgentThreadAgents } from "./agents/agentAgentsPanelHooks";
import { AgentSubagentAnnouncer } from "./AgentSubagentAnnouncer";
import type { AgentThreadAgents } from "./useAgentThreadAgents";
import "./agentSubagents.css";

export function AgentAgentsDock({
  agents,
  children,
}: {
  readonly agents: AgentThreadAgents;
  readonly children: ReactNode;
}) {
  usePublishAgentThreadAgents(agents);
  return (
    <div className="agents-dock">
      <div className="agents-dock__main">{children}</div>
      {agents.tracked && (
        <AgentSubagentAnnouncer
          key={agents.threadId}
          counts={agents.counts}
          truncated={agents.truncated}
        />
      )}
    </div>
  );
}
