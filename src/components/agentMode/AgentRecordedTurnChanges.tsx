import { useEffect, useMemo, useState } from "react";
import type { AgentThreadsSurface } from "../../application/agentThreadPorts";
import type { AgentTurnChangeSummary } from "../../domain/agentTurnChanges";
import type { MonacoAppTheme } from "../../domain/settings";
import { AgentTurnChangesCard } from "./AgentTurnChangesCard";
import "./agentRecordedTurnChanges.css";

export interface RecordedTurnChangesProps {
  readonly onOpenDiff?: (summary: AgentTurnChangeSummary, relativePath?: string) => void;
  readonly revision?: object;
  readonly threadId: string;
  readonly turnId: string;
  readonly getTurnChanges: NonNullable<AgentThreadsSurface["getTurnChanges"]>;
  readonly getTurnFileDiff: NonNullable<AgentThreadsSurface["getTurnFileDiff"]>;
  readonly monacoTheme: MonacoAppTheme;
}
export function AgentRecordedTurnChanges(props: RecordedTurnChangesProps) {
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
      .catch(() => {
        if (active)
          setResult({
            identity,
            summary: {
              turnId,
              state: "unavailable",
              files: [],
              truncated: false,
              reason: "Recorded changes are not available for this turn.",
            },
          });
      });
    return () => {
      active = false;
    };
  }, [identity, getTurnChanges, threadId, turnId]);
  if (result?.identity !== identity) return null;
  return (
    <>
      <AgentTurnChangesCard
        key={`${threadId}:${turnId}`}
        summary={result.summary}
        onOpenDiff={(relativePath) => props.onOpenDiff?.(result.summary, relativePath)}
      />
      {result.summary.state === "unavailable" && (
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
