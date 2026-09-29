import { memo, useMemo } from "react";
import type { TextClipboardGateway } from "../../../domain/textClipboard";
import type { AgentPendingSend, AgentPendingSendAttachment } from "../agentPendingSend";
import { AgentTurnPrompt } from "../AgentTurnParts";
import type { AgentTurnAttachmentImageViewer } from "../AgentTurnAttachments";

export const AGENT_PENDING_SEND_FAILED_NOTICE = "Not sent. Your message is back in the composer.";

export const AgentPendingUserMessage = memo(function AgentPendingUserMessage({
  onDismiss,
  send,
  textClipboard,
}: {
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
        prompt={send.prompt}
        query=""
        sentAtEpochMs={send.sentAtEpochMs}
        textClipboard={textClipboard}
      />
      {send.status === "failed" ? (
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
      ) : (
        <p className="agent-visually-hidden" role="status">
          Sending
        </p>
      )}
    </article>
  );
});

export function AgentPendingThreadStart({
  onDismiss,
  send,
  textClipboard,
}: {
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
