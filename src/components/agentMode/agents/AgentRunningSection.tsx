import { Square } from "lucide-react";
import { memo, useContext, useEffect, useId, useRef } from "react";
import type { AgentRuntimeSubagent } from "../../../domain/agentRuntimeSubagent";
import { RoleTag } from "../../../ui/foundation/RoleTag";
import { AgentsPanelRow } from "../AgentAgentsPanelRow";
import { AgentElapsedTickerContext } from "../agentElapsedTickerContext";
import type { AgentRunningWorkSurface } from "./agentAgentsPanelHooks";
import {
  agentRunningStopReasonText,
  type AgentRunningRow,
  type AgentRunningStop,
  type AgentRunningStopReason,
} from "./agentRunningWork";

type StopKind = "stoppable" | "stopping" | null;

interface RowStopProps {
  readonly stopKind: StopKind;
  readonly stopTaskId: string | null;
  readonly describedBy: string | undefined;
  onStop(taskId: string): void;
}

export function AgentRunningSection({
  renderProbe,
  surface,
}: {
  readonly surface: AgentRunningWorkSurface;
  readonly renderProbe?: (id: string) => void;
}) {
  const reasonBase = useId();
  const { stopTask, work } = surface;
  if (work.rows.length === 0 && work.unlisted === 0) return null;
  const exact = !work.agentsLowerBound && !work.tasksUnknown;
  const reasons = unavailableReasons(work.rows);
  const reasonId = (reason: AgentRunningStopReason) => `${reasonBase}-${reason}`;
  const stopProps = (stop: AgentRunningStop): RowStopProps => ({
    stopKind: stop.kind === "unavailable" ? null : stop.kind,
    stopTaskId: stop.kind === "unavailable" ? null : stop.taskId,
    describedBy: stop.kind === "unavailable" ? reasonId(stop.reason) : undefined,
    onStop: stopTask,
  });
  return (
    <section className="cv-agents__section" data-section="running">
      <h3 className="cv-agents__label">
        {exact ? `Running · ${work.agents + work.tasks}` : "Running"}
      </h3>
      <ul aria-label="Running" className="cv-agents__list">
        {work.rows.map((row) =>
          row.kind === "subagent" ? (
            <AgentRunningSubagent
              agent={row.agent}
              key={row.key}
              renderProbe={renderProbe}
              rowKey={row.key}
              {...stopProps(row.stop)}
            />
          ) : (
            <AgentRunningTask
              key={row.key}
              renderProbe={renderProbe}
              rowKey={row.key}
              since={row.elapsed.kind === "since" ? row.elapsed.sinceEpochMs : null}
              taskId={row.taskId}
              title={row.title}
              typeLabel={row.typeLabel}
              {...stopProps(row.stop)}
            />
          ),
        )}
      </ul>
      {work.unlisted > 0 && (
        <p className="cv-agents__running-more">{`+${work.unlisted} more running, not listed here`}</p>
      )}
      {reasons.map((reason) => (
        <p className="cv-agents__running-note" id={reasonId(reason)} key={reason}>
          {agentRunningStopReasonText(reason)}
        </p>
      ))}
    </section>
  );
}

const AgentRunningSubagent = memo(function AgentRunningSubagent({
  agent,
  describedBy,
  onStop,
  renderProbe,
  rowKey,
  stopKind,
  stopTaskId,
}: RowStopProps & {
  readonly agent: AgentRuntimeSubagent;
  readonly rowKey: string;
  readonly renderProbe?: (id: string) => void;
}) {
  return (
    <AgentsPanelRow
      action={
        stopKind === null ? undefined : (
          <AgentRunningStopButton
            label={`Stop agent "${agent.title}"`}
            name={agent.title}
            onStop={onStop}
            stopKind={stopKind}
            stopTaskId={stopTaskId}
          />
        )
      }
      agent={agent}
      describedBy={describedBy}
      renderProbe={renderProbe}
      stopping={stopKind === "stopping"}
      tickerKey={rowKey}
    />
  );
});

const AgentRunningTask = memo(function AgentRunningTask({
  describedBy,
  onStop,
  renderProbe,
  rowKey,
  since,
  stopKind,
  stopTaskId,
  taskId,
  title,
  typeLabel,
}: RowStopProps & {
  readonly rowKey: string;
  readonly taskId: string;
  readonly title: string;
  readonly typeLabel: string;
  readonly since: number | null;
  readonly renderProbe?: (id: string) => void;
}) {
  renderProbe?.(taskId);
  const ticker = useContext(AgentElapsedTickerContext);
  const clockRef = useRef<HTMLSpanElement | null>(null);
  const stopping = stopKind === "stopping";

  useEffect(() => {
    const clock = clockRef.current;
    if (ticker === null || clock === null || since === null) return;
    return ticker.registerSince(rowKey, since, { clock, stale: null, description: null });
  }, [rowKey, since, ticker]);

  return (
    <li aria-describedby={describedBy} className="cv-agents-item">
      <div
        className="cv-agents-row"
        data-action={stopKind === null ? undefined : "stop"}
        data-status={stopping ? "stopping" : "working"}
      >
        <span aria-hidden="true" className="cv-agents-row__dot" />
        <span className="cv-agents-row__title">
          <span className="cv-agents-row__name">{title}</span>
          <RoleTag>{typeLabel}</RoleTag>
        </span>
        <span className="cv-agents-row__elapsed">{since !== null && <span ref={clockRef} />}</span>
        <span className="cv-agents-row__activity">
          <span className="cv-agents-row__activity-text">
            {stopping ? "Stopping…" : "Running in background"}
          </span>
        </span>
        <AgentRunningStopButton
          label={`Stop background task "${title}"`}
          name={title}
          onStop={onStop}
          stopKind={stopKind}
          stopTaskId={stopTaskId}
        />
      </div>
    </li>
  );
});

function AgentRunningStopButton({
  label,
  name,
  onStop,
  stopKind,
  stopTaskId,
}: {
  readonly label: string;
  readonly name: string;
  readonly stopKind: StopKind;
  readonly stopTaskId: string | null;
  onStop(taskId: string): void;
}) {
  if (stopKind === null || stopTaskId === null) return null;
  if (stopKind === "stopping")
    return (
      <button
        aria-disabled="true"
        aria-label={`Stopping "${name}"`}
        className="cv-agents-row__stop"
        type="button"
      >
        Stopping…
      </button>
    );
  return (
    <button
      aria-label={label}
      className="cv-agents-row__stop"
      onClick={() => onStop(stopTaskId)}
      type="button"
    >
      <Square
        aria-hidden="true"
        className="cv-agents-row__stop-glyph"
        fill="currentColor"
        size={10}
      />
      Stop
    </button>
  );
}

function unavailableReasons(
  rows: ReadonlyArray<AgentRunningRow>,
): ReadonlyArray<AgentRunningStopReason> {
  const reasons = new Set<AgentRunningStopReason>();
  for (const row of rows) {
    if (row.stop.kind === "unavailable") reasons.add(row.stop.reason);
  }
  return [...reasons];
}
