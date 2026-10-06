import {
  classifyTurnChangesReadFailure,
  isAutoRetryableTurnChangesReason,
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

const AUTO_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000];

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
  const identity = useMemo(
    () => ({ threadId, turnId, getTurnChanges, revision }),
    [threadId, turnId, getTurnChanges, revision],
  );
  const [manualRetry, setManualRetry] = useState<{ readonly identity: object } | null>(null);
  const request = manualRetry?.identity === identity ? manualRetry : identity;
  const [result, setResult] = useState<{
    identity: object;
    request: object;
    summary: AgentTurnChangeSummary;
  } | null>(null);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = (attempt: number) => {
      void getTurnChanges(threadId, turnId)
        .catch((error: unknown) => readFailureSummary(turnId, error))
        .then((summary) => {
          if (!active || summary.turnId !== turnId) return;
          if (
            attempt >= AUTO_RETRY_DELAYS_MS.length ||
            !isAutoRetryableTurnChangesReason(summary.reason)
          ) {
            setResult({ identity, request, summary });
            return;
          }
          timer = setTimeout(() => read(attempt + 1), AUTO_RETRY_DELAYS_MS[attempt]);
        });
    };
    read(request === identity ? 0 : AUTO_RETRY_DELAYS_MS.length);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [identity, request, getTurnChanges, threadId, turnId]);
  if (result?.identity !== identity) return null;
  const retrying = result.request !== request;
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
            disabled={retrying}
            onClick={() => setManualRetry({ identity })}
          >
            {retrying ? "Retrying…" : "Retry recorded changes"}
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
