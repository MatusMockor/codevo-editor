import { ChevronRight, Clock3 } from "lucide-react";
import { ComposerBanner } from "../../../ui/foundation/ComposerBanner";
import { AgentJumpToLatest } from "../AgentJumpToLatest";
import type { AgentSessionActivityBar } from "./agentSessionActivityBar";
import type { AgentSessionEndOffer } from "./agentSessionTaskControls";

export interface AgentSessionDockFollow {
  readonly atLatest: boolean;
  readonly unseenActivity: boolean;
  jumpToLatest(): void;
}

export interface AgentSessionDockProps {
  readonly follow: AgentSessionDockFollow;
  readonly queuedCount: number;
  readonly activity: AgentSessionActivityBar | null;
  readonly endSession?: AgentSessionEndOffer;
  onRevealQueue(): void;
  onOpenAgents(): void;
  onStop?(): void;
  onEndSession?(): void;
}

export function AgentSessionDock({
  activity,
  endSession = "hidden",
  follow,
  onEndSession,
  onOpenAgents,
  onRevealQueue,
  onStop,
  queuedCount,
}: AgentSessionDockProps) {
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
            endSession={endSession}
            onEndSession={onEndSession}
            onOpenAgents={onOpenAgents}
            onStop={onStop}
          />
        </div>
      )}
    </div>
  );
}

function AgentSessionActivityBanner({
  activity,
  endSession,
  onEndSession,
  onOpenAgents,
  onStop,
}: {
  readonly activity: AgentSessionActivityBar;
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
                aria-label={activity.viewLabel}
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
      </span>
    </ComposerBanner>
  );
}
