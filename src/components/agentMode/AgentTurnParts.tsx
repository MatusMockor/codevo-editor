import { memo, useMemo } from "react";
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
  readonly attachments?: ReadonlyArray<AgentTurnAttachmentIntent>;
  readonly id: string;
  readonly prompt: string;
  onRemove(id: string): void;
}

export function AgentQueuedPrompt({ id, prompt, attachments, onRemove }: AgentQueuedPromptProps) {
  const views = useMemo<ReadonlyArray<AgentTurnAttachmentView>>(
    () =>
      (attachments ?? []).slice(0, MAX_AGENT_TURN_ATTACHMENTS).map((attachment, index) => ({
        kind: "chip",
        key: String(index),
        name: attachment.name,
        glyph:
          attachment.kind === "reference"
            ? "reference"
            : attachment.mime === null
              ? "file"
              : "image",
      })),
    [attachments],
  );
  const displayText = agentPromptDisplayText(prompt);

  return (
    <div className="agent-prompt agent-prompt--queued" data-agent-queued={id}>
      <div className="agent-prompt__bubble" tabIndex={-1}>
        {displayText !== "" && <p className="agent-prompt__body">{displayText}</p>}
        <AgentTurnAttachments attachments={views} images={null} />
        <div className="agent-prompt__queue">
          <span className="agent-prompt__chip agent-prompt__chip--queued">Queued</span>
          <button
            aria-label="Remove queued message"
            className="agent-prompt__remove"
            onClick={() => onRemove(id)}
            type="button"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
