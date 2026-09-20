import "./agentHistory.css";
import type { AgentThreadHistoryPageView } from "../../application/useAgentThreadHistory";

export function AgentHistoryPager({
  page,
  hasEarlier,
  onEarlier,
  onLatest,
  onNewer,
}: {
  readonly page: AgentThreadHistoryPageView | null;
  readonly hasEarlier: boolean;
  readonly onEarlier: () => void;
  readonly onLatest: () => void;
  readonly onNewer?: () => void;
}) {
  if (page === null && !hasEarlier) return null;
  return (
    <nav aria-label="Conversation history" className="agent-history-pager">
      {page !== null && (
        <p className="agent-note">
          Viewing saved earlier turns. New messages continue in the latest conversation.
        </p>
      )}
      {(page?.hasEarlier ?? hasEarlier) && (
        <button type="button" disabled={page?.loading} onClick={onEarlier}>
          {page?.loading ? "Loading earlier turns…" : "Earlier turns"}
        </button>
      )}
      {page !== null && onNewer !== undefined && (
        <button type="button" disabled={page.loading} onClick={onNewer}>
          Newer turns
        </button>
      )}
      {page !== null && (
        <button type="button" onClick={onLatest}>
          Back to latest
        </button>
      )}
      {page?.error != null && (
        <p role="alert" className="agent-note agent-note--warning">
          {page.error}
        </p>
      )}
      {page !== null && !page.loading && page.error === null && page.turns.length === 0 && (
        <p className="agent-note">No earlier saved turns.</p>
      )}
    </nav>
  );
}
