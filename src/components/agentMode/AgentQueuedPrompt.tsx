import { ArrowUp, Clock3, Paperclip, Pause, Pencil, X } from "lucide-react";
import type { AgentTurnAttachmentIntent } from "../../application/agentThreadPorts";
import { MAX_AGENT_TURN_ATTACHMENTS } from "../../domain/agentAttachment";
import { agentPromptDisplayText } from "../../domain/agentPromptDisplay";

export type AgentQueuedPromptState = "queued" | "paused" | "uncertain" | "editing";

export interface AgentQueuedPromptProps {
  readonly displayAttachmentCount?: number;
  readonly attachments?: ReadonlyArray<AgentTurnAttachmentIntent>;
  readonly id: string;
  readonly prompt: string;
  readonly state?: AgentQueuedPromptState;
  onEdit?(id: string): void;
  onSendNow?(id: string): void;
  onRemove(id: string): void;
}

export const AGENT_QUEUED_UNCERTAIN_NOTICE =
  "Delivery could not be confirmed. Remove this message before sending it again.";
export const AGENT_QUEUED_EDIT_LABEL = "Edit queued message";
export const AGENT_QUEUED_EDITING_NOTICE =
  "Editing in the composer. It keeps its place in the queue until you save or cancel.";

export function AgentQueuedPrompt({
  id,
  prompt,
  attachments,
  displayAttachmentCount,
  state = "queued",
  onEdit,
  onSendNow,
  onRemove,
}: AgentQueuedPromptProps) {
  const queuedAttachments = (attachments ?? []).slice(0, MAX_AGENT_TURN_ATTACHMENTS);
  const attachmentCount = queuedAttachmentCount(attachments, displayAttachmentCount);
  const boundedAttachmentCount = Math.min(attachmentCount, MAX_AGENT_TURN_ATTACHMENTS);
  const displayText = agentPromptDisplayText(prompt);

  return (
    <div
      className="agent-prompt agent-prompt--queued"
      data-agent-queued={id}
      data-agent-queued-state={state}
    >
      <div className="agent-prompt__bubble" tabIndex={-1}>
        {displayText !== "" && <p className="agent-prompt__body">{displayText}</p>}
        <div className="agent-prompt__queue">
          <span className="agent-prompt__queue-status" title={queuedStatusDescription(state)}>
            {state === "paused" ? <Pause aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
            {queuedStatusLabel(state)}
          </span>
          {state === "uncertain" && (
            <span className="agent-prompt__queue-note">{AGENT_QUEUED_UNCERTAIN_NOTICE}</span>
          )}
          {attachmentCount > 0 && (
            <span
              className="agent-prompt__queue-attachments"
              title={queuedAttachments.map((attachment) => attachment.name).join(", ") || undefined}
            >
              <Paperclip aria-hidden="true" />
              {boundedAttachmentCount}
              {attachmentCount > MAX_AGENT_TURN_ATTACHMENTS ? "+" : ""}{" "}
              {attachmentCount === 1 ? "attachment" : "attachments"}
            </span>
          )}
          {onEdit !== undefined && state !== "editing" && (
            <button
              aria-label={AGENT_QUEUED_EDIT_LABEL}
              className="agent-prompt__queue-action agent-prompt__queue-action--edit"
              disabled={state === "uncertain"}
              title={
                state === "uncertain" ? AGENT_QUEUED_UNCERTAIN_NOTICE : AGENT_QUEUED_EDIT_LABEL
              }
              onClick={() => onEdit(id)}
              type="button"
            >
              <Pencil aria-hidden="true" />
            </button>
          )}
          {state === "queued" && onSendNow !== undefined && (
            <button
              aria-label="Send queued message now"
              className="agent-prompt__queue-action"
              title="Send now"
              onClick={() => onSendNow(id)}
              type="button"
            >
              <ArrowUp aria-hidden="true" />
            </button>
          )}
          <button
            aria-label="Remove queued message"
            className="agent-prompt__queue-action"
            title="Remove queued message"
            onClick={() => onRemove(id)}
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function queuedAttachmentCount(
  attachments: ReadonlyArray<AgentTurnAttachmentIntent> | undefined,
  displayAttachmentCount: number | undefined,
): number {
  if (attachments !== undefined && attachments.length > 0) return attachments.length;
  if (displayAttachmentCount === undefined) return 0;
  if (!Number.isSafeInteger(displayAttachmentCount) || displayAttachmentCount <= 0) return 0;
  return displayAttachmentCount;
}

function queuedStatusLabel(state: AgentQueuedPromptState): string {
  switch (state) {
    case "queued":
      return "Queued";
    case "paused":
      return "Paused";
    case "uncertain":
      return "Delivery unconfirmed";
    case "editing":
      return "Editing";
    default:
      return unsupportedQueuedPromptState(state);
  }
}

function queuedStatusDescription(state: AgentQueuedPromptState): string {
  switch (state) {
    case "queued":
      return "Waiting for the next tool or response to finish.";
    case "paused":
      return "Paused. Resume queued messages when you are ready.";
    case "uncertain":
      return AGENT_QUEUED_UNCERTAIN_NOTICE;
    case "editing":
      return AGENT_QUEUED_EDITING_NOTICE;
    default:
      return unsupportedQueuedPromptState(state);
  }
}

function unsupportedQueuedPromptState(state: never): never {
  throw new TypeError(`Unsupported queued message state: ${String(state)}.`);
}
