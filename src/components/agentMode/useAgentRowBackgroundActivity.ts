import { useMemo } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  projectAgentBackgroundState,
  resolveAgentBackgroundActivity,
  type AgentBackgroundActivity,
  type AgentBackgroundState,
} from "../../domain/agentBackgroundActivity";
import { runningTurn } from "../../domain/agentThread";
import {
  agentTurnContentLost,
  type AgentTurnLogEvidenceLookup,
} from "../../domain/agentTurnContentLoss";
import { useAgentForegroundQuiescence } from "./useAgentBackgroundActivity";

const IDLE_STATE: AgentBackgroundState = {
  foreground: { kind: "running" },
  tasks: [],
  truncated: false,
};

export function useAgentRowBackgroundActivity(
  view: AgentThreadView,
  evidenceOf: AgentTurnLogEvidenceLookup,
): AgentBackgroundActivity | null {
  const thread = view.thread;
  const running = thread.provider.kind === "claudeCode" ? runningTurn(thread) : null;
  const active = running !== null;
  const events = running?.events ?? null;
  const lost =
    running !== null && agentTurnContentLost(running.eventsTruncated, evidenceOf(running.turnId));
  const state = useMemo(
    () => (events === null ? IDLE_STATE : projectAgentBackgroundState(events, true, lost)),
    [events, lost],
  );
  const owner = JSON.stringify([thread.owner.rootKey, thread.threadId, running?.turnId ?? null]);
  const inferredIdle = useAgentForegroundQuiescence(owner, state);
  return useMemo(
    () => (active ? resolveAgentBackgroundActivity(state, inferredIdle) : null),
    [active, state, inferredIdle],
  );
}
