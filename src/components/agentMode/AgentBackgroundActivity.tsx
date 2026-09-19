import { Activity, Bot, ChevronRight, Radar } from "lucide-react";
import { memo } from "react";
import type { AgentBackgroundIndicator } from "./agentBackgroundIndicatorPresentation";
import "./agentSubagents.css";

export const AgentBackgroundActivity = memo(function AgentBackgroundActivity({
  indicator,
  onOpenAgents,
}: {
  readonly indicator: AgentBackgroundIndicator;
  readonly onOpenAgents?: () => void;
}) {
  if (indicator.kind === "hidden") return null;
  if (indicator.kind === "agents") {
    return (
      <div className="agent-background-row">
        <button
          aria-label={`${indicator.label}. Open Agents panel`}
          className="agent-background-row__action"
          disabled={onOpenAgents === undefined}
          onClick={onOpenAgents}
          type="button"
        >
          <Bot aria-hidden="true" className="agent-background-row__icon" size={14} />
          <span className="agent-background-row__label">{indicator.label}</span>
          {indicator.latest !== null && (
            <span className="agent-background-row__latest">{indicator.latest}</span>
          )}
          <ChevronRight aria-hidden="true" className="agent-background-row__chevron" size={13} />
        </button>
      </div>
    );
  }
  const Icon = indicator.monitoring ? Radar : Activity;
  return (
    <details className="agent-background-activity">
      <summary>
        <Icon size={14} aria-hidden="true" />
        <span role="status" aria-live="polite">
          {indicator.label}
        </span>
        {indicator.count !== null && (
          <span className="agent-background-activity__count">{indicator.count}</span>
        )}
      </summary>
      <ul>
        {indicator.tasks.map((task) => (
          <li key={task.taskId}>{task.description || "Background task"}</li>
        ))}
      </ul>
      {indicator.truncated && <p>Some background tasks are not shown.</p>}
    </details>
  );
});
