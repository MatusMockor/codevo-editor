import { useState, type KeyboardEvent } from "react";
import { CircleCheck, CircleDashed } from "lucide-react";
import { AgentCompactRelativeTime, AgentWorkingDuration } from "./agentClock";
import { agentRowStatusLabel, type AgentRowStatus } from "./agentSidebarPresentation";

export function StatusSlot({
  status,
  updatedAtEpochMs,
}: {
  readonly status: AgentRowStatus;
  readonly updatedAtEpochMs: number;
}) {
  const label = agentRowStatusLabel(status);
  if (label === null) {
    return (
      <span className="agent-row__time agent-num">
        <AgentCompactRelativeTime epochMs={updatedAtEpochMs} />
      </span>
    );
  }
  return (
    <span className={`agent-row__status agent-row__status--${status.kind}`}>
      {status.kind === "working" && <CircleDashed aria-hidden="true" size={16} />}
      {status.kind === "done" && <CircleCheck aria-hidden="true" size={16} />}
      {label}
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
