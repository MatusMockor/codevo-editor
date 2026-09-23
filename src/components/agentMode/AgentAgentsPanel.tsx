import { Bot, Check, X } from "lucide-react";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { AgentRuntimeSubagent } from "../../domain/agentRuntimeSubagent";
import {
  agentAgentsPanelModel,
  type AgentAgentsPanelGroup,
  type AgentAgentsPanelModel,
} from "./agentAgentsPanelPresentation";
import { createAgentElapsedTicker, type AgentElapsedTicker } from "./agentElapsedTicker";
import { trapTab } from "./agentFocusTrap";
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
  readonly onClose?: () => void;
  readonly autoFocus?: boolean;
  readonly modal?: boolean;
  readonly ticker?: AgentElapsedTicker;
  readonly rowRenderProbe?: (agentId: string) => void;
}

const ElapsedTickerContext = createContext<AgentElapsedTicker | null>(null);

export function AgentAgentsPanel({
  groups,
  onClose,
  autoFocus = false,
  modal = false,
  ticker: sharedTicker,
  rowRenderProbe,
}: AgentAgentsPanelProps) {
  const model = useMemo(() => agentAgentsPanelModel(groups), [groups]);
  const [ownTicker] = useState(() =>
    sharedTicker === undefined ? createAgentElapsedTicker() : null,
  );
  const ticker = sharedTicker ?? ownTicker;
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const takesFocus = autoFocus || modal;

  useEffect(() => () => ownTicker?.dispose(), [ownTicker]);

  useEffect(() => {
    if (!takesFocus) return;
    const opener = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (!(opener instanceof HTMLElement) || !opener.isConnected) return;
      if (document.activeElement !== null && document.activeElement !== document.body) return;
      opener.focus();
    };
  }, [takesFocus]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === "Tab" && modal) {
      trapTab(event, [closeRef]);
      return;
    }
    if (event.key !== "Escape" || onClose === undefined) return;
    event.stopPropagation();
    onClose();
  };

  return (
    <aside
      aria-label="Agents"
      aria-modal={modal ? true : undefined}
      className="agents-panel"
      onKeyDown={onKeyDown}
      role={modal ? "dialog" : undefined}
    >
      <header className="agents-panel__head">
        <div className="agents-panel__heading-group">
          <h2 className="agents-panel__heading">Agents</h2>
          {model.notice !== null && <p className="agents-panel__notice">{model.notice}</p>}
        </div>
        {onClose !== undefined && (
          <button
            aria-label="Close Agents panel"
            className="agent-iconbutton"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            <X aria-hidden="true" size={14} />
          </button>
        )}
      </header>
      {model.rows.length === 0 && <AgentsPanelEmpty />}
      {model.rows.length > 0 && (
        <ElapsedTickerContext.Provider value={ticker}>
          <ul aria-label="Thread agents" className="agents-panel__list">
            {model.rows.map((row) => (
              <AgentsPanelRow
                agent={row.agent}
                key={row.key}
                renderProbe={rowRenderProbe}
                tickerKey={row.key}
              />
            ))}
          </ul>
        </ElapsedTickerContext.Provider>
      )}
      {model.rows.length > 0 && (
        <footer className="agents-panel__foot">
          <span>{footerSummary(model)}</span>
          <span>Σ {agentTokenCountLabel(model.totalTokens)} tok</span>
        </footer>
      )}
    </aside>
  );
}

function AgentsPanelEmpty() {
  return (
    <div className="agents-panel__empty">
      <Bot aria-hidden="true" size={22} />
      <p className="agents-panel__empty-title">No agents yet</p>
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
  const observedDurationMs = elapsed.kind === "live" ? elapsed.observedDurationMs : null;
  const statusLabel = agentRuntimeSubagentStatusLabel(agent.status);

  useEffect(() => {
    const clock = clockRef.current;
    if (ticker === null || clock === null || observedDurationMs === null) return;
    return ticker.register(tickerKey, observedDurationMs, {
      clock,
      stale: staleRef.current,
      description: descriptionRef.current,
    });
  }, [ticker, tickerKey, observedDurationMs]);

  return (
    <li className="agents-panel__item">
      <div
        className="agents-panel__row"
        data-status={agent.status}
        data-title={agent.titleKnown ? undefined : "unknown"}
      >
        <span aria-hidden="true" className="agents-panel__dot" />
        <span className="agents-panel__title">
          <span className="agents-panel__name">{agent.title}</span>
          {agent.role !== null && <span className="agents-panel__role">{agent.role}</span>}
        </span>
        <span className="agents-panel__elapsed">
          {elapsed.kind === "settled" && <span>{agentElapsedLabel(elapsed.durationMs)}</span>}
          {elapsed.kind === "live" && (
            <span aria-hidden="true" ref={clockRef}>
              {agentElapsedLabel(elapsed.observedDurationMs)}
            </span>
          )}
          {agent.status === "completed" && <Check aria-hidden="true" size={12} />}
        </span>
        <span className="agents-panel__activity">
          <span className="agents-panel__activity-text">
            {agentRuntimeSubagentActivityLine(agent) ?? statusLabel}
          </span>
          {elapsed.kind === "live" && <span className="agents-panel__stale" ref={staleRef} />}
        </span>
        <span className="agents-panel__metrics">{agentRuntimeSubagentMetricsLabel(agent)}</span>
        <span className="agent-visually-hidden">{statusLabel}</span>
        {elapsed.kind === "live" && <span className="agent-visually-hidden" ref={descriptionRef} />}
      </div>
      <AgentsPanelRecentActivity entries={agent.recentActivity} />
    </li>
  );
});

function AgentsPanelRecentActivity({ entries }: { readonly entries: ReadonlyArray<string> }) {
  if (entries.length === 0) return null;
  return (
    <details className="agents-panel__history">
      <summary className="agents-panel__history-summary">
        {agentRecentActivityLabel(entries.length)}
      </summary>
      <ol aria-label="Recent activity" className="agents-panel__history-list">
        {entries.map((entry, index) => (
          <li className="agents-panel__history-entry" key={index}>
            {entry}
          </li>
        ))}
      </ol>
    </details>
  );
}

function footerSummary(model: AgentAgentsPanelModel): string {
  return [
    model.working === 0 ? null : `${model.working} working`,
    model.idle === 0 ? null : `${model.idle} idle`,
    model.settled === 0 ? null : `${model.settled} settled`,
  ]
    .filter((value): value is string => value !== null)
    .join(" · ");
}
