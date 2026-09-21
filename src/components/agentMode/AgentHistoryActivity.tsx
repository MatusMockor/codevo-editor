import "./agentHistory.css";
import { useMemo, type ReactNode } from "react";
import {
  useAgentHistoryActivity,
  type AgentHistoryActivitySource,
} from "../../application/useAgentHistoryActivity";
import type { AgentTurn } from "../../domain/agentThread";
import { MAX_RENDERED_EVENTS_PER_TURN } from "./agentTurnProjection";

export interface AgentHistoryWork {
  readonly turn: AgentTurn | null;
  readonly available: boolean;
  readonly controls: ReactNode;
  open(): void;
}

export function AgentHistoryActivity({
  turn,
  source,
  children,
}: {
  readonly turn: AgentTurn;
  readonly source: AgentHistoryActivitySource | null;
  readonly children: (activity: AgentHistoryWork) => ReactNode;
}) {
  const ownedSource =
    source?.scope.turnId === turn.turnId &&
    (turn.eventsTruncated ||
      (turn.firstEventOffset ?? 0) > 0 ||
      turn.events.length > MAX_RENDERED_EVENTS_PER_TURN)
      ? source
      : null;
  const { state, read, latest } = useAgentHistoryActivity(ownedSource);
  const available = ownedSource !== null;
  const work = useMemo(() => {
    const page = state.kind === "latest" ? null : state.page;
    const projected =
      page === null
        ? null
        : {
            ...turn,
            events: page.entries.map((entry) => entry.event),
            firstEventOffset: Math.max(0, page.firstSeq - 1),
            eventsTruncated: false,
          };
    const loading = state.kind === "loading";
    const controls =
      available && state.kind !== "latest" ? (
        <nav aria-label="Saved turn activity" className="agent-history-pager">
          <>
            <p className="agent-note">Viewing a page of saved activity.</p>
            {page?.hasEarlier && (
              <button
                type="button"
                disabled={loading}
                onClick={() => void read({ at: "before", seq: page.firstSeq })}
              >
                Earlier activity
              </button>
            )}
            {page?.hasLater && (
              <button
                type="button"
                disabled={loading}
                onClick={() => void read({ at: "after", seq: page.lastSeq })}
              >
                Newer activity
              </button>
            )}
            <button type="button" onClick={latest}>
              Back to latest activity
            </button>
          </>
          {loading && <p role="status">Loading saved activity…</p>}
          {state.kind === "failed" && (
            <>
              <p role="alert">Could not load saved activity.</p>
              <button type="button" onClick={() => void read(state.anchor)}>
                Retry saved activity
              </button>
            </>
          )}
          {page !== null && page.entries.length === 0 && (
            <p className="agent-note">No saved activity.</p>
          )}
          {page !== null && page.loss.kind !== "none" && (
            <p className="agent-note agent-note--warning">
              Some activity is missing from the saved history.
            </p>
          )}
          {page?.clipped && (
            <p className="agent-note">This saved activity page reached its display limit.</p>
          )}
        </nav>
      ) : null;
    return {
      turn: projected,
      available,
      controls,
      open: () => {
        if (state.kind === "latest") void read({ at: "tail" });
      },
    };
  }, [available, state, turn, read, latest]);
  return children(work);
}
