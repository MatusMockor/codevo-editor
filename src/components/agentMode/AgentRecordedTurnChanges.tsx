import {
  classifyTurnChangesReadFailure,
  isRetryableTurnChangesReason,
} from "../../application/agentTurnChangesReadQueue";
import { useEffect, useMemo, useState } from "react";
import type { AgentThreadsSurface } from "../../application/agentThreadPorts";
import {
  isMissingAgentTurnSnapshot,
  unsupportedAgentTurnChanges,
  type AgentTurnChangeSummary,
} from "../../domain/agentTurnChanges";
import { AgentTurnChangesRow } from "./conversation/AgentTurnChangesRow";

export interface AgentRecordedTurnChangesProps {
  readonly active?: boolean;
  readonly onOpenDiff?: (summary: AgentTurnChangeSummary, relativePath?: string) => void;
  readonly revision?: object;
  readonly threadId: string;
  readonly turnId: string;
  readonly getTurnChanges: NonNullable<AgentThreadsSurface["getTurnChanges"]>;
}

export function AgentRecordedTurnChanges(props: AgentRecordedTurnChangesProps) {
  const { threadId, turnId, getTurnChanges, revision } = props;
  const [retry, setRetry] = useState(0);
  const identity = useMemo(
    () => ({ threadId, turnId, getTurnChanges, revision, retry }),
    [threadId, turnId, getTurnChanges, revision, retry],
  );
  const [result, setResult] = useState<{
    identity: object;
    summary: AgentTurnChangeSummary;
  } | null>(null);
  useEffect(() => {
    let active = true;
    void getTurnChanges(threadId, turnId)
      .then((summary) => {
        if (active && summary.turnId === turnId) setResult({ identity, summary });
      })
      .catch((error: unknown) => {
        if (active) setResult({ identity, summary: readFailureSummary(turnId, error) });
      });
    return () => {
      active = false;
    };
  }, [identity, getTurnChanges, threadId, turnId]);
  if (result?.identity !== identity) return null;
  if (result.summary.state === "unsupported") return null;
  if (isMissingAgentTurnSnapshot(result.summary)) return null;
  return (
    <>
      <AgentTurnChangesRow
        active={props.active ?? false}
        key={`${threadId}:${turnId}`}
        onOpenDiff={(relativePath) => props.onOpenDiff?.(result.summary, relativePath)}
        summary={result.summary}
      />
      {result.summary.state === "unavailable" &&
        isRetryableTurnChangesReason(result.summary.reason) && (
          <button
            className="cv-changes-retry agent-turn-changes-retry"
            type="button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry recorded changes
          </button>
        )}
    </>
  );
}

function readFailureSummary(turnId: string, error: unknown): AgentTurnChangeSummary {
  const failure = classifyTurnChangesReadFailure(error);
  if (failure.kind === "notApplicable") return unsupportedAgentTurnChanges(turnId, "notApplicable");
  return { turnId, state: "unavailable", files: [], truncated: false, reason: failure.reason };
}
