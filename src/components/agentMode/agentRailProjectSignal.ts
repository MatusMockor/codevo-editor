import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentPendingInteraction } from "../../domain/agentPendingInteraction";

export type AgentRailProjectSignalTone = "attention" | "working" | "unread";

export interface AgentRailProjectSignal {
  readonly tone: AgentRailProjectSignalTone;
  readonly label: string;
}

export function agentRailProjectSignal(
  threads: ReadonlyArray<AgentThreadView>,
  pendingInteractions: ReadonlyMap<string, AgentPendingInteraction>,
): AgentRailProjectSignal | null {
  const waiting = threads.filter((view) => pendingInteractions.has(view.thread.threadId)).length;
  if (waiting > 0) return { tone: "attention", label: `${countLabel(waiting)} waiting for you` };
  const running = threads.filter((view) => view.lifecycle === "running").length;
  if (running > 0) return { tone: "working", label: `${countLabel(running)} working` };
  const unread = threads.filter((view) => view.unread).length;
  if (unread > 0) return { tone: "unread", label: `${countLabel(unread)} unread` };
  return null;
}

function countLabel(count: number): string {
  return count === 1 ? "1 thread" : `${count} threads`;
}
