import { memo, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import type { AgentBandPin, AgentBandPinObserver } from "../../application/agentBandPin";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { AgentRelativeTime } from "./agentClock";
import { AgentMessageCopyButton } from "./AgentMessageCopyButton";
import { HighlightRun } from "./agentThreadHighlight";

export interface AgentTurnBandProps {
  readonly bandPin: AgentBandPinObserver | null;
  readonly current: number | null;
  readonly ordinal: number | null;
  readonly prompt: string;
  readonly query: string;
  readonly startedAtEpochMs: number | null;
  readonly textClipboard: TextClipboardGateway | null;
  onJumpToAnswerEnd(): void;
}

export const AgentTurnBand = memo(function AgentTurnBand({
  bandPin,
  current,
  onJumpToAnswerEnd,
  ordinal,
  prompt,
  query,
  startedAtEpochMs,
  textClipboard,
}: AgentTurnBandProps) {
  const sentinel = useRef<HTMLSpanElement | null>(null);
  const [pin, setPin] = useState<AgentBandPin>("released");
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (bandPin === null) return;
    const element = sentinel.current;
    if (element === null) return;

    return bandPin.observe(element, setPin);
  }, [bandPin]);

  const expanded = opened || current !== null;
  const ExpandIcon = expanded ? ChevronsDownUp : ChevronsUpDown;
  return (
    <>
      <span aria-hidden="true" className="agent-turn__sentinel" ref={sentinel} />
      <header className={bandClassName(pin, expanded)}>
        {ordinal !== null && (
          <span aria-hidden="true" className="agent-band__number agent-num">
            {ordinal}.
          </span>
        )}
        <p className="agent-band__text">
          <HighlightRun current={current} query={query} text={prompt} />
        </p>
        <button
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse this prompt" : "Show the full prompt"}
          className="agent-band__expand"
          onClick={() => setOpened(!opened)}
          type="button"
        >
          <ExpandIcon aria-hidden="true" size={12} />
        </button>
        <button
          className="agent-band__jump"
          onClick={onJumpToAnswerEnd}
          title="Jump to the end of this answer"
          type="button"
        >
          <ChevronDown aria-hidden="true" className="agent-band__jump-icon" size={12} />
          end of answer
        </button>
        <span
          className="agent-band__meta agent-num"
          aria-label={startedAtEpochMs === null ? undefined : "Message time"}
        >
          {startedAtEpochMs !== null && (
            <span>
              <AgentRelativeTime epochMs={startedAtEpochMs} />
            </span>
          )}
          <AgentMessageCopyButton clipboard={textClipboard} label="your message" text={prompt} />
        </span>
      </header>
    </>
  );
});

function bandClassName(pin: AgentBandPin, expanded: boolean): string {
  const pinned = pin === "pinned" ? " agent-band--pinned" : "";
  const opened = expanded ? " agent-band--expanded" : "";
  return `agent-band${pinned}${opened}`;
}
