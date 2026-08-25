import { GitCompare } from "lucide-react";
import type { AgentTaskChangeSummary } from "../../application/agentThreadPorts";
import { agentChangedFilesCueLabel } from "./agentModePresentation";

export interface AgentThreadChangesCueProps {
  readonly threadId: string;
  readonly summary: AgentTaskChangeSummary;
  onReviewInDiff(threadId: string): void;
}

export function AgentThreadChangesCue({
  onReviewInDiff,
  summary,
  threadId,
}: AgentThreadChangesCueProps) {
  const label = agentChangedFilesCueLabel(summary);
  if (label === null) return null;

  return (
    <p className="agent-session__changes-cue" data-agent-changes-cue>
      <GitCompare aria-hidden="true" size={12} />
      <span>{label}</span>
      <span aria-hidden="true" className="agent-session__changes-sep">
        ·
      </span>
      <button
        aria-label={`Review changes for agent ${threadId} in the Diff surface`}
        className="agent-linkbutton"
        onClick={() => onReviewInDiff(threadId)}
        type="button"
      >
        Review in Diff
      </button>
    </p>
  );
}
