import { useMemo } from "react";
import type { AgentTurn } from "../../domain/agentThread";
import type { AgentCliKind } from "../../domain/agentTask";
import { agentTurnSettlement } from "./agentTurnProjection";
import {
  agentBackgroundWait,
  type AgentBackgroundWait,
} from "./agentBackgroundIndicatorPresentation";
import { agentTurnRuntimeSubagents } from "./agentRuntimeSubagentPresentation";
import { useAgentBackgroundActivity } from "./useAgentBackgroundActivity";

const NO_EVENTS: AgentTurn["events"] = [];

export function useAgentBackgroundWait(
  provider: AgentCliKind,
  threadId: string,
  turn: AgentTurn | null,
): AgentBackgroundWait | null {
  const running = turn !== null && agentTurnSettlement(turn.status) === "running";
  const activity = useAgentBackgroundActivity(
    JSON.stringify([threadId, turn?.turnId ?? null]),
    turn?.events ?? NO_EVENTS,
    running,
    turn?.eventsTruncated ?? false,
  );
  const shown =
    provider === "claudeCode" && activity.foregroundSettled && activity.phase !== "inactive";
  return useMemo(
    () =>
      !shown || turn === null
        ? null
        : agentBackgroundWait(activity, agentTurnRuntimeSubagents(turn)),
    [activity, shown, turn],
  );
}
