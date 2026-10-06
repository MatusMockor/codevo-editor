import {
  NO_AGENT_SESSION_REPLY,
  type AgentSessionReply,
} from "../../../domain/agentSessionBackground";
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

const REPLY_BAR: AgentSessionActivityBar = Object.freeze({
  label: "Claude is replying",
  viewLabel: "View background tasks",
  actions: Object.freeze([]),
  announce: true,
});

export function agentSessionActivityBar(
  work: AgentRunningWork,
  liveWait: boolean,
  reply: AgentSessionReply = NO_AGENT_SESSION_REPLY,
): AgentSessionActivityBar | null {
  if (!agentRunningHasWork(work) && !liveWait) return replyBar(reply);
  return {
    label: replyLabel(reply, agentRunningLabel(work) ?? LIVE_WAIT_LABEL),
    viewLabel: work.agents > 0 ? "View agents" : "View background tasks",
    actions: liveWait ? ["view", "stop"] : ["view"],
    announce: liveWait,
  };
}

function replyBar(reply: AgentSessionReply): AgentSessionActivityBar | null {
  switch (reply.kind) {
    case "none":
      return null;
    case "expected":
    case "inProgress":
      return REPLY_BAR;
    default:
      return unsupportedReply(reply);
  }
}

function replyLabel(reply: AgentSessionReply, running: string): string {
  switch (reply.kind) {
    case "none":
      return running;
    case "expected":
    case "inProgress":
      return `Replying · ${running}`;
    default:
      return unsupportedReply(reply);
  }
}

function unsupportedReply(reply: never): never {
  throw new TypeError(`Unsupported agent session reply: ${String(reply)}.`);
}
