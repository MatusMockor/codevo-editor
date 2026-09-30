import {
  agentRunningHasWork,
  agentRunningLabel,
  type AgentRunningWork,
} from "../agents/agentRunningWork";

export type AgentSessionActivityAction = "view" | "stop";

export type AgentSessionActivityViewLabel = "View agents" | "View background tasks";

export interface AgentSessionActivityBar {
  readonly label: string;
  readonly viewLabel: AgentSessionActivityViewLabel;
  readonly actions: ReadonlyArray<AgentSessionActivityAction>;
  readonly announce: boolean;
}

const LIVE_WAIT_LABEL = "Background tasks running";

export function agentSessionActivityBar(
  work: AgentRunningWork,
  liveWait: boolean,
): AgentSessionActivityBar | null {
  if (!agentRunningHasWork(work) && !liveWait) return null;
  return {
    label: agentRunningLabel(work) ?? LIVE_WAIT_LABEL,
    viewLabel: work.agents > 0 ? "View agents" : "View background tasks",
    actions: liveWait ? ["view", "stop"] : ["view"],
    announce: liveWait,
  };
}
