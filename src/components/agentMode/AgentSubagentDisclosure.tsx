import { ChevronRight, Users } from "lucide-react";
import { memo, useId, useMemo } from "react";
import {
  summarizeAgentRuntimeSubagents,
  type AgentRuntimeSubagent,
  type AgentRuntimeSubagentBatch,
  type AgentRuntimeSubagents,
} from "../../domain/agentRuntimeSubagent";
import { RoleTag } from "../../ui/foundation/RoleTag";
import { useAgentToolDisclosure } from "./AgentToolDisclosure";
import {
  agentRuntimeSubagentActivityLine,
  agentRuntimeSubagentBody,
  agentRuntimeSubagentMemberLabel,
  agentSpawnBatchOrigin,
  agentSpawnLeadLabel,
  agentSpawnStatusLabel,
  agentTurnSpawnBatch,
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
  const batch = useMemo(() => agentTurnSpawnBatch(subagents), [subagents]);
  if (batch === null) return null;
  return (
    <div className="cv-spawn-list">
      <AgentSpawnBatchRow
        batch={batch}
        key={batch.id}
        memberRenderProbe={memberRenderProbe}
        onOpenAgents={onOpenAgents}
      />
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
  const expanded = summary.live ? !disclosure.expanded : disclosure.expanded;

  return (
    <div
      className="cv-spawn"
      data-live={summary.live ? "true" : undefined}
      data-origin={origin}
      data-tone={summary.tone}
    >
      <button
        aria-controls={expanded ? membersId : undefined}
        aria-expanded={expanded}
        className="cv-spawn__head"
        onClick={disclosure.toggle}
        type="button"
      >
        <span aria-hidden="true" className="cv-spawn__icon">
          <Users size={16} />
        </span>
        <span className="cv-spawn__lead">{agentSpawnLeadLabel(summary, origin)}</span>
        <span aria-hidden="true" className="cv-spawn__sep">
          ·
        </span>
        <span className="cv-spawn__status">{agentSpawnStatusLabel(summary)}</span>
        <ChevronRight aria-hidden="true" className="cv-spawn__chevron" size={14} />
      </button>
      {expanded && (
        <>
          <ul aria-label="Subagents" className="cv-spawn__members" id={membersId}>
            {batch.agents.map((agent) => (
              <li key={agent.id}>
                <AgentSpawnMember agent={agent} renderProbe={memberRenderProbe} />
              </li>
            ))}
          </ul>
          {onOpenAgents !== undefined && (
            <button className="cv-spawn__open" onClick={onOpenAgents} type="button">
              Open Agents panel ›
            </button>
          )}
        </>
      )}
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
  const head = (
    <>
      <span className="cv-spawn-member__title">{agent.title}</span>
      {agent.role !== null && <RoleTag>{agent.role}</RoleTag>}
      <span className="cv-spawn-member__meta">{agentRuntimeSubagentMemberLabel(agent)}</span>
    </>
  );

  if (body === null) {
    return (
      <div className="cv-spawn-member" data-status={agent.status} data-title={titleState}>
        <div className="cv-spawn-member__head">{head}</div>
        {activityLine !== null && <p className="cv-spawn-member__activity">{activityLine}</p>}
      </div>
    );
  }

  return (
    <div className="cv-spawn-member" data-status={agent.status} data-title={titleState}>
      <button
        aria-controls={disclosure.expanded ? bodyId : undefined}
        aria-expanded={disclosure.expanded}
        className="cv-spawn-member__head"
        onClick={disclosure.toggle}
        type="button"
      >
        {head}
      </button>
      {!disclosure.expanded && activityLine !== null && (
        <p className="cv-spawn-member__activity">{activityLine}</p>
      )}
      {disclosure.expanded && (
        <div className="cv-spawn-member__body" id={bodyId}>
          <pre>{body}</pre>
        </div>
      )}
    </div>
  );
});
