import { Bot, ChevronRight } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { AgentsPanelRow } from "./AgentAgentsPanelRow";
import { AgentElapsedTickerContext } from "./agentElapsedTickerContext";
import {
  agentAgentsPanelModel,
  type AgentAgentsPanelEarlierGroup,
  type AgentAgentsPanelGroup,
  type AgentAgentsPanelModel,
} from "./agentAgentsPanelPresentation";
import { createAgentElapsedTicker, type AgentElapsedTicker } from "./agentElapsedTicker";
import { agentTokenCountLabel } from "./agentRuntimeSubagentPresentation";
import { AgentRunningSection } from "./agents/AgentRunningSection";
import { agentRunningRowKeys } from "./agents/agentRunningWork";
import type { AgentRunningWorkSurface } from "./agents/agentAgentsPanelHooks";
import "./agentSubagents.css";

export interface AgentAgentsPanelProps {
  readonly groups: ReadonlyArray<AgentAgentsPanelGroup>;
  readonly ticker?: AgentElapsedTicker;
  readonly running?: AgentRunningWorkSurface | null;
  readonly rowRenderProbe?: (agentId: string) => void;
}

export function AgentAgentsPanel({
  groups,
  ticker: sharedTicker,
  running = null,
  rowRenderProbe,
}: AgentAgentsPanelProps) {
  const shownRunning = useMemo(
    () => agentRunningRowKeys(running?.work ?? null, groups),
    [groups, running],
  );
  const model = useMemo(() => agentAgentsPanelModel(groups, shownRunning), [groups, shownRunning]);
  const [ownTicker] = useState(() =>
    sharedTicker === undefined ? createAgentElapsedTicker() : null,
  );
  const ticker = sharedTicker ?? ownTicker;
  useEffect(() => () => ownTicker?.dispose(), [ownTicker]);
  const settledEmpty = model.current.length === 0 && model.earlier.length === 0;
  const runningEmpty = (running?.work.rows.length ?? 0) + (running?.work.unlisted ?? 0) === 0;
  const empty = settledEmpty && runningEmpty;

  return (
    <section aria-label="Agents" className="cv-agents">
      <div className="cv-agents__body">
        {model.notice !== null && <p className="cv-agents__notice">{model.notice}</p>}
        {empty && <AgentsPanelEmpty />}
        <AgentElapsedTickerContext.Provider value={ticker}>
          {running !== null && (
            <AgentRunningSection renderProbe={rowRenderProbe} surface={running} />
          )}
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
        </AgentElapsedTickerContext.Provider>
      </div>
      {model.working + model.idle + model.settled > 0 && <AgentsPanelFooter model={model} />}
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
