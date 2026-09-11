import { memo, useMemo } from "react";
import type { AgentCliKind } from "../../domain/agentTask";
import type {
  ExternalAgentSessionHistory,
  ExternalSessionExchange,
} from "../../domain/externalAgentSession";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { AgentAssistantText, type AgentProseContext } from "./AgentAssistantText";
import { AgentTurnHead, AgentTurnPrompt } from "./AgentTurnParts";
import type { AgentTurnAttachmentImageViewer } from "./AgentTurnAttachments";
import { agentThreadColumnKey } from "./agentThreadColumn";
import { AGENT_TURN_UNTIMED } from "./agentTurnHeadPresentation";
import {
  agentImportedTurns,
  type AgentImportedHighlight,
  type AgentImportedTurn,
} from "./agentImportedPresentation";
import "./agentImportedHistory.css";

export type AgentExternalHistoryState = "loading" | "failed" | "unavailable" | "ready";

const NO_HIGHLIGHTS: ReadonlyMap<number, AgentImportedHighlight> = new Map();
const NO_EXCHANGES: ReadonlyArray<ExternalSessionExchange> = [];

export const AgentImportedHistory = memo(function AgentImportedHistory({
  attachmentImages = null,
  highlights = NO_HIGHLIGHTS,
  history,
  onRetry,
  prose,
  state,
  textClipboard,
}: {
  readonly attachmentImages?: AgentTurnAttachmentImageViewer | null;
  readonly highlights?: ReadonlyMap<number, AgentImportedHighlight>;
  readonly history: ExternalAgentSessionHistory | undefined;
  readonly onRetry?: () => void;
  readonly prose: AgentProseContext;
  readonly state?: AgentExternalHistoryState;
  readonly textClipboard: TextClipboardGateway | null;
}) {
  const exchanges = history?.exchanges ?? NO_EXCHANGES;
  const turns = useMemo(() => agentImportedTurns(exchanges), [exchanges]);

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
      {turns.map((turn) => (
        <AgentImportedTurnView
          attachmentImages={attachmentImages}
          highlights={highlights}
          key={turn.key}
          prose={prose}
          provider={history.provider}
          textClipboard={textClipboard}
          turn={turn}
        />
      ))}
    </section>
  );
});

const AgentImportedTurnView = memo(function AgentImportedTurnView({
  attachmentImages,
  highlights,
  prose,
  provider,
  textClipboard,
  turn,
}: {
  readonly attachmentImages: AgentTurnAttachmentImageViewer | null;
  readonly highlights: ReadonlyMap<number, AgentImportedHighlight>;
  readonly prose: AgentProseContext;
  readonly provider: AgentCliKind;
  readonly textClipboard: TextClipboardGateway | null;
  readonly turn: AgentImportedTurn;
}) {
  const prompt = turn.prompt;
  const promptHighlight = prompt === null ? undefined : highlights.get(prompt.exchangeIndex);

  return (
    <article
      aria-label="Imported exchange"
      className="agent-turn"
      data-agent-column={agentThreadColumnKey({
        scope: "imported",
        exchangeIndex: turn.headExchangeIndex,
      })}
    >
      {prompt !== null && (
        <AgentTurnPrompt
          attachmentImages={attachmentImages}
          attachments={prompt.attachments}
          current={promptHighlight?.current ?? null}
          prompt={prompt.text}
          query={promptHighlight?.query ?? ""}
          textClipboard={textClipboard}
        />
      )}
      <div className="agent-answer">
        <AgentTurnHead provider={provider} startedAtEpochMs={null} timing={AGENT_TURN_UNTIMED} />
        <div className="agent-turn__events">
          {turn.responses.map((response) => {
            const highlight = highlights.get(response.exchangeIndex);
            return (
              <AgentAssistantText
                current={highlight?.current ?? null}
                eventKey={`x${response.exchangeIndex}`}
                key={response.exchangeIndex}
                label="Imported AI response"
                prose={prose}
                query={highlight?.query ?? ""}
                stream="settled"
                text={response.text}
                textClipboard={textClipboard}
              />
            );
          })}
        </div>
      </div>
    </article>
  );
});
