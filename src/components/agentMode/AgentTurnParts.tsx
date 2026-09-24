import { memo, useMemo } from "react";
import { agentPromptDisplayText } from "../../domain/agentPromptDisplay";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { AgentMessageCopyButton } from "./AgentMessageCopyButton";
import { HighlightRun } from "./agentThreadHighlight";
import { AgentTurnAttachments, type AgentTurnAttachmentImageViewer } from "./AgentTurnAttachments";
import type { AgentTurnAttachmentView } from "./agentTurnAttachmentPresentation";
import { AgentMetaTime } from "./conversation/AgentTurnMeta";

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
  readonly sentAtEpochMs?: number | null;
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
  sentAtEpochMs = null,
  textClipboard,
}: AgentTurnPromptProps) {
  const displayText = useMemo(() => agentPromptDisplayText(prompt), [prompt]);

  return (
    <div
      className={role === "steer" ? "agent-prompt agent-prompt--steered" : "agent-prompt"}
      data-agent-event={eventKey}
    >
      <div className="agent-prompt__bubble" tabIndex={-1}>
        <AgentTurnAttachments attachments={attachments} images={attachmentImages} />
        {displayText !== "" && (
          <p className="agent-prompt__body">
            <HighlightRun current={current} query={query} text={displayText} />
          </p>
        )}
        {promptClipped && <p className="agent-note">{AGENT_PROMPT_CLIPPED_NOTICE}</p>}
      </div>
      <div className="cv-turn-meta cv-turn-meta--prompt">
        <AgentMetaTime epochMs={sentAtEpochMs} />
        <div className="agent-message-actions">
          <AgentMessageCopyButton
            blockedReason={promptClipped ? AGENT_PROMPT_CLIPPED_COPY_BLOCKED : null}
            clipboard={textClipboard}
            label="your message"
            text={prompt}
          />
        </div>
      </div>
    </div>
  );
});
