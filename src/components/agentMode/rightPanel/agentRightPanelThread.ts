import { useState } from "react";
import type { AgentThreadView } from "../../../application/agentThreadPorts";

export function agentRightPanelThreadKey(view: AgentThreadView | null): string {
  if (view === null) return "";
  const { thread } = view;
  return JSON.stringify([
    view.execution ?? null,
    thread.threadId,
    thread.owner,
    thread.target,
    thread.title,
    thread.turns.map((turn) => [turn.turnId, turn.endedAtEpochMs]),
    view.lifecycle,
    view.worktreeRemoved,
    view.worktreeMissing,
    view.ship,
    view.editorAvailability,
  ]);
}

interface StableThread {
  readonly key: string;
  readonly view: AgentThreadView | null;
}

export function useStableAgentRightPanelThread(
  view: AgentThreadView | null,
): AgentThreadView | null {
  const key = agentRightPanelThreadKey(view);
  const [stable, setStable] = useState<StableThread>({ key, view });
  if (stable.key === key) return stable.view;
  setStable({ key, view });
  return view;
}
