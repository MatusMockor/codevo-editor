import { Square } from "lucide-react";
import { memo, useMemo } from "react";
import type { AgentTurn } from "../../domain/agentThread";
import type { AgentCliKind } from "../../domain/agentTask";
import { agentTurnSettlement } from "./agentTurnProjection";
import {
  agentBackgroundWait,
  agentBackgroundWaitStatus,
} from "./agentBackgroundIndicatorPresentation";
import { agentTurnRuntimeSubagents } from "./agentRuntimeSubagentPresentation";
import { useAgentBackgroundActivity } from "./useAgentBackgroundActivity";
import "./agentBackgroundWorkBanner.css";

const NO_EVENTS: AgentTurn["events"] = [];

export const AgentBackgroundWorkBanner = memo(function AgentBackgroundWorkBanner({
  onStop,
  provider,
  threadId,
  turn,
}: {
  readonly onStop: (() => void) | undefined;
  readonly provider: AgentCliKind;
  readonly threadId: string;
  readonly turn: AgentTurn | null;
}) {
  const running = turn !== null && agentTurnSettlement(turn.status) === "running";
  const activity = useAgentBackgroundActivity(
    JSON.stringify([threadId, turn?.turnId ?? null]),
    turn?.events ?? NO_EVENTS,
    running,
    turn?.eventsTruncated ?? false,
  );
  const shown =
    provider === "claudeCode" && activity.foregroundSettled && activity.phase !== "inactive";
  const status = useMemo(
    () =>
      !shown || turn === null
        ? null
        : agentBackgroundWaitStatus(agentBackgroundWait(activity, agentTurnRuntimeSubagents(turn))),
    [activity, shown, turn],
  );
  if (status === null) return null;
  return (
    <div className="agent-background-banner">
      <span className="agent-background-banner__status" role="status" aria-live="polite">
        <span aria-hidden="true" className="agent-background-banner__pulse" />
        {status}
      </span>
      {onStop !== undefined && (
        <button
          aria-label="Stop agent and background work"
          className="agent-background-banner__stop"
          onClick={onStop}
          type="button"
        >
          <Square aria-hidden="true" size={11} strokeWidth={2.5} />
          Stop
        </button>
      )}
    </div>
  );
});
