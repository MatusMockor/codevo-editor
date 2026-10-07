import { memo, useMemo } from "react";
import type { AgentCliKind } from "../../../domain/agentTask";
import type { TextClipboardGateway } from "../../../domain/textClipboard";
import type { AgentExternalLinkOpener } from "../agentMarkdownLinks";
import {
  agentPendingSendProvider,
  type AgentPendingSend,
  type AgentPendingSendAttachment,
} from "../agentPendingSend";
import { AgentTurnPrompt } from "../AgentTurnParts";
import type { AgentTurnAttachmentImageViewer } from "../AgentTurnAttachments";
import { AgentCodexStartingNote, AgentWaitingForOutputNote } from "./AgentTurnAwaitingOutput";

export const AGENT_PENDING_SEND_FAILED_NOTICE = "Not sent. Your message is back in the composer.";

export const AgentPendingUserMessage = memo(function AgentPendingUserMessage({
  onDismiss,
  openExternalLink,
  provider = null,
  send,
  textClipboard,
}: {
  readonly openExternalLink: AgentExternalLinkOpener | null;
  readonly provider?: AgentCliKind | null;
  readonly send: AgentPendingSend;
  readonly textClipboard: TextClipboardGateway | null;
  onDismiss(): void;
}) {
  const images = useMemo(() => pendingImageViewer(send.attachments), [send.attachments]);
  const views = useMemo(() => send.attachments.map((entry) => entry.view), [send.attachments]);
  return (
    <article aria-label="Your message" className="agent-turn" data-pending-send={send.status}>
      <AgentTurnPrompt
        attachmentImages={images}
        attachments={views}
        current={null}
        openExternalLink={openExternalLink}
        prompt={send.prompt}
        query=""
        sentAtEpochMs={send.sentAtEpochMs}
        textClipboard={textClipboard}
      />
      <AgentPendingSendOutcomeView onDismiss={onDismiss} provider={provider} status={send.status} />
    </article>
  );
});

function AgentPendingSendOutcomeView({
  onDismiss,
  provider,
  status,
}: {
  readonly provider: AgentCliKind | null;
  readonly status: AgentPendingSend["status"];
  onDismiss(): void;
}) {
  switch (status) {
    case "sending":
      return <AgentPendingSendProgress provider={provider} />;
    case "failed":
      return <AgentPendingSendFailure onDismiss={onDismiss} />;
    default:
      return unsupportedStatus(status);
  }
}

function AgentPendingSendProgress({ provider }: { readonly provider: AgentCliKind | null }) {
  const startingCodex = provider === "codex";
  return (
    <>
      <div aria-hidden="true" className="agent-answer">
        {startingCodex && <AgentCodexStartingNote />}
        <div className="agent-turn__events">{!startingCodex && <AgentWaitingForOutputNote />}</div>
        <div className="cv-turn-meta" />
      </div>
      <p className="agent-visually-hidden" role="status">
        Sending
      </p>
    </>
  );
}

function AgentPendingSendFailure({ onDismiss }: { onDismiss(): void }) {
  return (
    <p className="agent-note agent-note--warning" role="alert">
      {AGENT_PENDING_SEND_FAILED_NOTICE}{" "}
      <button
        aria-label="Dismiss unsent message"
        className="cv-banner-action"
        onClick={onDismiss}
        type="button"
      >
        Dismiss
      </button>
    </p>
  );
}

export function AgentPendingThreadStart({
  onDismiss,
  openExternalLink,
  send,
  textClipboard,
}: {
  readonly openExternalLink: AgentExternalLinkOpener | null;
  readonly send: AgentPendingSend;
  readonly textClipboard: TextClipboardGateway | null;
  onDismiss(): void;
}) {
  return (
    <section aria-label="New agent thread" className="agent-session">
      <div className="agent-session__scroll">
        <div className="agent-session__body cv-conversation-column">
          <div className="agent-turn-list">
            <AgentPendingUserMessage
              onDismiss={onDismiss}
              openExternalLink={openExternalLink}
              provider={agentPendingSendProvider(send)}
              send={send}
              textClipboard={textClipboard}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function pendingImageViewer(
  attachments: ReadonlyArray<AgentPendingSendAttachment>,
): AgentTurnAttachmentImageViewer {
  const urls = new Map<string, string>();
  for (const entry of attachments) {
    if (entry.view.kind === "image" && entry.previewUrl !== null) {
      urls.set(entry.view.attachmentId, entry.previewUrl);
    }
  }
  return {
    stateOf: (attachmentId) => {
      const url = urls.get(attachmentId);
      return url === undefined ? undefined : { kind: "ready", url };
    },
    ensure: ignore,
    reveal: ignore,
    open: ignore,
  };
}

function ignore(): void {}

function unsupportedStatus(status: never): never {
  throw new TypeError(`Unsupported pending send status: ${String(status)}.`);
}
