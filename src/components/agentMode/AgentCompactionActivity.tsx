import { Minimize2 } from "lucide-react";
import type { AgentTurnItem } from "./agentModePresentation";

export function AgentCompactionActivity() {
  return (
    <p className="agent-note agent-compaction-activity" role="status" aria-live="polite">
      <Minimize2 size={14} aria-hidden="true" />
      <span>Compacting context…</span>
    </p>
  );
}

export function AgentCompactionBoundary({
  item,
}: {
  readonly item: Extract<AgentTurnItem, { kind: "contextCompaction" }>;
}) {
  const detail =
    item.beforeTokens === null || item.afterTokens === null
      ? undefined
      : `${item.beforeTokens.toLocaleString("en-US")} → ${item.afterTokens.toLocaleString("en-US")} tokens`;
  return (
    <div
      className="agent-compaction-event"
      data-agent-event={item.key}
      role="separator"
      aria-label="Conversation compacted"
    >
      {detail === undefined ? (
        <span className="agent-compaction-event__label">
          <Minimize2 size={14} aria-hidden="true" />
          Conversation compacted
        </span>
      ) : (
        <details className="agent-compaction-event__details">
          <summary className="agent-compaction-event__label">
            <Minimize2 size={14} aria-hidden="true" />
            Conversation compacted
          </summary>
          <span className="agent-compaction-event__tokens">{detail}</span>
        </details>
      )}
    </div>
  );
}
