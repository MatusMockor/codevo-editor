import { memo } from "react";
import type { ExternalAgentSessionHistory } from "../../domain/externalAgentSession";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { AgentMessageCopyButton } from "./AgentMessageCopyButton";
import "./agentImportedHistory.css";

export type AgentExternalHistoryState = "loading" | "failed" | "unavailable" | "ready";

export const AgentImportedHistory = memo(function AgentImportedHistory({
  history,
  onRetry,
  state,
  textClipboard,
}: {
  readonly history: ExternalAgentSessionHistory | undefined;
  readonly onRetry?: () => void;
  readonly state?: AgentExternalHistoryState;
  readonly textClipboard: TextClipboardGateway | null;
}) {
  if (history === undefined) {
    const loading = state === "loading";
    const message = loading
      ? "Loading original conversation…"
      : state === "failed"
        ? "Could not load the original conversation."
        : "Original conversation history is unavailable.";
    return (
      <div className="agent-imported-history__status" role="status">
        <p className="agent-note">{message}</p>
        {!loading && onRetry !== undefined && (
          <button className="agent-imported-history__retry" onClick={onRetry} type="button">
            Retry loading history
          </button>
        )}
      </div>
    );
  }

  return (
    <section aria-label="Original conversation" className="agent-imported-history">
      {history.exchangesTruncated && (
        <p className="agent-note agent-note--warning">
          Only part of the original conversation is available. Some messages or message text were
          omitted.
        </p>
      )}
      {history.exchanges.length === 0 && (
        <p className="agent-note">No user or assistant messages were found in this session.</p>
      )}
      {history.exchanges.map((exchange, index) =>
        exchange.role === "user" ? (
          <article aria-label="Imported user message" className="agent-prompt" key={index}>
            <div className="agent-prompt__body">{exchange.text}</div>
            <div className="agent-prompt__meta">
              <AgentMessageCopyButton
                clipboard={textClipboard}
                label="your message"
                text={exchange.text}
              />
            </div>
          </article>
        ) : (
          <article aria-label="Imported AI response" className="agent-text" key={index}>
            <p className="agent-text__paragraph">{exchange.text}</p>
            <div className="agent-message-actions">
              <AgentMessageCopyButton
                clipboard={textClipboard}
                label="AI response"
                text={exchange.text}
              />
            </div>
          </article>
        ),
      )}
    </section>
  );
});
