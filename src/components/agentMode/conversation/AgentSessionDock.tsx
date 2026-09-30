import { ChevronRight, Clock3 } from "lucide-react";
import type { ReactNode } from "react";
import { ComposerBanner } from "../../../ui/foundation/ComposerBanner";
import { AgentJumpToLatest } from "../AgentJumpToLatest";
import type { AgentSessionActivityBar } from "./agentSessionActivityBar";
import type { AgentSessionEndOffer, AgentSessionTaskControls } from "./agentSessionTaskControls";

export interface AgentSessionDockFollow {
  readonly atLatest: boolean;
  readonly unseenActivity: boolean;
  jumpToLatest(): void;
}

export interface AgentSessionDockProps {
  readonly follow: AgentSessionDockFollow;
  readonly queuedCount: number;
  readonly activity: AgentSessionActivityBar | null;
  readonly sessionTasks?: AgentSessionTaskControls | null;
  onRevealQueue(): void;
  onOpenAgents(): void;
  onStop?(): void;
  onStopSessionTask?(taskId: string): void;
  onEndSession?(): void;
}

export function AgentSessionDock({
  activity,
  follow,
  onEndSession,
  onOpenAgents,
  onRevealQueue,
  onStop,
  onStopSessionTask,
  queuedCount,
  sessionTasks = null,
}: AgentSessionDockProps) {
  const tasks = onStopSessionTask === undefined ? null : sessionTasks;
  return (
    <div className="cv-session-dock cv-conversation-column">
      <AgentJumpToLatest
        onJump={follow.jumpToLatest}
        unseenActivity={follow.unseenActivity}
        visible={!follow.atLatest}
      />
      {queuedCount > 0 && (
        <div className="agent-session__queue-summary">
          <button
            aria-label={`Show ${queuedCount} queued ${queuedCount === 1 ? "message" : "messages"}`}
            className="agent-prompt__queue-action agent-session__queue-count"
            onClick={onRevealQueue}
            title="Show pending messages, including paused messages"
            type="button"
          >
            <Clock3 aria-hidden="true" size={12} />
            {queuedCount} queued
          </button>
        </div>
      )}
      {activity !== null && (
        <div className="cv-session-dock__banners">
          <AgentSessionActivityBanner
            activity={activity}
            endSession={tasks?.endSession ?? "hidden"}
            onEndSession={onEndSession}
            onOpenAgents={onOpenAgents}
            onStop={onStop}
          >
            {tasks !== null && onStopSessionTask !== undefined && (
              <AgentSessionTaskList onStopTask={onStopSessionTask} tasks={tasks} />
            )}
          </AgentSessionActivityBanner>
        </div>
      )}
    </div>
  );
}

function AgentSessionActivityBanner({
  activity,
  children,
  endSession,
  onEndSession,
  onOpenAgents,
  onStop,
}: {
  readonly activity: AgentSessionActivityBar;
  readonly children: ReactNode;
  readonly endSession: AgentSessionEndOffer;
  onEndSession: (() => void) | undefined;
  onOpenAgents(): void;
  onStop?(): void;
}) {
  const view = activity.actions.includes("view");
  const stop = activity.actions.includes("stop") && onStop !== undefined;
  const end = endSession !== "hidden" && onEndSession !== undefined;
  return (
    <ComposerBanner
      actions={
        view || stop || end ? (
          <>
            {view && (
              <button
                aria-label="View agents"
                className="cv-banner-action"
                onClick={onOpenAgents}
                type="button"
              >
                View
                <ChevronRight aria-hidden="true" size={12} />
              </button>
            )}
            {stop && (
              <button
                aria-label="Stop agent and background work"
                className="cv-banner-action"
                onClick={onStop}
                type="button"
              >
                Stop
              </button>
            )}
            {end && (
              <button
                aria-label="End Claude session"
                className={
                  endSession === "suggested"
                    ? "cv-banner-action cv-banner-action--emphasis"
                    : "cv-banner-action"
                }
                onClick={onEndSession}
                type="button"
              >
                End session
              </button>
            )}
          </>
        ) : undefined
      }
      announce={activity.announce}
      tone="working"
    >
      <span className="cv-banner-line">
        <span className="cv-banner-strong">{activity.label}</span>
        {activity.names !== "" && <span className="cv-banner-detail">{activity.names}</span>}
      </span>
      {children}
    </ComposerBanner>
  );
}

function AgentSessionTaskList({
  onStopTask,
  tasks,
}: {
  readonly tasks: AgentSessionTaskControls;
  onStopTask(taskId: string): void;
}) {
  return (
    <span className="cv-session-tasks" role="list">
      {tasks.rows.map((row) => (
        <span className="cv-session-task" key={row.taskId} role="listitem">
          <span className="cv-session-task__label" title={row.label}>
            {row.label}
          </span>
          <button
            aria-label={row.stopLabel}
            className="cv-banner-action"
            disabled={row.pending}
            onClick={() => onStopTask(row.taskId)}
            type="button"
          >
            {row.pending ? "Stopping…" : "Stop"}
          </button>
        </span>
      ))}
      {tasks.hiddenCount > 0 && (
        <span className="cv-session-task cv-session-task--more" role="listitem">
          +{tasks.hiddenCount} more
        </span>
      )}
    </span>
  );
}
