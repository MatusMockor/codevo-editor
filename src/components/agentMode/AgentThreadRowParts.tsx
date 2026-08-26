import { useState, type ComponentType, type KeyboardEvent } from "react";
import { CircleCheck, CircleDashed, CircleStop, CircleX, type LucideProps } from "lucide-react";
import { AgentCompactRelativeTime, AgentWorkingDuration } from "./agentClock";
import { agentRowStatusLabel, type AgentRowStatus } from "./agentSidebarPresentation";

type AgentRowStatusKind = AgentRowStatus["kind"];

const STATUS_ICONS: Readonly<
  Record<Exclude<AgentRowStatusKind, "none">, ComponentType<LucideProps>>
> = {
  working: CircleDashed,
  done: CircleCheck,
  failed: CircleX,
  stopped: CircleStop,
};

export const AGENT_ROW_STATUS_ICON_SIZE = 13;

export function StatusSlot({
  status,
  updatedAtEpochMs,
}: {
  readonly status: AgentRowStatus;
  readonly updatedAtEpochMs: number;
}) {
  const label = agentRowStatusLabel(status);
  if (status.kind === "none" || label === null) {
    return (
      <span className="agent-row__time agent-num">
        <AgentCompactRelativeTime epochMs={updatedAtEpochMs} />
      </span>
    );
  }
  const Icon = STATUS_ICONS[status.kind];
  return (
    <span className={`agent-row__status agent-row__status--${status.kind}`}>
      <Icon
        aria-hidden="true"
        className="agent-row__status-icon"
        size={AGENT_ROW_STATUS_ICON_SIZE}
      />
      <span className="agent-row__status-label">{label}</span>
      {status.kind === "working" && (
        <time className="agent-num">
          <AgentWorkingDuration startedAtEpochMs={status.startedAtEpochMs} />
        </time>
      )}
    </span>
  );
}

export function RenameInput({
  initial,
  onCancel,
  onCommit,
}: {
  readonly initial: string;
  onCancel(): void;
  onCommit(title: string): void;
}) {
  const [value, setValue] = useState(initial);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      onCommit(value);
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    onCancel();
  };
  return (
    <input
      aria-label="Rename thread"
      autoFocus
      className="agent-row__rename"
      maxLength={200}
      onBlur={() => onCommit(value)}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={onKeyDown}
      type="text"
      value={value}
    />
  );
}
