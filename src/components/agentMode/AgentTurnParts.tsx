import { memo } from "react";
import type { AgentCliKind } from "../../domain/agentTask";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { AgentRelativeTime, AgentWorkingDuration } from "./agentClock";
import { AgentMessageCopyButton } from "./AgentMessageCopyButton";
import { agentCliKindLabel, agentTurnDurationLabel } from "./agentModePresentation";
import { HighlightRun } from "./agentThreadHighlight";
import type { AgentTurnTiming } from "./agentTurnHeadPresentation";

const MAX_TIME_VALUE = 8_640_000_000_000_000;

export interface AgentTurnPromptProps {
  readonly current: number | null;
  readonly prompt: string;
  readonly query: string;
  readonly textClipboard: TextClipboardGateway | null;
}

export const AgentTurnPrompt = memo(function AgentTurnPrompt({
  current,
  prompt,
  query,
  textClipboard,
}: AgentTurnPromptProps) {
  return (
    <div className="agent-prompt">
      <div className="agent-message-actions">
        <AgentMessageCopyButton clipboard={textClipboard} label="your message" text={prompt} />
      </div>
      <p className="agent-prompt__body" tabIndex={-1}>
        <HighlightRun current={current} query={query} text={prompt} />
      </p>
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
