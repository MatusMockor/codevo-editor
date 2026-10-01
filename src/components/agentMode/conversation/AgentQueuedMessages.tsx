import { Play } from "lucide-react";
import type { Ref } from "react";
import type { DeferredFollowUp } from "../../../application/agentDeferredFollowUps";
import type { AgentExternalLinkOpener } from "../agentMarkdownLinks";
import { AgentQueuedPrompt } from "../AgentQueuedPrompt";

export interface AgentQueuedMessagesProps {
  readonly entries: ReadonlyArray<DeferredFollowUp>;
  readonly listRef: Ref<HTMLDivElement>;
  readonly onResume?: () => void;
  readonly onEdit?: (id: string) => void;
  readonly onRemove: (id: string) => void;
  readonly onSendNow?: (id: string) => void;
  readonly openExternalLink?: AgentExternalLinkOpener | null;
}

export function AgentQueuedMessages({
  entries,
  listRef,
  onEdit,
  onRemove,
  onResume,
  onSendNow,
  openExternalLink = null,
}: AgentQueuedMessagesProps) {
  if (entries.length === 0) return null;
  return (
    <div
      aria-label="Pending messages"
      className="agent-queued-list"
      ref={listRef}
      role="region"
      tabIndex={-1}
    >
      {entries.some((entry) => entry.state === "paused") && onResume !== undefined && (
        <div className="agent-queued-list__controls">
          <button
            aria-label="Resume queued messages"
            className="agent-prompt__queue-action agent-prompt__queue-action--resume"
            onClick={onResume}
            title="Resume queued messages"
            type="button"
          >
            <Play aria-hidden="true" />
            Resume
          </button>
        </div>
      )}
      {entries.map((entry) => (
        <AgentQueuedPrompt
          attachments={entry.request.attachments}
          displayAttachmentCount={entry.displayAttachmentCount}
          id={entry.id}
          key={entry.id}
          onEdit={onEdit}
          onRemove={onRemove}
          onSendNow={onSendNow}
          openExternalLink={openExternalLink}
          prompt={entry.request.prompt}
          state={entry.editLease === undefined ? entry.state : "editing"}
        />
      ))}
    </div>
  );
}
