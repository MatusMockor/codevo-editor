import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { agentTurnDurationLabel } from "./agentModePresentation";
import type { AgentSubagentDisclosureEntry } from "./agentSubagentDisclosurePresentation";
import "./agentSubagentDisclosure.css";

const PAGE_SIZE = 32;
const STATE_LABELS = {
  running: "working",
  completed: "completed",
  failed: "failed",
  interrupted: "interrupted",
  unknown: "status unavailable",
} as const;

export function AgentSubagentDisclosure({
  entries,
  truncated = false,
}: {
  readonly entries: ReadonlyArray<AgentSubagentDisclosureEntry>;
  readonly truncated?: boolean;
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  if (entries.length === 0) return null;
  const states = Object.entries(STATE_LABELS).flatMap(([state, label]) => {
    const count = entries.filter((entry) => entry.state === state).length;
    return count === 0 ? [] : [`${count} ${label}`];
  });
  const running = entries.some((entry) => entry.state === "running");
  const failed = entries.some((entry) => entry.state === "failed");
  return (
    <details className="agent-subagent-disclosure">
      <summary className="agent-subagents">
        <span
          aria-hidden="true"
          className={`agent-subagents__dot${running ? " agent-subagents__dot--live" : failed ? " agent-subagents__dot--failed" : ""}`}
        />
        <span className="agent-subagents__label">
          {truncated ? "At least " : "Started "}
          {entries.length} subagent{entries.length === 1 ? "" : "s"}
        </span>
        <span className="agent-subagents__status">{states.join(" · ")}</span>
        <ChevronDown aria-hidden="true" size={14} className="agent-subagent-disclosure__chevron" />
      </summary>
      {truncated && (
        <p className="agent-note">Additional subagents are not included in this summary.</p>
      )}
      <ul aria-label="Subagents" className="agent-subagent-list">
        {entries.slice(0, visibleCount).map((entry) => (
          <li key={entry.toolId}>
            <details className="agent-subagent-member">
              <summary className="agent-subagent">
                <ChevronDown
                  aria-hidden="true"
                  size={12}
                  className="agent-subagent-disclosure__chevron"
                />
                <span className="agent-subagent__name">{entry.name}</span>
                <span className="agent-subagent__description">{entry.description}</span>
                <span className={`agent-subagent__state agent-subagent__state--${entry.state}`}>
                  {STATE_LABELS[entry.state]}
                </span>
              </summary>
              <SubagentDetail entry={entry} />
            </details>
          </li>
        ))}
      </ul>
      {entries.length > visibleCount && (
        <button
          type="button"
          className="agent-subagent-disclosure__more"
          onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
        >
          Show more ({entries.length - visibleCount} remaining)
        </button>
      )}
    </details>
  );
}

function SubagentDetail({ entry }: { readonly entry: AgentSubagentDisclosureEntry }) {
  const metrics = [
    entry.durationMs === undefined ? null : agentTurnDurationLabel(entry.durationMs),
    entry.totalTokens === undefined ? null : `${entry.totalTokens.toLocaleString()} tokens`,
    entry.steps === undefined ? null : `${entry.steps} tool calls`,
    entry.lastToolName === undefined ? null : `Last tool: ${entry.lastToolName}`,
  ].filter((value) => value !== null);
  return (
    <div className="agent-subagent-member__detail">
      {entry.description && <p>{entry.description}</p>}
      {metrics.length > 0 && <p className="agent-note">{metrics.join(" · ")}</p>}
      {entry.detail && <p className="agent-subagent-member__output">{entry.detail}</p>}
      {!entry.description && !entry.detail && metrics.length === 0 && (
        <p className="agent-note">No additional details reported.</p>
      )}
    </div>
  );
}
