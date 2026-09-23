import { memo, useMemo } from "react";
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
  readonly launchLabel?: string | null;
}

export function AgentTurnHead({
  provider,
  startedAtEpochMs,
  timing,
  launchLabel = null,
}: AgentTurnHeadProps) {
  return (
    <header className="agent-turn__head">
      <span aria-hidden="true" className="agent-turn__spark" />
      <span className="agent-turn__agent">{agentCliKindLabel(provider)}</span>
      {launchLabel !== null && (
        <span className="agent-turn__launch" title={launchLabel}>
          {launchLabel}
        </span>
      )}
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
