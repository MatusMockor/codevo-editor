import type { ReactNode } from "react";
import {
  usePublishAgentRunningWork,
  usePublishAgentThreadAgents,
  type AgentRunningWorkSurface,
} from "./agents/agentAgentsPanelHooks";
import { AgentSubagentAnnouncer } from "./AgentSubagentAnnouncer";
import type { AgentThreadAgents } from "./useAgentThreadAgents";
import "./agentSubagents.css";

export function AgentAgentsDock({
  agents,
  children,
  running,
}: {
  readonly agents: AgentThreadAgents;
  readonly running: AgentRunningWorkSurface;
  readonly children: ReactNode;
}) {
  usePublishAgentThreadAgents(agents);
  usePublishAgentRunningWork(running);
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
