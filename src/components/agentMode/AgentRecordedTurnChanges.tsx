import {
  classifyTurnChangesReadFailure,
  isRetryableTurnChangesReason,
} from "../../application/agentTurnChangesReadQueue";
import { useEffect, useMemo, useState } from "react";
import type { AgentThreadsSurface } from "../../application/agentThreadPorts";
import {
  unsupportedAgentTurnChanges,
  type AgentTurnChangeSummary,
} from "../../domain/agentTurnChanges";
import { AgentTurnChangesCard } from "./AgentTurnChangesCard";
import "./agentRecordedTurnChanges.css";

export interface AgentRecordedTurnChangesProps {
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
  return (
    <>
      <AgentTurnChangesCard
        key={`${threadId}:${turnId}`}
        summary={result.summary}
        onOpenDiff={(relativePath) => props.onOpenDiff?.(result.summary, relativePath)}
      />
      {result.summary.state === "unavailable" &&
        isRetryableTurnChangesReason(result.summary.reason) && (
          <button
            className="agent-turn-changes-retry"
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
