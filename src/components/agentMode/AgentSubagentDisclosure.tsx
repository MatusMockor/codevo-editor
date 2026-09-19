import { ChevronRight } from "lucide-react";
import { memo, useId, useMemo } from "react";
import {
  summarizeAgentRuntimeSubagents,
  type AgentRuntimeSubagent,
  type AgentRuntimeSubagentBatch,
  type AgentRuntimeSubagents,
} from "../../domain/agentRuntimeSubagent";
import { useAgentToolDisclosure } from "./AgentToolDisclosure";
import {
  agentRuntimeSubagentActivityLine,
  agentRuntimeSubagentBody,
  agentRuntimeSubagentMemberLabel,
  agentSpawnBatchOrigin,
  agentSpawnLeadLabel,
  agentSpawnStatusLabel,
} from "./agentRuntimeSubagentPresentation";
import "./agentSubagents.css";

export const AgentSubagentDisclosure = memo(function AgentSubagentDisclosure({
  subagents,
  onOpenAgents,
  memberRenderProbe,
}: {
  readonly subagents: AgentRuntimeSubagents;
  readonly onOpenAgents?: () => void;
  readonly memberRenderProbe?: (agentId: string) => void;
}) {
  if (subagents.batches.length === 0) return null;
  return (
    <div className="agent-spawn-list">
      {subagents.batches.map((batch) => (
        <AgentSpawnBatchRow
          batch={batch}
          key={batch.id}
          memberRenderProbe={memberRenderProbe}
          onOpenAgents={onOpenAgents}
        />
      ))}
    </div>
  );
});

const AgentSpawnBatchRow = memo(function AgentSpawnBatchRow({
  batch,
  onOpenAgents,
  memberRenderProbe,
}: {
  readonly batch: AgentRuntimeSubagentBatch;
  readonly onOpenAgents?: () => void;
  readonly memberRenderProbe?: (agentId: string) => void;
}) {
  const disclosure = useAgentToolDisclosure(batch.id);
  const membersId = useId();
  const summary = useMemo(() => summarizeAgentRuntimeSubagents(batch.agents), [batch]);
  const origin = agentSpawnBatchOrigin(batch.id);
  const lead = agentSpawnLeadLabel(summary, origin);
  const status = agentSpawnStatusLabel(summary);

  return (
    <div className="agent-spawn" data-origin={origin} data-tone={summary.tone}>
      <button
        aria-controls={membersId}
        aria-expanded={disclosure.expanded}
        className="agent-spawn__row"
        onClick={disclosure.toggle}
        type="button"
      >
        <span aria-hidden="true" className="agent-spawn__dot" />
        <span className="agent-spawn__lead">{lead}</span>
        <span className="agent-spawn__status">{status}</span>
        <ChevronRight aria-hidden="true" className="agent-spawn__chevron" size={13} />
      </button>
      <div className="agent-spawn__members" hidden={!disclosure.expanded} id={membersId}>
        {disclosure.expanded && (
          <>
            <ul aria-label="Subagents" className="agent-spawn__list">
              {batch.agents.map((agent) => (
                <li key={agent.id}>
                  <AgentSpawnMember agent={agent} renderProbe={memberRenderProbe} />
                </li>
              ))}
            </ul>
            {onOpenAgents !== undefined && (
              <button className="agent-spawn__open" onClick={onOpenAgents} type="button">
                Open Agents panel ›
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
});

const AgentSpawnMember = memo(function AgentSpawnMember({
  agent,
  renderProbe,
}: {
  readonly agent: AgentRuntimeSubagent;
  readonly renderProbe?: (agentId: string) => void;
}) {
  renderProbe?.(agent.id);
  const disclosure = useAgentToolDisclosure(agent.id);
  const bodyId = useId();
  const body = agentRuntimeSubagentBody(agent);
  const activityLine = agentRuntimeSubagentActivityLine(agent);
  const titleState = agent.titleKnown ? undefined : "unknown";
  const label = agentRuntimeSubagentMemberLabel(agent);
  const head = (
    <>
      <span className="agent-spawn-member__title">{agent.title}</span>
      {agent.role !== null && <span className="agent-spawn-member__role">{agent.role}</span>}
      <span className="agent-spawn-member__meta">{label}</span>
    </>
  );

  if (body === null) {
    return (
      <div className="agent-spawn-member" data-status={agent.status} data-title={titleState}>
        <div className="agent-spawn-member__head">{head}</div>
        {activityLine !== null && <p className="agent-spawn-member__activity">{activityLine}</p>}
      </div>
    );
  }

  return (
    <div className="agent-spawn-member" data-status={agent.status} data-title={titleState}>
      <button
        aria-controls={bodyId}
        aria-expanded={disclosure.expanded}
        className="agent-spawn-member__head agent-spawn-member__head--action"
        onClick={disclosure.toggle}
        type="button"
      >
        {head}
      </button>
      {!disclosure.expanded && activityLine !== null && (
        <p className="agent-spawn-member__activity">{activityLine}</p>
      )}
      <div className="agent-spawn-member__body" hidden={!disclosure.expanded} id={bodyId}>
        {disclosure.expanded && <pre>{body}</pre>}
      </div>
    </div>
  );
});
