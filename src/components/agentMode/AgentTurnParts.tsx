import { memo, useMemo } from "react";
import { ArrowUp, Clock3, Paperclip, Pause, Pencil, X } from "lucide-react";
import type { AgentTurnAttachmentIntent } from "../../application/agentThreadPorts";
import { MAX_AGENT_TURN_ATTACHMENTS } from "../../domain/agentAttachment";
import { agentPromptDisplayText } from "../../domain/agentPromptDisplay";
import type { AgentCliKind } from "../../domain/agentTask";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { AgentRelativeTime, AgentWorkingDuration } from "./agentClock";
import { AgentMessageCopyButton } from "./AgentMessageCopyButton";
import { agentCliKindLabel, agentTurnDurationLabel } from "./agentModePresentation";
import { HighlightRun } from "./agentThreadHighlight";
import { AgentTurnAttachments, type AgentTurnAttachmentImageViewer } from "./AgentTurnAttachments";
import type { AgentTurnAttachmentView } from "./agentTurnAttachmentPresentation";
import type { AgentTurnTiming } from "./agentTurnHeadPresentation";

const MAX_TIME_VALUE = 8_640_000_000_000_000;
const NO_ATTACHMENTS: ReadonlyArray<AgentTurnAttachmentView> = [];

export type AgentPromptRole = "turn" | "steer";

export const AGENT_PROMPT_CLIPPED_NOTICE =
  "Shortened when this thread was saved. The full message is kept in this turn's log.";
export const AGENT_PROMPT_CLIPPED_COPY_BLOCKED =
  "Only the shortened message is available here; the full message is in this turn's log.";

export interface AgentTurnPromptProps {
  readonly attachmentImages?: AgentTurnAttachmentImageViewer | null;
  readonly attachments?: ReadonlyArray<AgentTurnAttachmentView>;
  readonly current: number | null;
  readonly eventKey?: string;
  readonly prompt: string;
  readonly promptClipped?: boolean;
  readonly query: string;
  readonly role?: AgentPromptRole;
  readonly textClipboard: TextClipboardGateway | null;
}

export const AgentTurnPrompt = memo(function AgentTurnPrompt({
  attachmentImages = null,
  attachments = NO_ATTACHMENTS,
  current,
  eventKey,
  prompt,
  promptClipped = false,
  query,
  role = "turn",
  textClipboard,
}: AgentTurnPromptProps) {
  const displayText = useMemo(() => agentPromptDisplayText(prompt), [prompt]);

  return (
    <div
      className={role === "steer" ? "agent-prompt agent-prompt--steered" : "agent-prompt"}
      data-agent-event={eventKey}
    >
      <div className="agent-message-actions">
        <AgentMessageCopyButton
          blockedReason={promptClipped ? AGENT_PROMPT_CLIPPED_COPY_BLOCKED : null}
          clipboard={textClipboard}
          label="your message"
          text={prompt}
        />
      </div>
      <div className="agent-prompt__bubble" tabIndex={-1}>
        {displayText !== "" && (
          <p className="agent-prompt__body">
            <HighlightRun current={current} query={query} text={displayText} />
          </p>
        )}
        {promptClipped && <p className="agent-note">{AGENT_PROMPT_CLIPPED_NOTICE}</p>}
        <AgentTurnAttachments attachments={attachments} images={attachmentImages} />
      </div>
    </div>
  );
});

export interface AgentTurnHeadProps {
  readonly provider: AgentCliKind;
  readonly startedAtEpochMs: number | null;
  readonly timing: AgentTurnTiming;
}

export function AgentTurnHead({ provider, startedAtEpochMs, timing }: AgentTurnHeadProps) {
  return (
    <header className="agent-turn__head">
      <span aria-hidden="true" className="agent-turn__spark" />
      <span className="agent-turn__agent">{agentCliKindLabel(provider)}</span>
      {startedAtEpochMs !== null && (
        <time className="agent-turn__time agent-num" dateTime={isoTime(startedAtEpochMs)}>
          <AgentRelativeTime epochMs={startedAtEpochMs} />
        </time>
      )}
      <AgentTurnDuration timing={timing} />
    </header>
  );
}

function AgentTurnDuration({ timing }: { readonly timing: AgentTurnTiming }) {
  if (timing.kind === "untimed") return null;

  if (timing.kind === "running") {
    return (
      <span className="agent-turn__duration agent-num">
        <AgentWorkingDuration startedAtEpochMs={timing.startedAtEpochMs} />
      </span>
    );
  }

  return (
    <span className="agent-turn__duration agent-num">
      {agentTurnDurationLabel(timing.elapsedMs)}
    </span>
  );
}

function isoTime(epochMs: number): string | undefined {
  if (!Number.isFinite(epochMs)) return undefined;
  if (Math.abs(epochMs) > MAX_TIME_VALUE) return undefined;

  return new Date(epochMs).toISOString();
}

export interface AgentQueuedPromptProps {
  readonly displayAttachmentCount?: number;
  readonly attachments?: ReadonlyArray<AgentTurnAttachmentIntent>;
  readonly id: string;
  readonly prompt: string;
  readonly state?: "queued" | "paused" | "uncertain";
  onEdit?(id: string): void;
  onSendNow?(id: string): void;
  onRemove(id: string): void;
}

export const AGENT_QUEUED_UNCERTAIN_NOTICE =
  "Delivery could not be confirmed. Remove this message before sending it again.";

export const AGENT_QUEUED_EDIT_LABEL = "Edit queued message";
export const AGENT_QUEUED_EDIT_ATTACHMENTS_NOTICE =
  "Messages with attachments can't be edited; remove and re-add";

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
  const attachmentCount = attachments?.length
    ? attachments.length
    : typeof displayAttachmentCount === "number" &&
        Number.isSafeInteger(displayAttachmentCount) &&
        displayAttachmentCount > 0
      ? displayAttachmentCount
      : 0;
  const boundedAttachmentCount = Math.min(attachmentCount, MAX_AGENT_TURN_ATTACHMENTS);
  const statusDescription =
    state === "uncertain"
      ? AGENT_QUEUED_UNCERTAIN_NOTICE
      : state === "paused"
        ? "Paused. Resume queued messages when you are ready."
        : "Waiting for the next tool or response to finish.";
  const displayText = agentPromptDisplayText(prompt);

  return (
    <div className="agent-prompt agent-prompt--queued" data-agent-queued={id}>
      <div className="agent-prompt__bubble" tabIndex={-1}>
        {displayText !== "" && <p className="agent-prompt__body">{displayText}</p>}
        <div className="agent-prompt__queue">
          <span className="agent-prompt__queue-status" title={statusDescription}>
            {state === "paused" ? <Pause aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
            {state === "uncertain"
              ? "Delivery unconfirmed"
              : state === "paused"
                ? "Paused"
                : "Queued"}
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
          {attachmentCount > 0 && onEdit !== undefined && (
            <span className="agent-prompt__queue-note">{AGENT_QUEUED_EDIT_ATTACHMENTS_NOTICE}</span>
          )}
          {onEdit !== undefined && (
            <button
              aria-label={AGENT_QUEUED_EDIT_LABEL}
              className="agent-prompt__queue-action agent-prompt__queue-action--edit"
              disabled={attachmentCount > 0 || state === "uncertain"}
              title={
                state === "uncertain"
                  ? AGENT_QUEUED_UNCERTAIN_NOTICE
                  : attachmentCount > 0
                    ? AGENT_QUEUED_EDIT_ATTACHMENTS_NOTICE
                    : AGENT_QUEUED_EDIT_LABEL
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
