import { Bot, Check, ChevronRight } from "lucide-react";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AgentRuntimeSubagent } from "../../domain/agentRuntimeSubagent";
import { RoleTag } from "../../ui/foundation/RoleTag";
import {
  agentAgentsPanelModel,
  type AgentAgentsPanelEarlierGroup,
  type AgentAgentsPanelGroup,
  type AgentAgentsPanelModel,
} from "./agentAgentsPanelPresentation";
import {
  agentElapsedObservation,
  createAgentElapsedTicker,
  type AgentElapsedTicker,
} from "./agentElapsedTicker";
import {
  agentElapsedLabel,
  agentRuntimeSubagentActivityLine,
  agentRuntimeSubagentMetricsLabel,
  agentRuntimeSubagentStatusLabel,
  agentRecentActivityLabel,
  agentTokenCountLabel,
} from "./agentRuntimeSubagentPresentation";
import "./agentSubagents.css";

export interface AgentAgentsPanelProps {
  readonly groups: ReadonlyArray<AgentAgentsPanelGroup>;
  readonly ticker?: AgentElapsedTicker;
  readonly rowRenderProbe?: (agentId: string) => void;
}

const ElapsedTickerContext = createContext<AgentElapsedTicker | null>(null);

export function AgentAgentsPanel({
  groups,
  ticker: sharedTicker,
  rowRenderProbe,
}: AgentAgentsPanelProps) {
  const model = useMemo(() => agentAgentsPanelModel(groups), [groups]);
  const [ownTicker] = useState(() =>
    sharedTicker === undefined ? createAgentElapsedTicker() : null,
  );
  const ticker = sharedTicker ?? ownTicker;
  useEffect(() => () => ownTicker?.dispose(), [ownTicker]);
  const empty = model.current.length === 0 && model.earlier.length === 0;

  return (
    <section aria-label="Agents" className="cv-agents">
      <div className="cv-agents__body">
        {model.notice !== null && <p className="cv-agents__notice">{model.notice}</p>}
        {empty && <AgentsPanelEmpty />}
        <ElapsedTickerContext.Provider value={ticker}>
          {model.current.length > 0 && (
            <section className="cv-agents__section" data-section="current">
              <h3 className="cv-agents__label">This turn</h3>
              <ul aria-label="This turn" className="cv-agents__list">
                {model.current.map((row) => (
                  <AgentsPanelRow
                    agent={row.agent}
                    key={row.key}
                    renderProbe={rowRenderProbe}
                    tickerKey={row.key}
                  />
                ))}
              </ul>
            </section>
          )}
          {model.earlier.length > 0 && (
            <section className="cv-agents__section" data-section="earlier">
              <h3 className="cv-agents__label">Earlier</h3>
              {model.earlier.map((group) => (
                <AgentsPanelEarlier group={group} key={group.key} renderProbe={rowRenderProbe} />
              ))}
            </section>
          )}
        </ElapsedTickerContext.Provider>
      </div>
      {!empty && <AgentsPanelFooter model={model} />}
    </section>
  );
}

function AgentsPanelFooter({ model }: { readonly model: AgentAgentsPanelModel }) {
  return (
    <footer className="cv-agents__foot">
      <span className="cv-agents__counts">
        {model.working > 0 && (
          <span className="cv-agents__count cv-agents__working">{`● ${model.working} working`}</span>
        )}
        {model.idle > 0 && <span className="cv-agents__count">{`${model.idle} idle`}</span>}
        {model.settled > 0 && (
          <span className="cv-agents__count">{`${model.settled} settled`}</span>
        )}
      </span>
      <span className="cv-agents__total">{`Σ ${agentTokenCountLabel(model.totalTokens)} tok`}</span>
    </footer>
  );
}

function AgentsPanelEarlier({
  group,
  renderProbe,
}: {
  readonly group: AgentAgentsPanelEarlierGroup;
  readonly renderProbe?: (agentId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className="cv-agents-earlier-group">
      <button
        aria-controls={open ? listId : undefined}
        aria-expanded={open}
        className="cv-agents-earlier"
        data-tone={group.tone}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span aria-hidden="true" className="cv-agents-earlier__dot" />
        <span className="cv-agents-earlier__label">{group.label}</span>
        <span className="cv-agents-earlier__summary">
          {group.summary}
          <ChevronRight aria-hidden="true" size={12} />
        </span>
      </button>
      {open && (
        <ul aria-label={group.label} className="cv-agents__list" id={listId}>
          {group.rows.map((row) => (
            <AgentsPanelRow
              agent={row.agent}
              key={row.key}
              renderProbe={renderProbe}
              tickerKey={row.key}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AgentsPanelEmpty() {
  return (
    <div className="cv-agents__empty">
      <Bot aria-hidden="true" size={22} />
      <p className="cv-agents__empty-title">No agents yet</p>
      <p className="agent-note">
        When this thread spawns subagents, they show up here with live status, activity, and token
        usage.
      </p>
    </div>
  );
}

const AgentsPanelRow = memo(function AgentsPanelRow({
  agent,
  tickerKey,
  renderProbe,
}: {
  readonly agent: AgentRuntimeSubagent;
  readonly tickerKey: string;
  readonly renderProbe?: (agentId: string) => void;
}) {
  renderProbe?.(agent.id);
  const ticker = useContext(ElapsedTickerContext);
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
    <li className="cv-agents-item">
      <div
        className="cv-agents-row"
        data-status={agent.status}
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
            {agentRuntimeSubagentActivityLine(agent) ?? statusLabel}
          </span>
          {ticking && <span className="cv-agents-row__stale" ref={staleRef} />}
        </span>
        <span className="cv-agents-row__metrics">{agentRuntimeSubagentMetricsLabel(agent)}</span>
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
