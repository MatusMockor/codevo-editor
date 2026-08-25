import { memo } from "react";
import { Pin } from "lucide-react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { AgentRelativeTime } from "./agentClock";
import {
  agentThreadAttentionLabel,
  agentThreadDisplayTitle,
  agentThreadModelTag,
  agentThreadTone,
  lastAgentTurnStatus,
} from "./agentModePresentation";

export interface AgentThreadRowProps {
  readonly view: AgentThreadView;
  readonly selected: boolean;
  readonly focused: boolean;
  onSelect(threadId: string): void;
  onTogglePin(threadId: string): void;
}

export const AgentThreadRow = memo(function AgentThreadRow({
  focused,
  onSelect,
  onTogglePin,
  selected,
  view,
}: AgentThreadRowProps) {
  const thread = view.thread;
  const threadId = thread.threadId;
  const tone = agentThreadTone(view.lifecycle, lastAgentTurnStatus(thread));
  const pinned = thread.pinned;
  const unread = view.unread && !selected;
  const model = agentThreadModelTag(thread);
  const pinClassName = pinned ? "agent-thread__pin agent-thread__pin--on" : "agent-thread__pin";

  return (
    <div className="agent-thread-slot" data-attention={view.attention} role="listitem">
      <button
        aria-current={selected}
        className={rowClassName(selected, view.attention)}
        data-thread-id={threadId}
        onClick={() => onSelect(threadId)}
        tabIndex={focused ? 0 : -1}
        type="button"
      >
        <span aria-hidden="true" className={`agent-dot agent-dot--${tone}`} />
        <span className="agent-thread__text">
          <span className="agent-thread__title">
            {unread && (
              <span aria-label="Unread result" className="agent-thread__unread" role="img" />
            )}
            {agentThreadDisplayTitle(thread)}
          </span>
          <span className="agent-thread__meta agent-num">
            {agentThreadAttentionLabel(view.attention)} ·{" "}
            <AgentRelativeTime epochMs={thread.updatedAtEpochMs} />
            {model !== null && ` · ${model}`}
          </span>
        </span>
        {view.lifecycle === "running" && (
          <span aria-label="Turn running" className="agent-thread__live" role="img" />
        )}
      </button>
      <button
        aria-label={pinned ? `Unpin thread ${threadId}` : `Pin thread ${threadId}`}
        aria-pressed={pinned}
        className={pinClassName}
        onClick={() => onTogglePin(threadId)}
        tabIndex={-1}
        title={pinned ? "Unpin thread" : "Pin thread"}
        type="button"
      >
        <Pin aria-hidden="true" size={11} />
      </button>
    </div>
  );
});

function rowClassName(selected: boolean, attention: AgentThreadView["attention"]): string {
  const classes = ["agent-thread"];
  if (selected) classes.push("agent-thread--on");
  if (attention === "attention") classes.push("agent-thread--attention");
  return classes.join(" ");
}
