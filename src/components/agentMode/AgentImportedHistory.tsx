import { memo, useCallback, useMemo, useRef } from "react";
import type { AgentBandPinObserver } from "../../application/agentBandPin";
import type {
  ExternalAgentSessionHistory,
  ExternalSessionExchange,
} from "../../domain/externalAgentSession";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { AgentAssistantText, type AgentProseContext } from "./AgentAssistantText";
import { AgentTurnBand } from "./AgentTurnBand";
import {
  agentImportedTurns,
  agentLedgerImportedOrdinal,
  type AgentImportedHighlight,
  type AgentImportedTurn,
  type AgentLedgerOrdinals,
} from "./agentLedgerPresentation";
import "./agentImportedHistory.css";

export type AgentExternalHistoryState = "loading" | "failed" | "unavailable" | "ready";

const NO_HIGHLIGHTS: ReadonlyMap<number, AgentImportedHighlight> = new Map();
const NO_EXCHANGES: ReadonlyArray<ExternalSessionExchange> = [];

export const AgentImportedHistory = memo(function AgentImportedHistory({
  bandPin = null,
  highlights = NO_HIGHLIGHTS,
  history,
  onRetry,
  ordinals,
  prose,
  state,
  textClipboard,
}: {
  readonly bandPin?: AgentBandPinObserver | null;
  readonly highlights?: ReadonlyMap<number, AgentImportedHighlight>;
  readonly history: ExternalAgentSessionHistory | undefined;
  readonly onRetry?: () => void;
  readonly ordinals: AgentLedgerOrdinals;
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
          bandPin={bandPin}
          highlights={highlights}
          key={turn.key}
          ordinals={ordinals}
          prose={prose}
          textClipboard={textClipboard}
          turn={turn}
        />
      ))}
    </section>
  );
});

const AgentImportedTurnView = memo(function AgentImportedTurnView({
  bandPin,
  highlights,
  ordinals,
  prose,
  textClipboard,
  turn,
}: {
  readonly bandPin: AgentBandPinObserver | null;
  readonly highlights: ReadonlyMap<number, AgentImportedHighlight>;
  readonly ordinals: AgentLedgerOrdinals;
  readonly prose: AgentProseContext;
  readonly textClipboard: TextClipboardGateway | null;
  readonly turn: AgentImportedTurn;
}) {
  const answerEnd = useRef<HTMLDivElement | null>(null);
  const jumpToAnswerEnd = useCallback(() => {
    answerEnd.current?.scrollIntoView?.({ block: "end" });
  }, []);
  const prompt = turn.prompt;
  const promptHighlight = prompt === null ? undefined : highlights.get(prompt.exchangeIndex);

  return (
    <article aria-label="Imported exchange" className="agent-turn">
      {prompt !== null && (
        <AgentTurnBand
          bandPin={bandPin}
          current={promptHighlight?.current ?? null}
          onJumpToAnswerEnd={jumpToAnswerEnd}
          ordinal={agentLedgerImportedOrdinal(ordinals, prompt.promptIndex)}
          prompt={prompt.text}
          query={promptHighlight?.query ?? ""}
          startedAtEpochMs={null}
          textClipboard={textClipboard}
        />
      )}
      <div className="agent-answer">
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
        <div aria-hidden="true" className="agent-answer__end" ref={answerEnd} />
      </div>
    </article>
  );
});
