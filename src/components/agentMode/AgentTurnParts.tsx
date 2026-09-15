import { memo, useMemo } from "react";
import { ArrowUp, Clock3, Paperclip, Pause, X } from "lucide-react";
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

export interface AgentTurnPromptProps {
  readonly attachmentImages?: AgentTurnAttachmentImageViewer | null;
  readonly attachments?: ReadonlyArray<AgentTurnAttachmentView>;
  readonly current: number | null;
  readonly eventKey?: string;
  readonly prompt: string;
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
        <AgentMessageCopyButton clipboard={textClipboard} label="your message" text={prompt} />
      </div>
      <div className="agent-prompt__bubble" tabIndex={-1}>
        {displayText !== "" && (
          <p className="agent-prompt__body">
            <HighlightRun current={current} query={query} text={displayText} />
          </p>
        )}
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
  readonly state?: "queued" | "paused";
  onSendNow?(id: string): void;
  onRemove(id: string): void;
}

export function AgentQueuedPrompt({
  id,
  prompt,
  attachments,
  displayAttachmentCount,
  state = "queued",
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
    state === "paused"
      ? "Paused. Resume queued messages when you are ready."
      : "Waiting until the current response finishes.";
  const displayText = agentPromptDisplayText(prompt);

  return (
    <div className="agent-prompt agent-prompt--queued" data-agent-queued={id}>
      <div className="agent-prompt__bubble" tabIndex={-1}>
        {displayText !== "" && <p className="agent-prompt__body">{displayText}</p>}
        <div className="agent-prompt__queue">
          <span className="agent-prompt__queue-status" title={statusDescription}>
            {state === "paused" ? <Pause aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
            {state === "paused" ? "Paused" : "Queued"}
          </span>
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
