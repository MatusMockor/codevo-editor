import { useRemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";
import { useState, type ComponentType, type KeyboardEvent } from "react";
import {
  CircleAlert,
  CircleDashed,
  CircleStop,
  MessageCircleQuestionMark,
  Server,
  ShieldQuestionMark,
  type LucideProps,
} from "lucide-react";
import { AgentProviderGlyph } from "./AgentProviderGlyph";
import { AgentCompactRelativeTime, AgentRowElapsed } from "./agentClock";
import type { AgentThreadRowRuntime } from "./agentThreadRowLocation";
import {
  agentRowStatusLabel,
  agentRowStatusTicks,
  agentRowStatusTitle,
  agentRowStatusTone,
  type AgentRowStatus,
} from "./agentThreadRowStatus";

type AgentRowGlyphKind = Exclude<AgentRowStatus["kind"], "none" | "done">;

const STATUS_ICONS: Readonly<Record<AgentRowGlyphKind, ComponentType<LucideProps>>> = {
  working: CircleDashed,
  agents: CircleDashed,
  approval: ShieldQuestionMark,
  input: MessageCircleQuestionMark,
  failed: CircleAlert,
  stopped: CircleStop,
};

export const AGENT_ROW_STATUS_ICON_SIZE = 13;
export const AGENT_ROW_WORKING_ICON_SIZE = 16;

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
  return (
    <span
      className="cv-card-row__status"
      data-tone={agentRowStatusTone(status)}
      title={agentRowStatusTitle(status) ?? undefined}
    >
      <AgentRowStatusGlyph status={status} />
      <span className="cv-card-row__status-label">{label}</span>
      {isWorkingStatus(status) && agentRowStatusTicks(status) && (
        <span aria-hidden="true" className="cv-card-row__tick">
          <AgentRowElapsed startedAtEpochMs={status.startedAtEpochMs} />
        </span>
      )}
    </span>
  );
}

function AgentRowStatusGlyph({ status }: { readonly status: AgentRowStatus }) {
  if (status.kind === "none") return null;
  if (status.kind === "done") return <span aria-hidden="true" className="cv-card-row__done-dot" />;
  const Icon = STATUS_ICONS[status.kind];
  return (
    <Icon
      aria-hidden="true"
      size={isWorkingStatus(status) ? AGENT_ROW_WORKING_ICON_SIZE : AGENT_ROW_STATUS_ICON_SIZE}
    />
  );
}

function isWorkingStatus(
  status: AgentRowStatus,
): status is Extract<AgentRowStatus, { readonly kind: "working" | "agents" }> {
  return status.kind === "working" || status.kind === "agents";
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
  const name = remote?.servers.find((server) => server.id === serverId)?.name ?? null;
  return <RemoteServerIndicator name={name} />;
}

function RemoteServerIndicator({ name }: { readonly name: string | null }) {
  return (
    <span
      aria-label="Runs on server"
      className="agent-row__icon"
      role="img"
      style={{ display: "inline-flex", alignSelf: "center", marginInlineEnd: 4 }}
      title={name === null ? "Runs on server" : `Runs on ${name}`}
    >
      <Server aria-hidden="true" size={13} />
    </span>
  );
}

export function AgentThreadRowRuntimeBadge({
  runtime,
}: {
  readonly runtime: AgentThreadRowRuntime;
}) {
  return (
    <span
      aria-label={runtime.label}
      className="cv-card-row__runtime"
      role="img"
      title={runtime.label}
    >
      {runtime.place === "server" && (
        <span aria-hidden="true" className="cv-card-row__runtime-place">
          <Server size={14} />
        </span>
      )}
      <AgentProviderGlyph decorative kind={runtime.provider} />
    </span>
  );
}
