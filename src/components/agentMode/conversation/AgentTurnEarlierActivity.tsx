import {
  agentTurnActivityWindowOf,
  type AgentTurnEarlierActivityState,
} from "../../../application/useAgentHistoryActivity";
import type { AgentTurnActivityWindow } from "../../../domain/agentTurnActivityWindow";
import { AGENT_TURN_REMOTE_DISCARDED_NOTICE, agentTurnLogLossNotice } from "../agentTurnLogNotice";

export const AGENT_ACTIVITY_GAP_NOTICE = "Some activity is missing from the saved history.";
export const AGENT_ACTIVITY_CLIPPED_NOTICE = "Some saved activity was shortened for display.";

export interface AgentTurnEarlierControlProps {
  readonly state: AgentTurnEarlierActivityState;
  readonly logAvailable: boolean;
  readonly canRevealMemory: boolean;
  readonly hiddenCount: number;
  onRevealMemory(from: HTMLElement): void;
  onLoadEarlier(from: HTMLElement): void;
}

export function AgentTurnEarlierControl({
  canRevealMemory,
  hiddenCount,
  logAvailable,
  onLoadEarlier,
  onRevealMemory,
  state,
}: AgentTurnEarlierControlProps) {
  const window = agentTurnActivityWindowOf(state);
  const loading = state.kind === "loading" && state.direction === "earlier";
  const failed = state.kind === "failed" && state.direction === "earlier";
  const fromLog = window !== null || !canRevealMemory;
  const offered = window === null ? canRevealMemory || logAvailable : window.hasEarlier;
  const notice = windowNotice(window);
  const unreachable = window === null && !canRevealMemory && !logAvailable && hiddenCount > 0;
  if (!offered && !failed && notice === null && !unreachable) return null;
  return (
    <div className="cv-earlier">
      {offered && (
        <button
          className="cv-load-earlier"
          disabled={loading}
          onClick={(event) => {
            if (fromLog) {
              onLoadEarlier(event.currentTarget);
              return;
            }
            onRevealMemory(event.currentTarget);
          }}
          type="button"
        >
          {loading ? "Loading earlier activity…" : "Load earlier activity"}
        </button>
      )}
      {failed && (
        <p className="agent-note agent-note--warning" role="alert">
          Could not load earlier activity.{" "}
          <button
            className="cv-banner-action"
            onClick={(event) => onLoadEarlier(event.currentTarget)}
            type="button"
          >
            Retry
          </button>
        </p>
      )}
      {notice !== null && <p className="agent-note agent-note--warning">{notice}</p>}
      {unreachable && (
        <p className="agent-note">
          {hiddenCount} earlier {hiddenCount === 1 ? "event is" : "events are"} not shown.
        </p>
      )}
    </div>
  );
}

export interface AgentTurnLaterControlProps {
  readonly state: AgentTurnEarlierActivityState;
  readonly running: boolean;
  onLoadLater(): void;
  onLatest(from: HTMLElement): void;
}

export function AgentTurnLaterControl({
  onLatest,
  onLoadLater,
  running,
  state,
}: AgentTurnLaterControlProps) {
  const window = agentTurnActivityWindowOf(state);
  if (window === null) return null;
  const loading = state.kind === "loading" && state.direction === "later";
  const failed = state.kind === "failed" && state.direction === "later";
  return (
    <div className="cv-earlier cv-earlier--later">
      {window.hasLater && (
        <button className="cv-load-earlier" disabled={loading} onClick={onLoadLater} type="button">
          {loading ? "Loading later activity…" : "Show later activity"}
        </button>
      )}
      {failed && (
        <p className="agent-note agent-note--warning" role="alert">
          Could not load later activity.
        </p>
      )}
      {(window.hasLater || running) && (
        <button
          className="cv-load-earlier"
          onClick={(event) => onLatest(event.currentTarget)}
          type="button"
        >
          Show latest activity
        </button>
      )}
    </div>
  );
}

function windowNotice(window: AgentTurnActivityWindow | null): string | null {
  if (window === null) return null;
  if (window.loss.kind !== "none")
    return agentTurnLogLossNotice(window.loss) ?? AGENT_ACTIVITY_GAP_NOTICE;
  if (window.earlierDiscarded === true) return AGENT_TURN_REMOTE_DISCARDED_NOTICE;
  if (window.gap) return AGENT_ACTIVITY_GAP_NOTICE;
  if (window.clipped) return AGENT_ACTIVITY_CLIPPED_NOTICE;
  return null;
}
