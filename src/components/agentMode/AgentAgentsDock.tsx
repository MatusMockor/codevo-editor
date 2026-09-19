import { useState, type ReactNode } from "react";
import { useViewportWidth } from "../useViewportWidth";
import { AgentAgentsPanel } from "./AgentAgentsPanel";
import { agentAgentsDockMode } from "./agentAgentsPanelPresentation";
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
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const width = useViewportWidth(element);
  const mode = agentAgentsDockMode(agents.panel !== null, width);

  return (
    <div className="agents-dock" data-agents={mode} ref={setElement}>
      <div className="agents-dock__main" inert={mode === "overlay"}>
        {children}
      </div>
      {agents.panel !== null && <AgentAgentsPanel {...agents.panel} modal={mode === "overlay"} />}
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
