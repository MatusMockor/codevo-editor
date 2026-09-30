import { useMemo } from "react";
import type { AgentTurn } from "../../domain/agentThread";
import type { AgentCliKind } from "../../domain/agentTask";
import type { AgentLiveBackground } from "./agents/agentRunningWork";
import { agentTurnSettlement } from "./agentTurnProjection";
import { useAgentBackgroundActivity } from "./useAgentBackgroundActivity";

const NO_EVENTS: AgentTurn["events"] = [];

export function useAgentBackgroundWait(
  provider: AgentCliKind,
  threadId: string,
  turn: AgentTurn | null,
): AgentLiveBackground | null {
  const running = turn !== null && agentTurnSettlement(turn.status) === "running";
  const activity = useAgentBackgroundActivity(
    JSON.stringify([threadId, turn?.turnId ?? null]),
    turn?.events ?? NO_EVENTS,
    running,
    turn?.eventsTruncated ?? false,
  );
  const shown =
    provider === "claudeCode" &&
    turn !== null &&
    activity.foregroundSettled &&
    activity.phase !== "inactive";
  const { tasks, truncated } = activity;
  return useMemo(() => (shown ? { tasks, truncated } : null), [shown, tasks, truncated]);
}
