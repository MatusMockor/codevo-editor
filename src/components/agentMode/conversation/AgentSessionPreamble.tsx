import type { ComponentProps } from "react";
import type {
  AgentThreadHistoryPageView,
  AgentThreadHistorySurface,
} from "../../../application/useAgentThreadHistory";
import type { ExternalAgentSessionHistory } from "../../../domain/externalAgentSession";
import type { TextClipboardGateway } from "../../../domain/textClipboard";
import type { AgentProseContext } from "../AgentAssistantText";
import { AgentHistoryPager } from "../AgentHistoryPager";
import { AgentImportedHistory, type AgentExternalHistoryState } from "../AgentImportedHistory";

type ImportedProps = ComponentProps<typeof AgentImportedHistory>;

export interface AgentSessionPreambleProps {
  readonly threadId: string;
  readonly history: AgentThreadHistorySurface | undefined;
  readonly historyPage: AgentThreadHistoryPageView | null;
  readonly turnsTruncated: boolean;
  readonly provenanceNote: string | null;
  readonly importedSessionId: string | null;
  readonly importedHistory: ExternalAgentSessionHistory | undefined;
  readonly importedImages: ImportedProps["attachmentImages"];
  readonly importedHighlights: ImportedProps["highlights"];
  readonly hasEarlierImportedHistory: boolean;
  readonly externalHistoryState: AgentExternalHistoryState | undefined;
  readonly prose: AgentProseContext;
  readonly textClipboard: TextClipboardGateway | null;
  readonly onEarlierImportedHistory?: () => void;
  readonly onRetryExternalHistory?: () => void;
}

export function AgentSessionPreamble({
  externalHistoryState,
  hasEarlierImportedHistory,
  history,
  historyPage,
  importedHighlights,
  importedHistory,
  importedImages,
  importedSessionId,
  onEarlierImportedHistory,
  onRetryExternalHistory,
  prose,
  provenanceNote,
  textClipboard,
  threadId,
  turnsTruncated,
}: AgentSessionPreambleProps) {
  return (
    <>
      {history !== undefined && (
        <AgentHistoryPager
          page={historyPage}
          hasEarlier={turnsTruncated}
          onEarlier={() => {
            void history.older(threadId);
          }}
          onNewer={
            history.newer === undefined
              ? undefined
              : () => {
                  void history.newer?.(threadId);
                }
          }
          onLatest={history.latest}
        />
      )}
      {turnsTruncated && history === undefined && (
        <p className="agent-note agent-note--warning">
          Earlier turns were dropped to bound memory.
        </p>
      )}
      {provenanceNote !== null && (
        <p className="agent-note agent-session__provenance">{provenanceNote}</p>
      )}
      {importedSessionId !== null && onEarlierImportedHistory !== undefined && (
        <nav aria-label="Original conversation history" className="cv-history-pager">
          <button
            className="cv-load-earlier"
            disabled={externalHistoryState === "loading" || !hasEarlierImportedHistory}
            onClick={onEarlierImportedHistory}
            type="button"
          >
            Earlier imported messages
          </button>
          <button
            className="cv-load-earlier"
            disabled={externalHistoryState === "loading"}
            onClick={onRetryExternalHistory}
            type="button"
          >
            Latest imported messages
          </button>
        </nav>
      )}
      {importedSessionId !== null && (
        <AgentImportedHistory
          attachmentImages={importedImages}
          highlights={importedHighlights}
          history={importedHistory}
          key={`${threadId}:${importedSessionId}`}
          onRetry={onRetryExternalHistory}
          prose={prose}
          state={externalHistoryState}
          textClipboard={textClipboard}
        />
      )}
    </>
  );
}
