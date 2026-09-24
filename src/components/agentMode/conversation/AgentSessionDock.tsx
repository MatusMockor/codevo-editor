import { ChevronRight, Clock3 } from "lucide-react";
import type { ReactNode } from "react";
import { ComposerBanner } from "../../../ui/foundation/ComposerBanner";
import { AgentJumpToLatest } from "../AgentJumpToLatest";
import type { AgentAgentsBannerModel } from "./agentAgentsBannerPresentation";

export interface AgentSessionDockFollow {
  readonly atLatest: boolean;
  readonly unseenActivity: boolean;
  jumpToLatest(): void;
}

export interface AgentSessionDockProps {
  readonly follow: AgentSessionDockFollow;
  readonly queuedCount: number;
  readonly agents: AgentAgentsBannerModel | null;
  readonly background: ReactNode;
  onRevealQueue(): void;
  onOpenAgents(): void;
}

export function AgentSessionDock({
  agents,
  background,
  follow,
  onOpenAgents,
  onRevealQueue,
  queuedCount,
}: AgentSessionDockProps) {
  const banners = agents !== null || background !== null;
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
      {banners && (
        <div className="cv-session-dock__banners">
          {agents !== null && (
            <ComposerBanner
              actions={
                <button
                  aria-label="View agents"
                  className="cv-banner-action"
                  onClick={onOpenAgents}
                  type="button"
                >
                  View
                  <ChevronRight aria-hidden="true" size={12} />
                </button>
              }
              announce={false}
              tone="working"
            >
              <span className="cv-banner-line">
                <span className="cv-banner-strong">{agents.label}</span>
                <span className="cv-banner-detail">{agents.names}</span>
              </span>
            </ComposerBanner>
          )}
          {background}
        </div>
      )}
    </div>
  );
}
