import { Check, ChevronRight } from "lucide-react";
import { memo, useContext, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AgentRuntimeSubagent } from "../../domain/agentRuntimeSubagent";
import { RoleTag } from "../../ui/foundation/RoleTag";
import { agentElapsedObservation } from "./agentElapsedTicker";
import { AgentElapsedTickerContext } from "./agentElapsedTickerContext";
import {
  agentElapsedLabel,
  agentRecentActivityLabel,
  agentRuntimeSubagentActivityLine,
  agentRuntimeSubagentMetricsLabel,
  agentRuntimeSubagentStatusLabel,
} from "./agentRuntimeSubagentPresentation";

export const AgentsPanelRow = memo(function AgentsPanelRow({
  action,
  agent,
  describedBy,
  stopping = false,
  tickerKey,
  renderProbe,
}: {
  readonly action?: ReactNode;
  readonly agent: AgentRuntimeSubagent;
  readonly describedBy?: string;
  readonly stopping?: boolean;
  readonly tickerKey: string;
  readonly renderProbe?: (agentId: string) => void;
}) {
  renderProbe?.(agent.id);
  const ticker = useContext(AgentElapsedTickerContext);
  const clockRef = useRef<HTMLSpanElement | null>(null);
  const staleRef = useRef<HTMLSpanElement | null>(null);
  const descriptionRef = useRef<HTMLSpanElement | null>(null);
  const elapsed = agent.elapsed;
  const observedDurationMs = agentElapsedObservation(elapsed);
  const ticking = observedDurationMs !== undefined;
  const statusLabel = agentRuntimeSubagentStatusLabel(agent.status);

  useEffect(() => {
    const clock = clockRef.current;
    if (ticker === null || clock === null || observedDurationMs === undefined) return;
    return ticker.register(tickerKey, observedDurationMs, {
      clock,
      stale: staleRef.current,
      description: descriptionRef.current,
    });
  }, [ticker, tickerKey, observedDurationMs]);

  return (
    <li aria-describedby={describedBy} className="cv-agents-item">
      <div
        className="cv-agents-row"
        data-action={action === undefined ? undefined : "stop"}
        data-status={stopping ? "stopping" : agent.status}
        data-title={agent.titleKnown ? undefined : "unknown"}
      >
        <span aria-hidden="true" className="cv-agents-row__dot" />
        <span className="cv-agents-row__title">
          <span className="cv-agents-row__name">{agent.title}</span>
          {agent.role !== null && <RoleTag>{agent.role}</RoleTag>}
        </span>
        <span className="cv-agents-row__elapsed">
          {elapsed.kind === "settled" && <span>{agentElapsedLabel(elapsed.durationMs)}</span>}
          {ticking && (
            <span aria-hidden="true" ref={clockRef}>
              {agentElapsedLabel(observedDurationMs ?? 0)}
            </span>
          )}
          {agent.status === "completed" && <Check aria-hidden="true" size={12} />}
        </span>
        <span className="cv-agents-row__activity">
          <span className="cv-agents-row__activity-text">
            {stopping ? "Stopping…" : (agentRuntimeSubagentActivityLine(agent) ?? statusLabel)}
          </span>
          {ticking && <span className="cv-agents-row__stale" ref={staleRef} />}
        </span>
        <span className="cv-agents-row__metrics">{agentRuntimeSubagentMetricsLabel(agent)}</span>
        {action}
        <span className="agent-visually-hidden">{statusLabel}</span>
        {ticking && <span className="agent-visually-hidden" ref={descriptionRef} />}
      </div>
      <AgentsPanelRecentActivity entries={agent.recentActivity} />
    </li>
  );
});

function AgentsPanelRecentActivity({ entries }: { readonly entries: ReadonlyArray<string> }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (entries.length === 0) return null;
  return (
    <div className="cv-agents-recent">
      <button
        aria-controls={open ? listId : undefined}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <ChevronRight aria-hidden="true" size={12} />
        {agentRecentActivityLabel(entries.length)}
      </button>
      {open && (
        <ol aria-label="Recent activity" id={listId}>
          {entries.map((entry, index) => (
            <li key={index}>{entry}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
