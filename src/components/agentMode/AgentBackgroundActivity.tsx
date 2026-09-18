import { Activity, Radar } from "lucide-react";
import type { projectAgentBackgroundActivity } from "../../domain/agentBackgroundActivity";

export function AgentBackgroundActivity({
  activity,
}: {
  readonly activity: ReturnType<typeof projectAgentBackgroundActivity>;
}) {
  if (activity.phase === "inactive" || !activity.foregroundSettled) return null;
  const monitoring = activity.phase === "monitoring";
  const Icon = monitoring ? Radar : Activity;
  const label = monitoring ? "Monitoring" : "Working in background";
  return (
    <details className="agent-background-activity">
      <summary>
        <Icon size={14} aria-hidden="true" />
        <span role="status" aria-live="polite">
          {label}
        </span>
        {activity.tasks.length > 0 && (
          <span className="agent-background-activity__count">
            {activity.tasks.length} {activity.tasks.length === 1 ? "task" : "tasks"}
          </span>
        )}
      </summary>
      <ul>
        {activity.tasks.map((task) => (
          <li key={task.taskId}>{task.description || "Background task"}</li>
        ))}
      </ul>
      {activity.truncated && <p>Some background tasks are not shown.</p>}
    </details>
  );
}
