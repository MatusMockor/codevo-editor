import "./agentHistory.css";
import type { ReactNode } from "react";
import {
  useAgentHistoryActivity,
  type AgentHistoryActivitySource,
} from "../../application/useAgentHistoryActivity";
import type { AgentTurn } from "../../domain/agentThread";

export function AgentHistoryActivity({
  turn,
  source,
  children,
}: {
  readonly turn: AgentTurn;
  readonly source: AgentHistoryActivitySource | null;
  readonly children: (turn: AgentTurn, viewingSavedActivity: boolean) => ReactNode;
}) {
  const ownedSource = source?.scope.turnId === turn.turnId ? source : null;
  const activity = useAgentHistoryActivity(ownedSource);
  const { state } = activity;
  const page = state.kind === "latest" ? null : state.page;
  const projected =
    page === null
      ? turn
      : {
          ...turn,
          events: page.entries.map((entry) => entry.event),
          firstEventOffset: Math.max(0, page.firstSeq - 1),
          eventsTruncated: false,
        };
  const loading = state.kind === "loading";
  return (
    <>
      {ownedSource !== null && (
        <nav aria-label="Saved turn activity" className="agent-history-pager">
          {state.kind === "latest" ? (
            <button type="button" onClick={() => void activity.read({ at: "tail" })}>
              Saved activity
            </button>
          ) : (
            <>
              <p className="agent-note">Viewing a page of saved activity.</p>
              {page?.hasEarlier && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void activity.read({ at: "before", seq: page.firstSeq })}
                >
                  Earlier activity
                </button>
              )}
              {page?.hasLater && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void activity.read({ at: "after", seq: page.lastSeq })}
                >
                  Newer activity
                </button>
              )}
              <button type="button" onClick={activity.latest}>
                Back to latest activity
              </button>
            </>
          )}
          {loading && <p role="status">Loading saved activity…</p>}
          {state.kind === "failed" && (
            <>
              <p role="alert">Could not load saved activity.</p>
              <button type="button" onClick={() => void activity.read(state.anchor)}>
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
      )}
      {children(projected, page !== null)}
    </>
  );
}
