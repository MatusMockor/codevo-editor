import { useMemo } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  projectAgentBackgroundState,
  resolveAgentBackgroundActivity,
  type AgentBackgroundActivity,
  type AgentBackgroundState,
} from "../../domain/agentBackgroundActivity";
import { runningTurn, type AgentThread, type AgentTurn } from "../../domain/agentThread";
import { useLiveAgentThread } from "../../application/agentThreads/useLiveAgentThread";
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
  const shownRunning = rowRunningTurn(view.thread);
  const shownState = useMemo(
    () => backgroundStateOf(shownRunning, evidenceOf),
    [evidenceOf, shownRunning],
  );
  const live = useLiveAgentThread(shownState.tasks.length > 0 ? view.thread : null);
  const thread = live ?? view.thread;
  const running = rowRunningTurn(thread);
  const active = running !== null;
  const state = useMemo(
    () => (running === shownRunning ? shownState : backgroundStateOf(running, evidenceOf)),
    [evidenceOf, running, shownRunning, shownState],
  );
  const owner = JSON.stringify([thread.owner.rootKey, thread.threadId, running?.turnId ?? null]);
  const inferredIdle = useAgentForegroundQuiescence(owner, state);
  return useMemo(
    () => (active ? resolveAgentBackgroundActivity(state, inferredIdle) : null),
    [active, state, inferredIdle],
  );
}

function rowRunningTurn(thread: AgentThread): AgentTurn | null {
  return thread.provider.kind === "claudeCode" ? runningTurn(thread) : null;
}

function backgroundStateOf(
  running: AgentTurn | null,
  evidenceOf: AgentTurnLogEvidenceLookup,
): AgentBackgroundState {
  if (running === null) return IDLE_STATE;
  const lost = agentTurnContentLost(running.eventsTruncated, evidenceOf(running.turnId));
  return projectAgentBackgroundState(running.events, true, lost);
}
