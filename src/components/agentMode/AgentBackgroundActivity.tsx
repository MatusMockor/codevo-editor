import { Activity, Radar } from "lucide-react";
import { memo } from "react";
import type { AgentBackgroundIndicator } from "./agentBackgroundIndicatorPresentation";
import { AgentLiveRow } from "./conversation/AgentLiveRow";

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
      <AgentLiveRow
        activateLabel={`${indicator.label}. Open Agents panel`}
        label={indicator.label}
        onActivate={onOpenAgents}
        tone="agents"
      />
    );
  }
  const Icon = indicator.monitoring ? Radar : Activity;
  return (
    <details className="agent-background-activity cv-work-disclosure">
      <summary className="cv-work-row">
        <span aria-hidden="true" className="cv-work-row__icon">
          <Icon size={14} aria-hidden="true" />
        </span>
        <span className="cv-work-row__label" role="status" aria-live="polite">
          {indicator.label}
        </span>
        {indicator.count !== null && (
          <span className="agent-background-activity__count cv-work-row__meta">
            {indicator.count}
          </span>
        )}
      </summary>
      <ul className="agent-background-activity__tasks">
        {indicator.tasks.map((task) => (
          <li key={task.taskId}>{task.description || "Background task"}</li>
        ))}
      </ul>
      {indicator.truncated && <p>Some background tasks are not shown.</p>}
    </details>
  );
});
