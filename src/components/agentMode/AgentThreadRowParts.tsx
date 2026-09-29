import { useRemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";
import { useState, type ComponentType, type KeyboardEvent } from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleStop,
  MessageCircleQuestionMark,
  Server,
  ShieldQuestionMark,
  type LucideProps,
} from "lucide-react";
import { AgentCompactRelativeTime, AgentRowElapsed } from "./agentClock";
import {
  agentRowStatusLabel,
  agentRowStatusTitle,
  agentRowStatusTone,
  type AgentRowStatus,
} from "./agentThreadRowStatus";

type AgentRowStatusKind = AgentRowStatus["kind"];

const STATUS_ICONS: Readonly<
  Record<Exclude<AgentRowStatusKind, "none">, ComponentType<LucideProps>>
> = {
  working: CircleDashed,
  agents: CircleDashed,
  approval: ShieldQuestionMark,
  input: MessageCircleQuestionMark,
  done: CircleCheck,
  failed: CircleAlert,
  stopped: CircleStop,
};

export const AGENT_ROW_STATUS_ICON_SIZE = 13;

export function AgentThreadRowStatusSlot({
  status,
  updatedAtEpochMs,
}: {
  readonly status: AgentRowStatus;
  readonly updatedAtEpochMs: number;
}) {
  const label = agentRowStatusLabel(status);
  if (status.kind === "none" || label === null) {
    return (
      <span className="cv-card-row__when">
        <AgentCompactRelativeTime epochMs={updatedAtEpochMs} />
      </span>
    );
  }
  const Icon = STATUS_ICONS[status.kind];
  return (
    <span
      className="cv-card-row__status"
      data-tone={agentRowStatusTone(status)}
      title={agentRowStatusTitle(status) ?? undefined}
    >
      <Icon aria-hidden="true" size={AGENT_ROW_STATUS_ICON_SIZE} />
      <span className="cv-card-row__status-label">{label}</span>
      {(status.kind === "working" || status.kind === "agents") && (
        <span aria-hidden="true" className="cv-card-row__tick">
          <AgentRowElapsed startedAtEpochMs={status.startedAtEpochMs} />
        </span>
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
      className="cv-card-row__rename"
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

export function RemoteThreadIndicator({ serverId }: { readonly serverId?: string }) {
  const remote = useRemoteRunnerContext();
  const name = remote?.servers.find((server) => server.id === serverId)?.name;
  return (
    <span
      aria-label="Runs on server"
      className="agent-row__icon"
      role="img"
      style={{ display: "inline-flex", alignSelf: "center", marginInlineEnd: 4 }}
      title={name === undefined ? "Runs on server" : `Runs on ${name}`}
    >
      <Server aria-hidden="true" size={13} />
    </span>
  );
}
